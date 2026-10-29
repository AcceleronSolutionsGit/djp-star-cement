import { dbAll, dbRun, dbGet } from '../config/database.js';

const SFA_CUSTOMER_API_URL = 'http://52.66.31.108/star-one-sfa/misreport/api_customer_base_latt_longi.php';

let syncInProgress = false;

/**
 * Sync customer coordinates from SFA customer base API into master_customer_coordinates table.
 * 
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - force resync even if data exists
 * @param {boolean} [options.allRecords=false] - fetch all records or only has_coordinates=yes
 * @returns {Promise<{success: boolean, totalFetched: number, upsertedCount: number, dealersUpdated: number, message: string}>}
 */
export async function syncCustomerCoordinatesFromApi(options = {}) {
  if (syncInProgress) {
    return { success: false, message: 'Sync already in progress' };
  }

  const { force = false, allRecords = false } = options;

  try {
    syncInProgress = true;

    // Check if we already have coordinates populated
    if (!force) {
      const existing = await dbGet('SELECT COUNT(*) as cnt FROM master_customer_coordinates WHERE has_coordinates = 1');
      if (existing?.cnt > 5000) {
        console.log(`[CustomerCoords] Already have ${existing.cnt} customer coordinates. Skipping full fetch.`);
        // Run update on master_dealers just in case new dealers were imported
        const updateRes = await updateMasterDealersFromCoordinates();
        return {
          success: true,
          totalFetched: existing.cnt,
          upsertedCount: 0,
          dealersUpdated: updateRes.affectedRows,
          message: `Already populated with ${existing.cnt} customer coordinates.`
        };
      }
    }

    const fetchUrl = allRecords 
      ? SFA_CUSTOMER_API_URL 
      : `${SFA_CUSTOMER_API_URL}?has_coordinates=yes`;

    console.log(`[CustomerCoords] Fetching from ${fetchUrl}...`);
    const startTime = Date.now();
    const res = await fetch(fetchUrl);

    if (!res.ok) {
      throw new Error(`SFA customer API returned HTTP status ${res.status}`);
    }

    const json = await res.json();
    const records = Array.isArray(json) ? json : (json.data || []);
    console.log(`[CustomerCoords] Received ${records.length} records in ${(Date.now() - startTime) / 1000}s`);

    if (records.length === 0) {
      return { success: true, totalFetched: 0, upsertedCount: 0, dealersUpdated: 0, message: 'No records returned from API' };
    }

    // Chunk into batches of 500 for fast MySQL bulk inserts
    const CHUNK_SIZE = 500;
    let upsertedCount = 0;

    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);
      const values = [];
      const placeholders = [];

      for (const r of chunk) {
        const dnsCode = (r.dns_customer_code || r.customer_code || '').trim();
        if (!dnsCode) continue;

        const lat = parseFloat(r.latitude) || 0;
        const lng = parseFloat(r.longitude) || 0;
        const hasCoords = (r.has_coordinates === true || (lat !== 0 && lng !== 0)) ? 1 : 0;

        placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())');
        values.push(
          dnsCode,
          r.customer_code ? String(r.customer_code).trim() : null,
          r.display_code ? String(r.display_code).trim() : null,
          r.customer_name ? String(r.customer_name).trim() : null,
          r.customer_type ? String(r.customer_type).trim() : null,
          r.phone_no ? String(r.phone_no).trim() : null,
          r.route_name ? String(r.route_name).trim() : null,
          lat,
          lng,
          hasCoords,
          r.branch_code ? String(r.branch_code).trim() : null,
          r.state_code ? String(r.state_code).trim() : null,
          r.zone ? String(r.zone).trim() : null,
          r.address ? String(r.address).trim() : null,
          r.pin ? String(r.pin).trim() : null
        );
      }

      if (placeholders.length > 0) {
        const sql = `
          INSERT INTO master_customer_coordinates (
            dns_customer_code, customer_code, display_code, customer_name, customer_type,
            phone_no, route_name, latitude, longitude, has_coordinates,
            branch_code, state_code, zone, address, pin, updated_at
          ) VALUES ${placeholders.join(', ')}
          ON DUPLICATE KEY UPDATE
            customer_code = VALUES(customer_code),
            display_code = VALUES(display_code),
            customer_name = VALUES(customer_name),
            customer_type = VALUES(customer_type),
            phone_no = VALUES(phone_no),
            route_name = VALUES(route_name),
            latitude = VALUES(latitude),
            longitude = VALUES(longitude),
            has_coordinates = VALUES(has_coordinates),
            branch_code = VALUES(branch_code),
            state_code = VALUES(state_code),
            zone = VALUES(zone),
            address = VALUES(address),
            pin = VALUES(pin),
            updated_at = NOW()
        `;
        await dbRun(sql, values);
        upsertedCount += placeholders.length;
      }
    }

    console.log(`[CustomerCoords] Upserted ${upsertedCount} coordinate records to DB.`);

    // Now update master_dealers with coordinates
    const updateRes = await updateMasterDealersFromCoordinates();
    console.log(`[CustomerCoords] Updated ${updateRes.affectedRows} dealer records in master_dealers.`);

    return {
      success: true,
      totalFetched: records.length,
      upsertedCount,
      dealersUpdated: updateRes.affectedRows,
      message: `Successfully synced ${upsertedCount} coordinates and updated ${updateRes.affectedRows} dealers.`
    };
  } catch (err) {
    console.error('[CustomerCoords] Error syncing coordinates:', err);
    throw err;
  } finally {
    syncInProgress = false;
  }
}

