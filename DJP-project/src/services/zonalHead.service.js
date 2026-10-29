import { dbRun, dbAll, dbGet } from '../config/database.js';

/**
 * Canonical zone normalization dictionary.
 */
const ZONE_CANONICAL_ALIASES = {
  'NE1': 'NE1',
  'NE-1': 'NE1',
  'NE 1': 'NE1',
  'ZONE NE1': 'NE1',
  'ZONE_A': 'NE1',
  'ZONE A': 'NE1',
  'ASSAM': 'NE1',

  'NE2': 'NE2',
  'NE-2': 'NE2',
  'NE 2': 'NE2',
  'ZONE NE2': 'NE2',
  'ZONE_B': 'NE2',
  'ZONE B': 'NE2',
  'TRIPURA': 'NE2',
  'BARAK VALLEY': 'NE2',
  'SILCHAR': 'NE2',

  'NB1': 'NB1',
  'NB-1': 'NB1',
  'NB 1': 'NB1',
  'NORTH BENGAL': 'NB1',
  'NORTH BENGAL 1': 'NB1',
  'SILIGURI': 'NB1',

  'NB2': 'NB2',
  'NB-2': 'NB2',
  'NB 2': 'NB2',
  'NORTH BENGAL 2': 'NB2',
  'MALDA': 'NB2',
  'DAKSHIN DINAJPUR': 'NB2',

  'SOUTH BENGAL': 'SOUTH BENGAL',
  'SB': 'SOUTH BENGAL',
  'WB': 'SOUTH BENGAL',
  'KOLKATA': 'SOUTH BENGAL',

  'BIHAR': 'BIHAR',
  'BH': 'BIHAR',
  'BH1': 'BIHAR',
  'BH-1': 'BIHAR',
  'BH2': 'BIHAR',
  'BH-2': 'BIHAR',
  'PATNA': 'BIHAR',

  'NT': 'NT',
  'NON TRADE': 'NT',
  'NON-TRADE': 'NT',
  'INSTITUTIONAL': 'NT'
};

/**
 * Normalize raw zone string to canonical zone code.
 *
 * @param {string} [zoneStr]
 * @returns {string|null}
 */
export function normalizeZone(zoneStr) {
  if (!zoneStr) return null;
  const clean = String(zoneStr).trim().toUpperCase();
  if (!clean || clean === '-' || clean === 'NA' || clean === 'N/A' || clean === 'NULL') return null;

  if (ZONE_CANONICAL_ALIASES[clean]) {
    return ZONE_CANONICAL_ALIASES[clean];
  }

  // Regex partial matching
  if (clean.includes('NE2') || clean.includes('NE-2')) return 'NE2';
  if (clean.includes('NE1') || clean.includes('NE-1')) return 'NE1';
  if (clean.includes('NB2') || clean.includes('NB-2')) return 'NB2';
  if (clean.includes('NB1') || clean.includes('NB-1') || clean.includes('NORTH BENGAL')) return 'NB1';
  if (clean.includes('SOUTH BENGAL') || clean === 'SB') return 'SOUTH BENGAL';
  if (clean.includes('BIHAR') || clean.startsWith('BH-') || clean.startsWith('BH1') || clean.startsWith('BH2')) return 'BIHAR';
  if (clean.includes('NON TRADE') || clean === 'NT') return 'NT';

  return clean;
}

/**
 * Infer zone by area name from master_zone_zh_mapping keywords or existing records.
 *
 * @param {string} area
 * @param {string} [state]
 * @returns {Promise<string|null>}
 */
