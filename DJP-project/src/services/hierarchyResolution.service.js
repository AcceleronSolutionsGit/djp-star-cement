import { dbGet } from '../config/database.js';
import { resolveZonalHead } from './zonalHead.service.js';

/**
 * Resolve Upper Hierarchy (ZH, RSM, and ASM) for a Prospective Dealer.
 *
 * @param {Object} params
 * @param {string} [params.soEmpCode]
 * @param {string} [params.soName]
 * @param {string} [params.area]
 * @param {string} [params.zone]
 * @param {string} [params.region]
 * @returns {Promise<{ zh_name: string|null, zh_code: string|null, rsm_name: string|null, rsm_code: string|null, asm_name: string|null, asm_code: string|null, so_name: string|null, so_emp_code: string|null, method: string }>}
 */
export async function resolveProspectHierarchy({ soEmpCode, soName, area, zone, region } = {}) {
  const cleanSo = (soName || '').trim();
  const cleanEmpCode = (soEmpCode || '').trim();
  const cleanArea = (area || '').trim();
  const cleanZone = (zone || region || '').trim();

  let zh_name = null;
  let zh_code = null;
  let rsm_name = null;
  let rsm_code = null;
  let asm_name = null;
  let asm_code = null;
  let res_so_name = cleanSo || null;
  let res_so_emp_code = cleanEmpCode || null;
  let method = 'NONE';

  const cleanVal = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    return (s === '' || s === '-' || s.toUpperCase() === 'NA' || s.toUpperCase() === 'N/A' || s.toUpperCase() === 'NULL') ? null : s;
  };

  const applyMapping = (m, mthd) => {
    if (!m) return;
    if (!zh_name && cleanVal(m.zh_name)) { zh_name = cleanVal(m.zh_name); zh_code = cleanVal(m.zh_code); }
    if (!rsm_name && cleanVal(m.rsm_name)) { rsm_name = cleanVal(m.rsm_name); rsm_code = cleanVal(m.rsm_code); }
    if (!asm_name && cleanVal(m.asm_name)) { asm_name = cleanVal(m.asm_name); asm_code = cleanVal(m.asm_code); }
    if (!res_so_name && cleanVal(m.so_name)) res_so_name = cleanVal(m.so_name);
    if (!res_so_emp_code && cleanVal(m.so_emp_code)) res_so_emp_code = cleanVal(m.so_emp_code);
    if (method === 'NONE') method = mthd;
  };

  const isComplete = () => Boolean(zh_name && rsm_name && asm_name && res_so_name);

  // 1. By SO employee code in master_dealer_so_mapping
  if (cleanEmpCode && !isComplete()) {
    const m = await dbGet(
      `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
       FROM master_dealer_so_mapping 
       WHERE so_emp_code = ? 
       ORDER BY 
         (CASE WHEN asm_name IS NOT NULL AND asm_name != '' AND asm_name != '-' THEN 0 ELSE 1 END),
         (CASE WHEN rsm_name IS NOT NULL AND rsm_name != '' AND rsm_name != '-' THEN 0 ELSE 1 END),
         (CASE WHEN zh_name IS NOT NULL AND zh_name != '' AND zh_name != '-' THEN 0 ELSE 1 END)
       LIMIT 1`,
      [cleanEmpCode]
    );
    applyMapping(m, 'SO_CODE');
  }

  // 2. Exact or prefix SO name match in master_dealer_so_mapping
  if (cleanSo && !isComplete()) {
    const soPrefix = cleanSo.split('-')[0].trim();
    const m = await dbGet(
      `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
       FROM master_dealer_so_mapping 
       WHERE LOWER(TRIM(so_name)) = LOWER(?) 
          OR so_name LIKE ? 
          OR LOWER(SUBSTRING_INDEX(so_name, '-', 1)) = LOWER(?)
       ORDER BY 
         (CASE WHEN asm_name IS NOT NULL AND asm_name != '' AND asm_name != '-' THEN 0 ELSE 1 END),
         (CASE WHEN rsm_name IS NOT NULL AND rsm_name != '' AND rsm_name != '-' THEN 0 ELSE 1 END),
         (CASE WHEN zh_name IS NOT NULL AND zh_name != '' AND zh_name != '-' THEN 0 ELSE 1 END)
       LIMIT 1`,
      [cleanSo, `${soPrefix}%`, soPrefix]
    );
    applyMapping(m, 'SO_NAME');
  }

  // 3. Search in master_dealers by SO (in case mapping table has partial data)
  if (!isComplete() && (cleanEmpCode || cleanSo)) {
    const soPrefix = cleanSo.split('-')[0].trim();
    const m = await dbGet(
      `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
       FROM master_dealers 
       WHERE (so_emp_code = ? OR LOWER(TRIM(so_name)) = LOWER(?) OR so_name LIKE ?)
       ORDER BY 
         (CASE WHEN asm_name IS NOT NULL AND asm_name != '' AND asm_name != '-' THEN 0 ELSE 1 END),
         (CASE WHEN rsm_name IS NOT NULL AND rsm_name != '' AND rsm_name != '-' THEN 0 ELSE 1 END),
         (CASE WHEN zh_name IS NOT NULL AND zh_name != '' AND zh_name != '-' THEN 0 ELSE 1 END)
       LIMIT 1`,
      [cleanEmpCode || '', cleanSo || '', `${soPrefix}%`]
    );
    applyMapping(m, 'MASTER_DEALERS_SO');
  }

  // 4. Area match in master_dealer_so_mapping
  if (cleanArea && !isComplete()) {
    const m = await dbGet(
      `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
       FROM master_dealer_so_mapping 
       WHERE LOWER(TRIM(area)) = LOWER(?) OR LOWER(TRIM(branch)) = LOWER(?) OR LOWER(TRIM(territory_name)) = LOWER(?)
       ORDER BY 
         (CASE WHEN asm_name IS NOT NULL AND asm_name != '' AND asm_name != '-' THEN 0 ELSE 1 END),
         (CASE WHEN rsm_name IS NOT NULL AND rsm_name != '' AND rsm_name != '-' THEN 0 ELSE 1 END),
         (CASE WHEN zh_name IS NOT NULL AND zh_name != '' AND zh_name != '-' THEN 0 ELSE 1 END)
       LIMIT 1`,
      [cleanArea, cleanArea, cleanArea]
    );
    applyMapping(m, 'AREA');
  }

  // 5. Area match in master_dealers
  if (cleanArea && !isComplete()) {
    const m = await dbGet(
      `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
       FROM master_dealers 
       WHERE (LOWER(TRIM(area)) = LOWER(?) OR LOWER(TRIM(dm_area)) = LOWER(?) OR LOWER(TRIM(branch)) = LOWER(?))
       ORDER BY 
         (CASE WHEN asm_name IS NOT NULL AND asm_name != '' AND asm_name != '-' THEN 0 ELSE 1 END),
         (CASE WHEN rsm_name IS NOT NULL AND rsm_name != '' AND rsm_name != '-' THEN 0 ELSE 1 END),
         (CASE WHEN zh_name IS NOT NULL AND zh_name != '' AND zh_name != '-' THEN 0 ELSE 1 END)
       LIMIT 1`,
      [cleanArea, cleanArea, cleanArea]
    );
    applyMapping(m, 'MASTER_DEALERS_AREA');
  }

  // 6a. Region match in master_dealer_so_mapping (uses region column)
  if (cleanZone && !isComplete()) {
    try {
      const m = await dbGet(
        `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
         FROM master_dealer_so_mapping 
         WHERE LOWER(TRIM(region)) = LOWER(?)
         ORDER BY 
           (CASE WHEN asm_name IS NOT NULL AND asm_name != '' AND asm_name != '-' THEN 0 ELSE 1 END),
           (CASE WHEN rsm_name IS NOT NULL AND rsm_name != '' AND rsm_name != '-' THEN 0 ELSE 1 END),
           (CASE WHEN zh_name IS NOT NULL AND zh_name != '' AND zh_name != '-' THEN 0 ELSE 1 END)
         LIMIT 1`,
        [cleanZone]
      );
      applyMapping(m, 'REGION_MAPPING');
    } catch (e) {
      // Ignored
    }
  }

  // 6b. Zone / Region match in master_dealers (which has both zone and region)
  if (cleanZone && !isComplete()) {
    try {
      const m = await dbGet(
        `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
         FROM master_dealers 
         WHERE LOWER(TRIM(region)) = LOWER(?) OR LOWER(TRIM(zone)) = LOWER(?)
         ORDER BY 
           (CASE WHEN asm_name IS NOT NULL AND asm_name != '' AND asm_name != '-' THEN 0 ELSE 1 END),
           (CASE WHEN rsm_name IS NOT NULL AND rsm_name != '' AND rsm_name != '-' THEN 0 ELSE 1 END),
           (CASE WHEN zh_name IS NOT NULL AND zh_name != '' AND zh_name != '-' THEN 0 ELSE 1 END)
         LIMIT 1`,
        [cleanZone, cleanZone]
      );
      applyMapping(m, 'MASTER_DEALERS_ZONE');
    } catch (e) {
      // Ignored
    }
  }

  // 7. Fallback from master_employees by designation (safe against missing columns)
  if (!asm_name) {
    try {
      const asmEmp = await dbGet(
        `SELECT emp_name as asm_name, emp_code as asm_code FROM master_employees 
         WHERE designation IN ('ASM', 'AREA SALES MANAGER', 'AREA_SALES_MANAGER') 
         LIMIT 1`
      );
      if (asmEmp) {
        asm_name = asmEmp.asm_name || null;
        asm_code = asmEmp.asm_code || null;
      }
    } catch (e) {}
  }

  // RSM / ZH fallback from master_employees if still missing
  if (!rsm_name) {
    try {
      const rsm = await dbGet(
        `SELECT emp_name as rsm_name, emp_code as rsm_code FROM master_employees 
         WHERE designation IN ('RSM', 'REGIONAL SALES MANAGER', 'REGIONAL_SALES_MANAGER') 
         LIMIT 1`
      );
      if (rsm) { rsm_name = rsm.rsm_name; rsm_code = rsm.rsm_code; }
    } catch (e) {}
  }
  if (!zh_name || !zh_code) {
    try {
      const zhRes = await resolveZonalHead({ zone: cleanZone, region, area: cleanArea });
      if (zhRes?.zh_name) {
        if (!zh_name) zh_name = zhRes.zh_name;
        if (!zh_code) zh_code = zhRes.zh_code;
      }
    } catch (e) {}
  }

  // Resolve missing asm_code if asm_name is known
  if (asm_name && !asm_code) {
    const emp = await dbGet(
      `SELECT emp_code FROM master_employees WHERE LOWER(TRIM(emp_name)) = LOWER(TRIM(?)) AND emp_code IS NOT NULL LIMIT 1`,
      [asm_name]
    );
    if (emp?.emp_code) {
      asm_code = emp.emp_code;
    } else {
      const mapEmp = await dbGet(
        `SELECT asm_code FROM master_dealer_so_mapping WHERE LOWER(TRIM(asm_name)) = LOWER(TRIM(?)) AND asm_code IS NOT NULL AND asm_code != '' AND asm_code != '-' LIMIT 1`,
        [asm_name]
      );
      if (mapEmp?.asm_code) asm_code = mapEmp.asm_code;
    }
  }

  // Resolve missing so_emp_code if so_name is known
  const finalSoName = res_so_name || cleanSo;
  let finalSoCode = res_so_emp_code || cleanEmpCode;
  if (finalSoName && !finalSoCode) {
    const emp = await dbGet(
      `SELECT emp_code FROM master_employees WHERE LOWER(TRIM(emp_name)) = LOWER(TRIM(?)) AND emp_code IS NOT NULL LIMIT 1`,
      [finalSoName]
    );
    if (emp?.emp_code) {
      finalSoCode = emp.emp_code;
    } else {
      const mapEmp = await dbGet(
        `SELECT so_emp_code FROM master_dealer_so_mapping WHERE LOWER(TRIM(so_name)) = LOWER(TRIM(?)) AND so_emp_code IS NOT NULL AND so_emp_code != '' AND so_emp_code != '-' LIMIT 1`,
        [finalSoName]
      );
      if (mapEmp?.so_emp_code) finalSoCode = mapEmp.so_emp_code;
    }
  }

  return {
    zh_name: zh_name || null,
    zh_code: zh_code || null,
    rsm_name: rsm_name || null,
    rsm_code: rsm_code || null,
    asm_name: asm_name || null,
    asm_code: asm_code || null,
    so_name: finalSoName || null,
    so_emp_code: finalSoCode || null,
    method: method || 'FALLBACK'
  };
}
