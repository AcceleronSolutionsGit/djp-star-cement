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
 * Exhaustive Branch / Area to Zone mapping across all operational zones.
 */
export const BRANCH_ZONE_MAP = {
  // --- Zone NE2 (Barak Valley, Tripura, Mizoram) -> BRIJESH SINGH ---
  'AGARTALA': 'NE2',
  'UDAIPUR': 'NE2',
  'DHARMANAGAR': 'NE2',
  'MIZORAM': 'NE2',
  'SILCHAR - CACHAR': 'NE2',
  'SILCHAR - HAILAKANDI': 'NE2',
  'SILCHAR - KARIMGANJ': 'NE2',
  'SILCHAR': 'NE2',
  'CACHAR': 'NE2',
  'HAILAKANDI': 'NE2',
  'KARIMGANJ': 'NE2',
  'TRIPURA': 'NE2',
  'AIZAWL': 'NE2',
  'KAILASHAHAR': 'NE2',
  'BELONIA': 'NE2',
  'AMBASSA': 'NE2',
  'TELIAMURA': 'NE2',
  'BISHALGARH': 'NE2',
  'SANTIRBAZAR': 'NE2',
  'KHOWAI': 'NE2',
  'MOHANPUR': 'NE2',

  // --- Zone NE1 (Upper & Lower Assam, Meghalaya, Arunachal, Nagaland, Manipur) -> TARAK NATH GHOSH ---
  'AP - BANDERDEWA': 'NE1',
  'AP - BHALUKPONG': 'NE1',
  'AP - LIKABALI': 'NE1',
  'AP - TINSUKIA': 'NE1',
  'ARUNACHAL': 'NE1',
  'ARUNACHAL PRADESH': 'NE1',
  'ITANAGAR': 'NE1',
  'NAHARLAGUN': 'NE1',
  'PASIGHAT': 'NE1',
  'ALONG': 'NE1',
  'KHONSA': 'NE1',
  'ZIRO': 'NE1',
  'BISWANATH': 'NE1',
  'DARANG': 'NE1',
  'DARRANG': 'NE1',
  'MANGALDOI': 'NE1',
  'DHEMAJI': 'NE1',
  'DIBRUGARH': 'NE1',
  'GOLAGHAT': 'NE1',
  'GUWAHATI': 'NE1',
  'GUWAHATI RURAL': 'NE1',
  'GUWAHATI URBAN': 'NE1',
  'HOJAI': 'NE1',
  'JAINTIA HILLS': 'NE1',
  'JORHAT': 'NE1',
  'KARBI ANGLONG': 'NE1',
  'DIPHU': 'NE1',
  'LAKHIMPUR': 'NE1',
  'NORTH LAKHIMPUR': 'NE1',
  'LOWER ASSAM 1': 'NE1',
  'LOWER ASSAM 2': 'NE1',
  'LOWER ASSAM 3': 'NE1',
  'LOWER ASSAM': 'NE1',
  'BONGAIGAON': 'NE1',
  'BARPETA': 'NE1',
  'NALBARI': 'NE1',
  'KOKRAJHAR': 'NE1',
  'DHUBRI': 'NE1',
  'GOALPARA': 'NE1',
  'BAKSA': 'NE1',
  'CHIRANG': 'NE1',
  'MANIPUR': 'NE1',
  'IMPHAL': 'NE1',
  'MORIGAON': 'NE1',
  'N C HILLS': 'NE1',
  'NORTH CACHAR HILLS': 'NE1',
  'DIMA HASAO': 'NE1',
  'HAFLONG': 'NE1',
  'NAGALAND': 'NE1',
  'KOHIMA': 'NE1',
  'DIMAPUR': 'NE1',
  'NAGAON': 'NE1',
  'SHILLONG': 'NE1',
  'MEGHALAYA': 'NE1',
  'SIBSAGAR': 'NE1',
  'SIVASAGAR': 'NE1',
  'TEZPUR': 'NE1',
  'SONITPUR': 'NE1',
  'TINSUKIA': 'NE1',
  'DOOMDOOMA': 'NE1',
  'DIGBOI': 'NE1',
  'TURA HILLS': 'NE1',
  'TURA PLAIN': 'NE1',
  'TURA': 'NE1',
  'WEST GARO HILLS': 'NE1',
  'EAST GARO HILLS': 'NE1',

  // --- Zone NB1 (North Bengal 1 - Siliguri, Jalpaiguri, Coochbehar, Sikkim) -> DIBYAJYOTI GUHA ---
  'SILIGURI': 'NB1',
  'JALPAIGURI': 'NB1',
  'COOCHBEHAR': 'NB1',
  'COOCH BEHAR': 'NB1',
  'ALIPURDUAR': 'NB1',
  'DARJEELING HILLS': 'NB1',
  'DARJEELING PLAINS': 'NB1',
  'DARJEELING': 'NB1',
  'KURSEONG': 'NB1',
  'KALIMPONG': 'NB1',
  'SIKKIM': 'NB1',
  'GANGTOK': 'NB1',

  // --- Zone NB2 (North Bengal 2 - Malda, Dinajpur) -> DIBYAJYOTI GUHA ---
  'MALDA': 'NB2',
  'DAKSHIN DINAJPUR': 'NB2',
  'UTTAR DINAJPUR': 'NB2',
  'BALURGHAT': 'NB2',
  'RAIGANJ': 'NB2',
  'ISLAMPUR': 'NB2',
  'CHANCHAL': 'NB2',

  // --- Zone BIHAR (Patna, Muzaffarpur, Bhagalpur, Purnia) -> RAJESH SRIVASTAVA ---
  'PATNA': 'BIHAR',
  'MUZAFFARPUR': 'BIHAR',
  'BHAGALPUR': 'BIHAR',
  'PURNIA': 'BIHAR',
  'BEGUSARAI': 'BIHAR',
  'DARBHANGA': 'BIHAR',
  'GAYA': 'BIHAR',
  'KATIHAR': 'BIHAR',
  'KISHANGANJ': 'BIHAR',
  'ARARIA': 'BIHAR',
  'SAHARSA': 'BIHAR',
  'SUPAUL': 'BIHAR',
  'MADHEPURA': 'BIHAR',
  'SAMASTIPUR': 'BIHAR',
  'MOTIHARI': 'BIHAR',
  'BETTIAH': 'BIHAR',
  'SITAMARHI': 'BIHAR',
  'SIWAN': 'BIHAR',
  'CHHAPRA': 'BIHAR',
  'BIHAR': 'BIHAR',
  'BH': 'BIHAR',
  'BH1': 'BIHAR',
  'BH2': 'BIHAR',
  'BH-1': 'BIHAR',
  'BH-2': 'BIHAR',

  // --- Zone SOUTH BENGAL -> ATANU BANERJEE ---
  'KOLKATA': 'SOUTH BENGAL',
  'HOWRAH': 'SOUTH BENGAL',
  'HOOGHLY': 'SOUTH BENGAL',
  'BURDWAN': 'SOUTH BENGAL',
  'MIDNAPORE': 'SOUTH BENGAL',
  'SOUTH 24 PARGANAS': 'SOUTH BENGAL',
  'NORTH 24 PARGANAS': 'SOUTH BENGAL',
  'DURGAPUR': 'SOUTH BENGAL',
  'ASANSOL': 'SOUTH BENGAL',
  'BANKURA': 'SOUTH BENGAL',
  'PURULIA': 'SOUTH BENGAL',
  'BIRBHUM': 'SOUTH BENGAL',
  'NADIA': 'SOUTH BENGAL',
  'MURSHIDABAD': 'SOUTH BENGAL',
  'SOUTH BENGAL': 'SOUTH BENGAL',
  'WEST BENGAL': 'SOUTH BENGAL',

  // --- Non Trade -> ABHISHEK JOSHI ---
  'NON TRADE': 'NT',
  'NON-TRADE': 'NT',
  'INSTITUTIONAL': 'NT',
  'PROJECTS': 'NT',
  'NT': 'NT'
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

  // 1. Direct dictionary match in BRANCH_ZONE_MAP
  if (BRANCH_ZONE_MAP[cleanArea]) {
    return BRANCH_ZONE_MAP[cleanArea];
  }

  // 2. Substring / partial match in BRANCH_ZONE_MAP
  for (const [branchName, zoneCode] of Object.entries(BRANCH_ZONE_MAP)) {
    if (cleanArea === branchName || cleanArea.includes(branchName) || branchName.includes(cleanArea)) {
      return zoneCode;
    }
  }

  // 3. Check keyword match in master_zone_zh_mapping
  const allMappings = await dbAll('SELECT zone_code, area_keywords FROM master_zone_zh_mapping');
  for (const m of allMappings) {
    if (!m.area_keywords) continue;
    const keywords = m.area_keywords.split(',').map(k => k.trim().toUpperCase());
    if (keywords.some(k => cleanArea === k || cleanArea.includes(k) || k.includes(cleanArea))) {
      return m.zone_code;
    }
  }

  // 4. Check if any existing dealer in master_dealers with this area has a known zone
  const dealerMatch = await dbGet(`
    SELECT COALESCE(NULLIF(zone, ''), NULLIF(region, '')) as found_zone
    FROM master_dealers
    WHERE (LOWER(TRIM(area)) = LOWER(?) OR LOWER(TRIM(dm_area)) = LOWER(?) OR LOWER(TRIM(branch)) = LOWER(?))
      AND (zone IS NOT NULL AND zone != '' OR region IS NOT NULL AND region != '')
    LIMIT 1
  `, [cleanArea, cleanArea, cleanArea]);

  if (dealerMatch?.found_zone) {
    const norm = normalizeZone(dealerMatch.found_zone);
    if (norm) return norm;
  }

  // 5. Check master_dealer_so_mapping
  const soMapMatch = await dbGet(`
    SELECT COALESCE(NULLIF(zone, ''), NULLIF(region, '')) as found_zone
    FROM master_dealer_so_mapping
    WHERE (LOWER(TRIM(area)) = LOWER(?) OR LOWER(TRIM(branch)) = LOWER(?))
      AND (zone IS NOT NULL AND zone != '' OR region IS NOT NULL AND region != '')
    LIMIT 1
  `, [cleanArea, cleanArea]);

  if (soMapMatch?.found_zone) {
    const norm = normalizeZone(soMapMatch.found_zone);
    if (norm) return norm;
  }

  // 6. Fallback based on state name if provided
  if (state) {
    const cleanState = String(state).trim().toUpperCase();
    if (cleanState.includes('TRIPURA') || cleanState.includes('MIZORAM') || cleanState.includes('SILCHAR')) return 'NE2';
    if (cleanState.includes('ASSAM') || cleanState.includes('MEGHALAYA') || cleanState.includes('NAGALAND') || cleanState.includes('MANIPUR') || cleanState.includes('ARUNACHAL')) return 'NE1';
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

  if (resolvedZone && ['NE1', 'NE2', 'NB1', 'NB2', 'BIHAR', 'SOUTH BENGAL', 'NT'].includes(resolvedZone)) {
    resolvedBy = 'EXPLICIT_ZONE';
  } else {
    // Attempt to infer from branch, area, dmArea, or state
    const effectiveArea = branch || area || dmArea;
    const inferred = await findZoneByArea(effectiveArea, state);
    if (inferred) {
      resolvedZone = inferred;
      resolvedBy = 'INFERRED_FROM_BRANCH_AREA';
    } else if (resolvedZone) {
      resolvedBy = 'PARTIAL_ZONE_FALLBACK';
    }
  }

  // Fallback to NE1 as corporate HQ default if no zone identified
  if (!resolvedZone) {
    resolvedZone = 'NE1';
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
  console.log('[ZonalHeadService] Checking for missing or invalid Zonal Heads...');

  try {
    const unhealed = await dbGet(`
      SELECT 
        (SELECT COUNT(*) FROM master_dealers WHERE zh_name IS NULL OR zh_name = '' OR zh_name = '-' OR zh_name LIKE 'Zonal Head%' OR zh_code = 'ZH001') as dealers,
        (SELECT COUNT(*) FROM master_dealer_so_mapping WHERE zh_name IS NULL OR zh_name = '' OR zh_name = '-' OR zh_name LIKE 'Zonal Head%' OR zh_code = 'ZH001') as mappings
    `);

    if ((!unhealed?.dealers || unhealed.dealers === 0) && (!unhealed?.mappings || unhealed.mappings === 0)) {
      console.log('[ZonalHeadService] ✓ All dealers and mappings already have canonical Zonal Heads.');
      return { dealersHealed: 0, mappingsHealed: 0, targetsHealed: 0 };
    }
  } catch (checkErr) {
    // Continue to full healing if check fails
  }

  console.log('[ZonalHeadService] Healing missing Zonal Heads across all tables...');

  // 1. Populate zone on master_dealers from branch, area, region, or dm_area
  await dbRun(`
    UPDATE master_dealers
    SET zone = CASE
      -- Explicit known zones
      WHEN UPPER(TRIM(region)) LIKE '%NE2%' OR UPPER(TRIM(region)) LIKE '%NE-2%' THEN 'NE2'
      WHEN UPPER(TRIM(region)) LIKE '%NE1%' OR UPPER(TRIM(region)) LIKE '%NE-1%' THEN 'NE1'
      WHEN UPPER(TRIM(region)) LIKE '%NB2%' OR UPPER(TRIM(region)) LIKE '%NB-2%' THEN 'NB2'
      WHEN UPPER(TRIM(region)) LIKE '%NB1%' OR UPPER(TRIM(region)) LIKE '%NB-1%' OR UPPER(TRIM(region)) LIKE '%NORTH BENGAL%' THEN 'NB1'
      WHEN UPPER(TRIM(region)) LIKE '%SOUTH BENGAL%' OR UPPER(TRIM(region)) = 'SB' THEN 'SOUTH BENGAL'
      WHEN UPPER(TRIM(region)) LIKE '%BIHAR%' OR UPPER(TRIM(region)) LIKE '%BH-%' THEN 'BIHAR'

      -- NE2 Branches / Areas (Tripura, Mizoram, Barak Valley)
      WHEN UPPER(TRIM(COALESCE(branch, area, dm_area, ''))) IN (
        'AGARTALA', 'UDAIPUR', 'DHARMANAGAR', 'MIZORAM', 'SILCHAR - CACHAR', 
        'SILCHAR - HAILAKANDI', 'SILCHAR - KARIMGANJ', 'SILCHAR', 'CACHAR', 
        'HAILAKANDI', 'KARIMGANJ', 'TRIPURA', 'AIZAWL', 'KAILASHAHAR', 
        'BELONIA', 'AMBASSA', 'TELIAMURA', 'BISHALGARH', 'SANTIRBAZAR', 'KHOWAI', 'MOHANPUR'
      ) THEN 'NE2'

      -- NE1 Branches / Areas (Assam, Meghalaya, Arunachal, Nagaland, Manipur)
      WHEN UPPER(TRIM(COALESCE(branch, area, dm_area, ''))) IN (
        'AP - BANDERDEWA', 'AP - BHALUKPONG', 'AP - LIKABALI', 'AP - TINSUKIA',
        'ARUNACHAL', 'ARUNACHAL PRADESH', 'ITANAGAR', 'NAHARLAGUN', 'PASIGHAT', 'ALONG', 'KHONSA', 'ZIRO',
        'BISWANATH', 'DARANG', 'DARRANG', 'MANGALDOI', 'DHEMAJI', 'DIBRUGARH', 'GOLAGHAT',
        'GUWAHATI', 'GUWAHATI RURAL', 'GUWAHATI URBAN', 'HOJAI', 'JAINTIA HILLS', 'JORHAT',
        'KARBI ANGLONG', 'DIPHU', 'LAKHIMPUR', 'NORTH LAKHIMPUR',
        'LOWER ASSAM 1', 'LOWER ASSAM 2', 'LOWER ASSAM 3', 'LOWER ASSAM',
        'BONGAIGAON', 'BARPETA', 'NALBARI', 'KOKRAJHAR', 'DHUBRI', 'GOALPARA', 'BAKSA', 'CHIRANG',
        'MANIPUR', 'IMPHAL', 'MORIGAON', 'N C HILLS', 'NORTH CACHAR HILLS', 'DIMA HASAO', 'HAFLONG',
        'NAGALAND', 'KOHIMA', 'DIMAPUR', 'NAGAON', 'SHILLONG', 'MEGHALAYA', 'SIBSAGAR', 'SIVASAGAR',
        'TEZPUR', 'SONITPUR', 'TINSUKIA', 'DOOMDOOMA', 'DIGBOI', 'TURA HILLS', 'TURA PLAIN', 'TURA',
        'WEST GARO HILLS', 'EAST GARO HILLS'
      ) THEN 'NE1'

      -- NB1 Branches / Areas (North Bengal 1 - Siliguri, Jalpaiguri, Coochbehar, Sikkim)
      WHEN UPPER(TRIM(COALESCE(branch, area, dm_area, ''))) IN (
        'SILIGURI', 'JALPAIGURI', 'COOCHBEHAR', 'COOCH BEHAR', 'ALIPURDUAR',
        'DARJEELING HILLS', 'DARJEELING PLAINS', 'DARJEELING', 'KURSEONG', 'KALIMPONG', 'SIKKIM', 'GANGTOK'
      ) THEN 'NB1'

      -- NB2 Branches / Areas (North Bengal 2 - Malda, Dinajpur)
      WHEN UPPER(TRIM(COALESCE(branch, area, dm_area, ''))) IN (
        'MALDA', 'DAKSHIN DINAJPUR', 'UTTAR DINAJPUR', 'BALURGHAT', 'RAIGANJ', 'ISLAMPUR', 'CHANCHAL'
      ) THEN 'NB2'

      -- BIHAR Branches / Areas
      WHEN UPPER(TRIM(COALESCE(branch, area, dm_area, ''))) IN (
        'PATNA', 'MUZAFFARPUR', 'BHAGALPUR', 'PURNIA', 'BEGUSARAI', 'DARBHANGA', 'GAYA',
        'KATIHAR', 'KISHANGANJ', 'ARARIA', 'SAHARSA', 'SUPAUL', 'MADHEPURA', 'SAMASTIPUR',
        'MOTIHARI', 'BETTIAH', 'SITAMARHI', 'SIWAN', 'CHHAPRA', 'BIHAR', 'BH', 'BH1', 'BH2', 'BH-1', 'BH-2'
      ) THEN 'BIHAR'

      -- SOUTH BENGAL Branches / Areas
      WHEN UPPER(TRIM(COALESCE(branch, area, dm_area, ''))) IN (
        'KOLKATA', 'HOWRAH', 'HOOGHLY', 'BURDWAN', 'MIDNAPORE', 'SOUTH 24 PARGANAS', 'NORTH 24 PARGANAS',
        'DURGAPUR', 'ASANSOL', 'BANKURA', 'PURULIA', 'BIRBHUM', 'NADIA', 'MURSHIDABAD', 'SOUTH BENGAL', 'WEST BENGAL'
      ) THEN 'SOUTH BENGAL'

      WHEN zone IN ('NE1', 'NE2', 'NB1', 'NB2', 'BIHAR', 'SOUTH BENGAL', 'NT') THEN zone
      WHEN region IN ('NE1', 'NE2', 'NB1', 'NB2', 'BIHAR', 'SOUTH BENGAL', 'NT') THEN region
      ELSE 'NE1'
    END
    WHERE zone IS NULL OR zone = '' OR zone = '-' OR zone LIKE 'NE %' OR zone = 'NE' OR zh_name LIKE 'Zonal Head%'
  `);

  // 2. Heal master_dealers with authoritative Zonal Head
  const resDealers = await dbRun(`
    UPDATE master_dealers d
    JOIN master_zone_zh_mapping z ON UPPER(TRIM(d.zone)) = UPPER(TRIM(z.zone_code))
    SET
      d.zh_name = z.zh_name,
      d.zh_code = z.zh_code
    WHERE d.zh_name != z.zh_name 
       OR d.zh_code != z.zh_code
       OR d.zh_name IS NULL 
       OR d.zh_name = '' 
       OR d.zh_name = '-' 
       OR d.zh_name LIKE 'Zonal Head%' 
       OR d.zh_code = 'ZH001'
       OR d.zh_code LIKE 'ZH%'
  `);

  // 3. Heal master_dealer_so_mapping zone & ZH
  await dbRun(`
    UPDATE master_dealer_so_mapping
    SET zone = CASE
      WHEN region IN ('NE1', 'NE2', 'NB1', 'NB2', 'BIHAR', 'SOUTH BENGAL', 'NT') THEN region
      WHEN UPPER(TRIM(COALESCE(branch, area, ''))) IN (
        'AGARTALA', 'UDAIPUR', 'DHARMANAGAR', 'MIZORAM', 'SILCHAR - CACHAR', 
        'SILCHAR - HAILAKANDI', 'SILCHAR - KARIMGANJ', 'SILCHAR', 'CACHAR', 'HAILAKANDI', 'KARIMGANJ', 'TRIPURA'
      ) THEN 'NE2'
      WHEN UPPER(TRIM(COALESCE(branch, area, ''))) IN (
        'SILIGURI', 'JALPAIGURI', 'COOCHBEHAR', 'COOCH BEHAR', 'ALIPURDUAR', 'DARJEELING HILLS', 'DARJEELING PLAINS', 'SIKKIM'
      ) THEN 'NB1'
      WHEN UPPER(TRIM(COALESCE(branch, area, ''))) IN ('MALDA', 'DAKSHIN DINAJPUR', 'UTTAR DINAJPUR', 'BALURGHAT') THEN 'NB2'
      WHEN UPPER(TRIM(COALESCE(branch, area, ''))) IN ('PATNA', 'MUZAFFARPUR', 'BHAGALPUR', 'PURNIA', 'KATIHAR') THEN 'BIHAR'
      WHEN UPPER(TRIM(COALESCE(branch, area, ''))) IN ('KOLKATA', 'HOWRAH', 'HOOGHLY', 'BURDWAN', 'DURGAPUR') THEN 'SOUTH BENGAL'
      ELSE 'NE1'
    END
    WHERE zone IS NULL OR zone = '' OR zone = '-' OR zone LIKE 'NE %' OR zone = 'NE' OR zh_name LIKE 'Zonal Head%' OR zh_name = 'BRIJESH SINGH' AND branch LIKE 'AP -%'
  `);

  const resMappings = await dbRun(`
    UPDATE master_dealer_so_mapping m
    JOIN master_zone_zh_mapping z ON UPPER(TRIM(m.zone)) = UPPER(TRIM(z.zone_code))
    SET
      m.zh_name = z.zh_name,
      m.zh_code = z.zh_code
    WHERE m.zh_name != z.zh_name
       OR m.zh_code != z.zh_code
       OR m.zh_name IS NULL 
       OR m.zh_name = '' 
       OR m.zh_name = '-' 
       OR m.zh_name LIKE 'Zonal Head%' 
       OR m.zh_code = 'ZH001'
       OR m.zh_code LIKE 'ZH%'
  `);

  // 4. Heal dealer_visit_targets from master_dealers
  const resTargets = await dbRun(`
    UPDATE dealer_visit_targets t
    JOIN master_dealers d ON t.dealer_id = d.id OR (t.sap_code IS NOT NULL AND t.sap_code = d.sap_code)
    SET
      t.zh_name = d.zh_name,
      t.zh_code = d.zh_code
    WHERE (t.zh_name IS NULL OR t.zh_name = '' OR t.zh_name = '-' OR t.zh_name LIKE 'Zonal Head%' OR t.zh_code = 'ZH001')
      AND d.zh_name IS NOT NULL AND d.zh_name != '' AND d.zh_name != '-' AND d.zh_name NOT LIKE 'Zonal Head%'
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