export async function findZoneByArea(area, state = '') {
  if (!area || String(area).trim() === '') return null;
  const cleanArea = String(area).trim().toUpperCase();

  // 1. Check keyword match in master_zone_zh_mapping
  const allMappings = await dbAll('SELECT zone_code, area_keywords FROM master_zone_zh_mapping');
  for (const m of allMappings) {
    if (!m.area_keywords) continue;
    const keywords = m.area_keywords.split(',').map(k => k.trim().toUpperCase());
    if (keywords.includes(cleanArea)) {
      return m.zone_code;
    }
  }

  // 2. Check if any existing dealer in master_dealers with this area has a known zone
  const dealerMatch = await dbGet(`
    SELECT COALESCE(NULLIF(zone, ''), NULLIF(region, '')) as found_zone
    FROM master_dealers
    WHERE (LOWER(TRIM(area)) = LOWER(?) OR LOWER(TRIM(dm_area)) = LOWER(?))
      AND (zone IS NOT NULL AND zone != '' OR region IS NOT NULL AND region != '')
    LIMIT 1
  `, [cleanArea, cleanArea]);

  if (dealerMatch?.found_zone) {
    const norm = normalizeZone(dealerMatch.found_zone);
    if (norm) return norm;
  }

  // 3. Check master_dealer_so_mapping
  const soMapMatch = await dbGet(`
    SELECT COALESCE(NULLIF(zone, ''), NULLIF(region, '')) as found_zone
    FROM master_dealer_so_mapping
    WHERE LOWER(TRIM(area)) = LOWER(?)
      AND (zone IS NOT NULL AND zone != '' OR region IS NOT NULL AND region != '')
    LIMIT 1
  `, [cleanArea]);

  if (soMapMatch?.found_zone) {
    const norm = normalizeZone(soMapMatch.found_zone);
    if (norm) return norm;
  }

  // 4. Fallback based on state name if provided
  if (state) {
    const cleanState = String(state).trim().toUpperCase();
    if (cleanState.includes('TRIPURA') || cleanState.includes('MIZORAM') || cleanState.includes('SILCHAR')) return 'NE2';
    if (cleanState.includes('ASSAM') || cleanState.includes('MEGHALAYA') || cleanState.includes('NAGALAND') || cleanState.includes('MANIPUR')) return 'NE1';
    if (cleanState.includes('NORTH BENGAL') || cleanState.includes('SIKKIM')) return 'NB1';
    if (cleanState.includes('SOUTH BENGAL') || cleanState.includes('WEST BENGAL')) return 'SOUTH BENGAL';
    if (cleanState.includes('BIHAR')) return 'BIHAR';
  }

  return null;
}

/**
 * Resolve Zonal Head (ZH) for a given set of geographic attributes.
 * Looks up in master_zone_zh_mapping first, then falls back to dynamic query on employee_master.
 *
 * @param {Object} params
 * @param {string} [params.zone]
 * @param {string} [params.region]
 * @param {string} [params.area]
 * @param {string} [params.dmArea]
 * @param {string} [params.state]
 * @param {string} [params.branch]
 * @returns {Promise<{ zone: string|null, zh_name: string|null, zh_code: string|null, emp_code: string|null, designation: string|null, level: string|null, resolvedBy: string }>}
 */