/**
 * Propagate coordinates, counter names, and dealer/RSAR types from master_customer_coordinates into master_dealers.
 */
export async function updateMasterDealersFromCoordinates() {
  try {
    let affected = 0;
    console.log('[CustomerCoords] Checking master_dealers for missing coordinates / counter details...');

    const needUpdate = await dbGet(`
      SELECT COUNT(*) as cnt 
      FROM master_dealers 
      WHERE has_coordinates = 0 
         OR latitude IS NULL 
         OR latitude = 0 
         OR dealer_type IS NULL 
         OR dealer_type = 'STAR' 
         OR dealer_name LIKE 'SBG-%'
    `);

    if (!needUpdate || needUpdate.cnt === 0) {
      console.log('[CustomerCoords] ✓ All master_dealers already have valid coordinates and counter metadata.');
      return { affectedRows: 0 };
    }

    console.log(`[CustomerCoords] Updating ${needUpdate.cnt} dealer(s) from coordinates cache...`);

    // 1. Direct indexed match on sfa_code = dns_customer_code
    const res1 = await dbRun(`
      UPDATE master_dealers d
      JOIN master_customer_coordinates c ON d.sfa_code = c.dns_customer_code
      SET
        d.latitude = CASE WHEN (d.latitude IS NULL OR d.latitude = 0) AND c.has_coordinates = 1 THEN c.latitude ELSE d.latitude END,
        d.longitude = CASE WHEN (d.longitude IS NULL OR d.longitude = 0) AND c.has_coordinates = 1 THEN c.longitude ELSE d.longitude END,
        d.route_name = COALESCE(d.route_name, c.route_name),
        d.has_coordinates = CASE WHEN c.has_coordinates = 1 THEN 1 ELSE d.has_coordinates END,
        d.dealer_name = CASE 
          WHEN d.dealer_name IS NULL OR d.dealer_name = '' OR d.dealer_name LIKE 'SBG-%' THEN c.customer_name 
          ELSE d.dealer_name 
        END,
        d.dealer_type = CASE
          WHEN c.customer_type = 'Sub Dealer' OR c.customer_type LIKE '%Sub%' THEN 'RSAR'
          WHEN c.customer_type IN ('Dealer', 'Exclusive Dealer') AND (d.dealer_type = 'STAR' OR d.dealer_type IS NULL) THEN 'DEALER'
          ELSE d.dealer_type
        END
      WHERE (d.has_coordinates = 0 OR d.latitude IS NULL OR d.latitude = 0 OR d.dealer_type IS NULL OR d.dealer_type = 'STAR' OR d.dealer_name LIKE 'SBG-%')
        AND (c.has_coordinates = 1 OR c.customer_name IS NOT NULL)
    `);
    affected += (res1.affectedRows || res1.changes || 0);

    // 2. Direct indexed match on sap_code = customer_code
    const res2 = await dbRun(`
      UPDATE master_dealers d
      JOIN master_customer_coordinates c ON d.sap_code = c.customer_code
      SET
        d.latitude = CASE WHEN (d.latitude IS NULL OR d.latitude = 0) AND c.has_coordinates = 1 THEN c.latitude ELSE d.latitude END,
        d.longitude = CASE WHEN (d.longitude IS NULL OR d.longitude = 0) AND c.has_coordinates = 1 THEN c.longitude ELSE d.longitude END,
        d.route_name = COALESCE(d.route_name, c.route_name),
        d.has_coordinates = CASE WHEN c.has_coordinates = 1 THEN 1 ELSE d.has_coordinates END,
        d.dealer_name = CASE 
          WHEN d.dealer_name IS NULL OR d.dealer_name = '' OR d.dealer_name LIKE 'SBG-%' THEN c.customer_name 
          ELSE d.dealer_name 
        END,
        d.dealer_type = CASE
          WHEN c.customer_type = 'Sub Dealer' OR c.customer_type LIKE '%Sub%' THEN 'RSAR'
          WHEN c.customer_type IN ('Dealer', 'Exclusive Dealer') AND (d.dealer_type = 'STAR' OR d.dealer_type IS NULL) THEN 'DEALER'
          ELSE d.dealer_type
        END
      WHERE (d.has_coordinates = 0 OR d.latitude IS NULL OR d.latitude = 0 OR d.dealer_type IS NULL OR d.dealer_type = 'STAR' OR d.dealer_name LIKE 'SBG-%')
        AND (c.has_coordinates = 1 OR c.customer_name IS NOT NULL)
    `);
    affected += (res2.affectedRows || res2.changes || 0);

    // 3. Direct indexed match on sap_code = dns_customer_code
    const res3 = await dbRun(`
      UPDATE master_dealers d
      JOIN master_customer_coordinates c ON d.sap_code = c.dns_customer_code
      SET
        d.latitude = CASE WHEN (d.latitude IS NULL OR d.latitude = 0) AND c.has_coordinates = 1 THEN c.latitude ELSE d.latitude END,
        d.longitude = CASE WHEN (d.longitude IS NULL OR d.longitude = 0) AND c.has_coordinates = 1 THEN c.longitude ELSE d.longitude END,
        d.route_name = COALESCE(d.route_name, c.route_name),
        d.has_coordinates = CASE WHEN c.has_coordinates = 1 THEN 1 ELSE d.has_coordinates END,
        d.dealer_name = CASE 
          WHEN d.dealer_name IS NULL OR d.dealer_name = '' OR d.dealer_name LIKE 'SBG-%' THEN c.customer_name 
          ELSE d.dealer_name 
        END,
        d.dealer_type = CASE
          WHEN c.customer_type = 'Sub Dealer' OR c.customer_type LIKE '%Sub%' THEN 'RSAR'
          WHEN c.customer_type IN ('Dealer', 'Exclusive Dealer') AND (d.dealer_type = 'STAR' OR d.dealer_type IS NULL) THEN 'DEALER'
          ELSE d.dealer_type
        END
      WHERE (d.has_coordinates = 0 OR d.latitude IS NULL OR d.latitude = 0 OR d.dealer_type IS NULL OR d.dealer_type = 'STAR' OR d.dealer_name LIKE 'SBG-%')
        AND (c.has_coordinates = 1 OR c.customer_name IS NOT NULL)
    `);
    affected += (res3.affectedRows || res3.changes || 0);

    console.log(`[CustomerCoords] ✓ Finished updating master_dealers: ${affected} records updated.`);
    return { affectedRows: affected };
  } catch (err) {
    console.warn('[CustomerCoords] Warning updating master_dealers:', err.message);
    return { affectedRows: 0 };
  }
}

