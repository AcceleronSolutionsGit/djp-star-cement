import { dbRun, dbAll, dbGet } from '../config/database.js';
import {
  getAllZonalHeadMappings,
  resolveZonalHead,
  healAllMissingZonalHeads,
  refreshDynamicZonalHeadCache,
  normalizeZone,
  ZONE_CANONICAL_ALIASES
} from '../services/zonalHead.service.js';

/**
 * GET /api/hierarchy/zonal-heads
 * Get all configured zone to Zonal Head mappings
 */
export async function listZonalHeads(req, res) {
  try {
    const mappings = await getAllZonalHeadMappings();
    res.json({
      success: true,
      totalZones: mappings.length,
      mappings
    });
  } catch (err) {
    console.error('[listZonalHeads]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/hierarchy/zonal-heads/resolve
 * Resolve Zonal Head for a zone, area, region, or state
 */
export async function resolveZonalHeadEndpoint(req, res) {
  try {
    const { zone, region, area, dmArea, state, branch } = req.query;
    const resolved = await resolveZonalHead({ zone, region, area, dmArea, state, branch });
    res.json({
      success: true,
      ...resolved
    });
  } catch (err) {
    console.error('[resolveZonalHeadEndpoint]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/hierarchy/zonal-heads/heal
 * On-demand backfill/healing of missing Zonal Heads across master tables
 */
export async function healZonalHeadsEndpoint(req, res) {
  try {
    const result = await healAllMissingZonalHeads();
    res.json({
      success: true,
      message: 'Zonal Heads healed across master_dealers, master_dealer_so_mapping, and dealer_visit_targets.',
      ...result
    });
  } catch (err) {
    console.error('[healZonalHeadsEndpoint]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * PUT /api/hierarchy/zonal-heads/:zoneCode
 * Dynamically update Zonal Head for a zone and cascade across all tables
 */
export async function updateZonalHeadMapping(req, res) {
  try {
    const { zoneCode } = req.params;
    const { zh_name, zh_code, emp_code, designation, level, state, area_keywords } = req.body;

    if (!zh_name) {
      return res.status(400).json({ error: 'zh_name is required' });
    }

    const cleanZone = String(zoneCode).trim().toUpperCase();
    const norm = normalizeZone(cleanZone) || cleanZone;

    const effectiveEmpCode = emp_code ? String(emp_code).trim() : (zh_code ? String(zh_code).trim() : `ZH_${cleanZone}`);
    const effectiveZhCode = zh_code ? String(zh_code).trim() : effectiveEmpCode;

    // Collect all alias zone codes so they stay in sync
    const allMatchingCodes = new Set([cleanZone, norm]);
    for (const [alias, canonical] of Object.entries(ZONE_CANONICAL_ALIASES)) {
      if (canonical === norm || alias === cleanZone) {
        allMatchingCodes.add(alias);
        allMatchingCodes.add(canonical);
      }
    }
    const codesArray = Array.from(allMatchingCodes);
    const placeholders = codesArray.map(() => '?').join(', ');

    // 1. Upsert into master_zone_zh_mapping for the target zone
    await dbRun(`
      INSERT INTO master_zone_zh_mapping (
        zone_code, zone_name, zh_name, zh_code, emp_code, designation, level, state, area_keywords, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        zh_name = VALUES(zh_name),
        zh_code = COALESCE(VALUES(zh_code), zh_code),
        emp_code = COALESCE(VALUES(emp_code), emp_code),
        designation = COALESCE(VALUES(designation), designation),
        level = COALESCE(VALUES(level), level),
        state = COALESCE(VALUES(state), state),
        area_keywords = COALESCE(VALUES(area_keywords), area_keywords),
        updated_at = NOW()
    `, [
      cleanZone,
      req.body.zone_name || cleanZone,
      zh_name.trim(),
      effectiveZhCode,
      effectiveEmpCode,
      designation || 'Zonal Head',
      level || 'L5',
      state || null,
      area_keywords || null
    ]);

    // Also update all aliases in master_zone_zh_mapping
    await dbRun(`
      UPDATE master_zone_zh_mapping
      SET 
        zh_name = ?,
        zh_code = COALESCE(?, zh_code),
        emp_code = COALESCE(?, emp_code),
        designation = COALESCE(?, designation),
        level = COALESCE(?, level),
        updated_at = NOW()
      WHERE zone_code IN (${placeholders})
    `, [zh_name.trim(), zh_code, emp_code, designation, level, ...codesArray]);

    // 2. Cascade immediately across all active tables
    await dbRun(`
      UPDATE master_dealers
      SET zh_name = ?, zh_code = COALESCE(?, zh_code)
      WHERE UPPER(TRIM(zone)) IN (${placeholders}) OR UPPER(TRIM(region)) IN (${placeholders})
    `, [zh_name.trim(), zh_code, ...codesArray, ...codesArray]);

    await dbRun(`
      UPDATE master_dealer_so_mapping
      SET zh_name = ?, zh_code = COALESCE(?, zh_code)
      WHERE UPPER(TRIM(zone)) IN (${placeholders}) OR UPPER(TRIM(region)) IN (${placeholders})
    `, [zh_name.trim(), zh_code, ...codesArray, ...codesArray]);

    await dbRun(`
      UPDATE dealer_visit_targets
      SET zh_name = ?, zh_code = COALESCE(?, zh_code)
      WHERE UPPER(TRIM(zone)) IN (${placeholders}) OR UPPER(TRIM(region)) IN (${placeholders})
    `, [zh_name.trim(), zh_code, ...codesArray, ...codesArray]);

    // 3. Immediately invalidate and refresh the in-memory cache
    await refreshDynamicZonalHeadCache(true);

    res.json({
      success: true,
      message: `Zonal Head for zone ${cleanZone} (and aliases: ${codesArray.join(', ')}) successfully updated to ${zh_name} and cascaded across all tables.`,
      zone: cleanZone,
      zh_name: zh_name.trim(),
      zh_code: zh_code ? String(zh_code).trim() : null,
      affectedAliases: codesArray
    });
  } catch (err) {
    console.error('[updateZonalHeadMapping]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/hierarchy/zonal-heads/sync-from-sfa
 * Automatically sync and update Zonal Heads dynamically from employee_master (SFA API)
 */
export async function syncZonalHeadsFromSfa(req, res) {
  try {
    const emRows = await dbAll(`
      SELECT emp_code, dns_emp_code, emp_name, designation, level, zone, state
      FROM employee_master
      WHERE designation NOT IN ('MIS', 'ACCOUNTS', 'Branding verification', 'PROJECT LOTUS ADMIN', 'SFA TEAM')
        AND emp_name NOT LIKE '%TEST%'
        AND (
          designation LIKE '%ZH%' OR designation LIKE '%ZONAL%' OR designation LIKE '%HEAD%'
          OR designation IN ('General Manager', 'GM', 'GENERAL MANAGER', 'SR. GM', 'SR General Manager', 'Senior General Manager', 'AVP', 'VP')
          OR level IN ('L5', 'L6', 'L7')
        )
      ORDER BY 
        CASE WHEN acedns = 'Y' THEN 0 ELSE 1 END,
        CASE 
          WHEN designation LIKE '%ZH%' OR designation LIKE '%ZONAL HEAD%' THEN 1
          WHEN designation IN ('General Manager', 'GM', 'GENERAL MANAGER') THEN 2
          ELSE 3
        END
    `);

    let syncedCount = 0;
    for (const em of emRows) {
      if (!em.zone || !em.emp_name) continue;
      const cleanZone = String(em.zone).trim().toUpperCase();
      const norm = normalizeZone(cleanZone) || cleanZone;

      const allMatchingCodes = new Set([cleanZone, norm]);
      for (const [alias, canonical] of Object.entries(ZONE_CANONICAL_ALIASES)) {
        if (canonical === norm || alias === cleanZone) {
          allMatchingCodes.add(alias);
          allMatchingCodes.add(canonical);
        }
      }
      const codesArray = Array.from(allMatchingCodes);
      const placeholders = codesArray.map(() => '?').join(', ');

      await dbRun(`
        UPDATE master_zone_zh_mapping
        SET 
          zh_name = ?,
          zh_code = COALESCE(?, zh_code),
          emp_code = COALESCE(?, emp_code),
          designation = COALESCE(?, designation),
          level = COALESCE(?, level),
          updated_at = NOW()
        WHERE zone_code IN (${placeholders})
      `, [em.emp_name, em.dns_emp_code || em.emp_code, em.emp_code, em.designation, em.level, ...codesArray]);
      syncedCount++;
    }

    // Refresh dynamic in-memory cache
    await refreshDynamicZonalHeadCache(true);

    // Run healing cascade across master tables
    const healRes = await healAllMissingZonalHeads();

    res.json({
      success: true,
      syncedZones: syncedCount,
      healResult: healRes,
      message: `Successfully refreshed Zonal Heads dynamically from employee_master.`
    });
  } catch (err) {
    console.error('[syncZonalHeadsFromSfa]', err);
    res.status(500).json({ error: err.message });
  }
}