export async function resolveZonalHead({ zone, region, area, dmArea, state, branch } = {}) {
  let resolvedZone = normalizeZone(zone || region);
  let resolvedBy = 'NONE';

  if (resolvedZone) {
    resolvedBy = 'EXPLICIT_ZONE';
  } else {
    // Attempt to infer from area or state
    const effectiveArea = area || dmArea || branch;
    resolvedZone = await findZoneByArea(effectiveArea, state);
    if (resolvedZone) {
      resolvedBy = 'INFERRED_FROM_AREA';
    }
  }

  // Fallback to NE2 as default if no zone identified in Northeast estate
  if (!resolvedZone) {
    resolvedZone = 'NE2';
    resolvedBy = 'DEFAULT_FALLBACK';
  }

  // Query master_zone_zh_mapping
  const row = await dbGet(
    'SELECT zone_code, zh_name, zh_code, emp_code, designation, level FROM master_zone_zh_mapping WHERE zone_code = ?',
    [resolvedZone]
  );

  if (row) {
    return {
      zone: row.zone_code,
      zh_name: row.zh_name,
      zh_code: row.zh_code,
      emp_code: row.emp_code,
      designation: row.designation,
      level: row.level,
      resolvedBy
    };
  }

  // Dynamic fallback to employee_master
  const dynamicZH = await dbGet(`
    SELECT emp_code, dns_emp_code, emp_name, designation, level, zone
    FROM employee_master
    WHERE (zone = ? OR state = ?)
      AND designation NOT IN ('MIS', 'ACCOUNTS', 'Branding verification', 'PROJECT LOTUS ADMIN', 'SFA TEAM')
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
        WHEN designation IN ('Senior General Manager', 'SR. GM', 'SR General Manager') THEN 3
        WHEN designation IN ('AVP', 'VP') THEN 4
        WHEN level = 'L7' THEN 5
        WHEN level = 'L6' THEN 6
        WHEN level = 'L5' THEN 7
        ELSE 8
      END,
      LENGTH(COALESCE(lower_leaves, '')) DESC
    LIMIT 1
  `, [resolvedZone, resolvedZone]);

  if (dynamicZH) {
    return {
      zone: resolvedZone,
      zh_name: dynamicZH.emp_name,
      zh_code: dynamicZH.dns_emp_code || dynamicZH.emp_code,
      emp_code: dynamicZH.emp_code,
      designation: dynamicZH.designation,
      level: dynamicZH.level,
      resolvedBy: 'DYNAMIC_EMPLOYEE_MASTER'
    };
  }

  return {
    zone: resolvedZone,
    zh_name: null,
    zh_code: null,
    emp_code: null,
    designation: null,
    level: null,
    resolvedBy: 'FAILED'
  };
}

/**
 * Heal / backfill missing Zonal Heads across master_dealers, master_dealer_so_mapping, and dealer_visit_targets.
 *
 * @returns {Promise<{ dealersHealed: number, mappingsHealed: number, targetsHealed: number }>}
 */