/**
 * Get coordinates for a list of dealer codes (SFA code, SAP code, or customer code).
 * 
 * @param {string[]} codes
 * @returns {Promise<Map<string, { lat: number, lng: number, routeName: string, hasCoordinates: boolean, customerName: string, address: string, pin: string }>>}
 */
export async function getCoordinatesForDealers(codes = []) {
  const result = new Map();
  if (!codes || codes.length === 0) return result;

  const cleanCodes = [...new Set(codes.map(c => String(c || '').trim().toUpperCase()).filter(Boolean))];
  if (cleanCodes.length === 0) return result;

  // Ensure table has data; if empty, sync once
  try {
    const countRow = await dbGet('SELECT COUNT(*) as cnt FROM master_customer_coordinates');
    if (!countRow || countRow.cnt === 0) {
      console.log('[CustomerCoords] master_customer_coordinates is empty, performing initial sync...');
      await syncCustomerCoordinatesFromApi({ force: true, allRecords: false });
    }
  } catch (e) {
    console.warn('[CustomerCoords] Could not check coordinates table:', e.message);
  }

  // Fetch in chunks of 500
  const CHUNK_SIZE = 500;
  for (let i = 0; i < cleanCodes.length; i += CHUNK_SIZE) {
    const chunk = cleanCodes.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');

    const rows = await dbAll(
      `SELECT dns_customer_code, customer_code, customer_name, route_name, latitude, longitude, has_coordinates, address, pin
       FROM master_customer_coordinates
       WHERE UPPER(TRIM(dns_customer_code)) IN (${placeholders})
          OR UPPER(TRIM(customer_code)) IN (${placeholders})`,
      [...chunk, ...chunk]
    );

    for (const r of rows) {
      const lat = parseFloat(r.latitude) || 0;
      const lng = parseFloat(r.longitude) || 0;
      const has = (r.has_coordinates === 1 || r.has_coordinates === true) && (lat !== 0 || lng !== 0);
      const coordObj = {
        lat,
        lng,
        routeName: r.route_name || '',
        hasCoordinates: !!has,
        customerName: r.customer_name || '',
        address: r.address || '',
        pin: r.pin || ''
      };

      if (r.dns_customer_code) result.set(r.dns_customer_code.trim().toUpperCase(), coordObj);
      if (r.customer_code) result.set(r.customer_code.trim().toUpperCase(), coordObj);
    }
  }

  // Also fallback to master_dealers for any cached coordinates
  const missingCodes = cleanCodes.filter(c => !result.has(c));
  if (missingCodes.length > 0) {
    for (let i = 0; i < missingCodes.length; i += CHUNK_SIZE) {
      const chunk = missingCodes.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await dbAll(
        `SELECT sap_code, sfa_code, dealer_name, route_name, latitude, longitude, has_coordinates
         FROM master_dealers
         WHERE (latitude IS NOT NULL AND latitude != 0)
           AND (UPPER(TRIM(sfa_code)) IN (${placeholders}) OR UPPER(TRIM(sap_code)) IN (${placeholders}))`,
        [...chunk, ...chunk]
      );
      for (const r of rows) {
        const lat = parseFloat(r.latitude) || 0;
        const lng = parseFloat(r.longitude) || 0;
        const coordObj = {
          lat,
          lng,
          routeName: r.route_name || '',
          hasCoordinates: lat !== 0 || lng !== 0,
          customerName: r.dealer_name || '',
          address: '',
          pin: ''
        };
        if (r.sfa_code) result.set(r.sfa_code.trim().toUpperCase(), coordObj);
        if (r.sap_code) result.set(r.sap_code.trim().toUpperCase(), coordObj);
      }
    }
  }

  return result;
}

/**
 * Status of customer coordinates database
 */
export async function getCustomerCoordinateStatus() {
  try {
    const totalRow = await dbGet('SELECT COUNT(*) as total, SUM(CASE WHEN has_coordinates = 1 THEN 1 ELSE 0 END) as with_coords, MAX(updated_at) as last_updated FROM master_customer_coordinates');
    const dealersMatchedRow = await dbGet('SELECT COUNT(*) as total_dealers, SUM(CASE WHEN latitude IS NOT NULL AND latitude != 0 THEN 1 ELSE 0 END) as dealers_with_coords FROM master_dealers');
    return {
      totalCoordinatesCached: totalRow?.total || 0,
      coordinatesWithGps: totalRow?.with_coords || 0,
      lastUpdated: totalRow?.last_updated || null,
      totalDealers: dealersMatchedRow?.total_dealers || 0,
      dealersWithGps: dealersMatchedRow?.dealers_with_coords || 0
    };
  } catch (err) {
    return { error: err.message };
  }
}