export async function healAllMissingZonalHeads() {
  console.log('[ZonalHeadService] Starting healing of missing Zonal Heads across all tables...');

  // 1. Populate missing zone on master_dealers from region or area
  await dbRun(`
    UPDATE master_dealers
    SET zone = CASE
      WHEN UPPER(TRIM(region)) LIKE '%NE2%' OR UPPER(TRIM(region)) LIKE '%NE-2%' THEN 'NE2'
      WHEN UPPER(TRIM(region)) LIKE '%NE1%' OR UPPER(TRIM(region)) LIKE '%NE-1%' THEN 'NE1'
      WHEN UPPER(TRIM(region)) LIKE '%NB2%' OR UPPER(TRIM(region)) LIKE '%NB-2%' THEN 'NB2'
      WHEN UPPER(TRIM(region)) LIKE '%NB1%' OR UPPER(TRIM(region)) LIKE '%NB-1%' OR UPPER(TRIM(region)) LIKE '%NORTH BENGAL%' THEN 'NB1'
      WHEN UPPER(TRIM(region)) LIKE '%SOUTH BENGAL%' OR UPPER(TRIM(region)) = 'SB' THEN 'SOUTH BENGAL'
      WHEN UPPER(TRIM(region)) LIKE '%BIHAR%' OR UPPER(TRIM(region)) LIKE '%BH-%' THEN 'BIHAR'
      WHEN UPPER(TRIM(area)) IN ('AGARTALA', 'UDAIPUR', 'SILCHAR', 'TRIPURA', 'MIZORAM') THEN 'NE2'
      WHEN UPPER(TRIM(area)) IN ('GUWAHATI', 'NAGAON', 'JORHAT', 'TEZPUR', 'DIBRUGARH', 'TINSUKIA', 'SHILLONG', 'LAKHIMPUR') THEN 'NE1'
      WHEN UPPER(TRIM(area)) IN ('SILIGURI', 'JALPAIGURI', 'COOCHBEHAR', 'ALIPURDUAR', 'SIKKIM') THEN 'NB1'
      WHEN UPPER(TRIM(area)) IN ('MALDA', 'DAKSHIN DINAJPUR', 'UTTAR DINAJPUR') THEN 'NB2'
      WHEN UPPER(TRIM(area)) IN ('KOLKATA', 'HOWRAH', 'HOOGHLY', 'BURDWAN', 'MIDNAPORE') THEN 'SOUTH BENGAL'
      WHEN UPPER(TRIM(area)) IN ('PATNA', 'MUZAFFARPUR', 'BHAGALPUR', 'PURNIA', 'KATIHAR') THEN 'BIHAR'
      ELSE COALESCE(zone, region, 'NE2')
    END
    WHERE zone IS NULL OR zone = '' OR zone = '-'
  `);

  // 2. Heal master_dealers
  const resDealers = await dbRun(`
    UPDATE master_dealers d
    JOIN master_zone_zh_mapping z ON (
      UPPER(TRIM(d.zone)) = UPPER(TRIM(z.zone_code))
      OR UPPER(TRIM(d.region)) = UPPER(TRIM(z.zone_code))
      OR FIND_IN_SET(UPPER(TRIM(d.area)), z.area_keywords) > 0
      OR FIND_IN_SET(UPPER(TRIM(d.dm_area)), z.area_keywords) > 0
    )
    SET
      d.zh_name = z.zh_name,
      d.zh_code = z.zh_code,
      d.zone = z.zone_code
    WHERE d.zh_name IS NULL OR d.zh_name = '' OR d.zh_name = '-'
  `);

  // 3. Heal master_dealer_so_mapping
  const resMappings = await dbRun(`
    UPDATE master_dealer_so_mapping m
    JOIN master_zone_zh_mapping z ON (
      UPPER(TRIM(m.region)) = UPPER(TRIM(z.zone_code))
      OR UPPER(TRIM(m.zone)) = UPPER(TRIM(z.zone_code))
      OR FIND_IN_SET(UPPER(TRIM(m.area)), z.area_keywords) > 0
    )
    SET
      m.zh_name = z.zh_name,
      m.zh_code = z.zh_code,
      m.zone = z.zone_code
    WHERE m.zh_name IS NULL OR m.zh_name = '' OR m.zh_name = '-'
  `);

  // 4. Heal dealer_visit_targets from master_dealers
  const resTargets = await dbRun(`
    UPDATE dealer_visit_targets t
    JOIN master_dealers d ON t.dealer_id = d.id OR (t.sap_code IS NOT NULL AND t.sap_code = d.sap_code)
    SET
      t.zh_name = d.zh_name,
      t.zh_code = d.zh_code
    WHERE (t.zh_name IS NULL OR t.zh_name = '' OR t.zh_name = '-')
      AND d.zh_name IS NOT NULL AND d.zh_name != '' AND d.zh_name != '-'
  `);

  // 5. Also update master_employees role for Zonal Heads
  await dbRun(`
    UPDATE master_employees me
    JOIN master_zone_zh_mapping z ON (me.emp_code = z.zh_code OR me.emp_code = z.emp_code)
    SET me.role = 'ZH', me.designation = z.designation, me.zone = z.zone_code
  `);

  console.log(`[ZonalHeadService] Healing complete. Dealers healed: ${resDealers.affectedRows || 0}, Mappings: ${resMappings.affectedRows || 0}, Targets: ${resTargets.affectedRows || 0}`);

  return {
    dealersHealed: resDealers.affectedRows || resDealers.changes || 0,
    mappingsHealed: resMappings.affectedRows || resMappings.changes || 0,
    targetsHealed: resTargets.affectedRows || resTargets.changes || 0
  };
}

/**
 * Get list of all zone to ZH mappings.
 */
export async function getAllZonalHeadMappings() {
  const rows = await dbAll(`
    SELECT id, zone_code, zone_name, zh_name, zh_code, emp_code, designation, level, state, area_keywords, updated_at
    FROM master_zone_zh_mapping
    ORDER BY zone_code ASC
  `);
  return rows;
}
