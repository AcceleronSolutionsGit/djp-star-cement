import { dbGet } from '../config/database.js';

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

  // 1. Match by SO employee code in master_dealer_so_mapping
  if (cleanEmpCode) {
    const m = await dbGet(
      `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
       FROM master_dealer_so_mapping 
       WHERE so_emp_code = ? AND zh_name IS NOT NULL AND rsm_name IS NOT NULL 
       LIMIT 1`,
      [cleanEmpCode]
    );
    if (m) {
      return {
        zh_name: m.zh_name || null,
        zh_code: m.zh_code || null,
        rsm_name: m.rsm_name || null,
        rsm_code: m.rsm_code || null,
        asm_name: m.asm_name || null,
        asm_code: m.asm_code || null,
        so_name: m.so_name || cleanSo || null,
        so_emp_code: m.so_emp_code || cleanEmpCode || null,
        method: 'SO_CODE'
      };
    }
  }

  // 2. Exact SO name match
  if (cleanSo) {
    const m = await dbGet(
      `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
       FROM master_dealer_so_mapping 
       WHERE LOWER(TRIM(so_name)) = LOWER(?) AND zh_name IS NOT NULL AND rsm_name IS NOT NULL 
       LIMIT 1`,
      [cleanSo]
    );
    if (m) {
      return {
        zh_name: m.zh_name || null,
        zh_code: m.zh_code || null,
        rsm_name: m.rsm_name || null,
        rsm_code: m.rsm_code || null,
        asm_name: m.asm_name || null,
        asm_code: m.asm_code || null,
        so_name: m.so_name || cleanSo || null,
        so_emp_code: m.so_emp_code || cleanEmpCode || null,
        method: 'EXACT_SO'
      };
    }

    // 3. Prefix / like SO match (e.g. "SANDIP DEY-AGA" matches "SANDIP DEY-AGARTALA")
    const soPrefix = cleanSo.split('-')[0].trim();
    const mPrefix = await dbGet(
      `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
       FROM master_dealer_so_mapping 
       WHERE (so_name LIKE ? OR LOWER(SUBSTRING_INDEX(so_name, '-', 1)) = LOWER(?)) 
         AND zh_name IS NOT NULL AND rsm_name IS NOT NULL 
       LIMIT 1`,
      [`${soPrefix}%`, soPrefix]
    );
    if (mPrefix) {
      return {
        zh_name: mPrefix.zh_name || null,
        zh_code: mPrefix.zh_code || null,
        rsm_name: mPrefix.rsm_name || null,
        rsm_code: mPrefix.rsm_code || null,
        asm_name: mPrefix.asm_name || null,
        asm_code: mPrefix.asm_code || null,
        so_name: mPrefix.so_name || cleanSo || null,
        so_emp_code: mPrefix.so_emp_code || cleanEmpCode || null,
        method: 'PREFIX_SO'
      };
    }
  }

  // 4. Area match
  if (cleanArea) {
    const m = await dbGet(
      `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
       FROM master_dealer_so_mapping 
       WHERE (LOWER(TRIM(area)) = LOWER(?) OR LOWER(TRIM(territory_name)) = LOWER(?)) 
         AND zh_name IS NOT NULL AND rsm_name IS NOT NULL 
       LIMIT 1`,
      [cleanArea, cleanArea]
    );
    if (m) {
      return {
        zh_name: m.zh_name || null,
        zh_code: m.zh_code || null,
        rsm_name: m.rsm_name || null,
        rsm_code: m.rsm_code || null,
        asm_name: m.asm_name || null,
        asm_code: m.asm_code || null,
        so_name: cleanSo || m.so_name || null,
        so_emp_code: cleanEmpCode || m.so_emp_code || null,
        method: 'AREA'
      };
    }
  }

  // 5. Region / Zone match from master_dealer_so_mapping
  if (cleanZone) {
    const m = await dbGet(
      `SELECT zh_name, zh_code, rsm_name, rsm_code, asm_name, asm_code, so_name, so_emp_code 
       FROM master_dealer_so_mapping 
       WHERE LOWER(TRIM(region)) = LOWER(?) 
         AND zh_name IS NOT NULL AND rsm_name IS NOT NULL 
       LIMIT 1`,
      [cleanZone]
    );
    if (m) {
      return {
        zh_name: m.zh_name || null,
        zh_code: m.zh_code || null,
        rsm_name: m.rsm_name || null,
        rsm_code: m.rsm_code || null,
        asm_name: m.asm_name || null,
        asm_code: m.asm_code || null,
        so_name: cleanSo || m.so_name || null,
        so_emp_code: cleanEmpCode || m.so_emp_code || null,
        method: 'REGION_MAPPING'
      };
    }
  }

  // 6. Fallback from master_employees by zone / region
  let zh = null;
  let rsm = null;
  let asm = null;
  if (cleanZone) {
    zh = await dbGet(
      `SELECT emp_name as zh_name, emp_code as zh_code FROM master_employees 
       WHERE designation IN ('ZH', 'ZONAL HEAD', 'ZONAL_HEAD') AND (LOWER(TRIM(zone)) = LOWER(?) OR LOWER(TRIM(region)) = LOWER(?)) 
       LIMIT 1`,
      [cleanZone, cleanZone]
    );
    rsm = await dbGet(
      `SELECT emp_name as rsm_name, emp_code as rsm_code FROM master_employees 
       WHERE designation IN ('RSM', 'REGIONAL SALES MANAGER', 'REGIONAL_SALES_MANAGER') AND (LOWER(TRIM(zone)) = LOWER(?) OR LOWER(TRIM(region)) = LOWER(?)) 
       LIMIT 1`,
      [cleanZone, cleanZone]
    );
    asm = await dbGet(
      `SELECT emp_name as asm_name, emp_code as asm_code FROM master_employees 
       WHERE designation IN ('ASM', 'AREA SALES MANAGER', 'AREA_SALES_MANAGER') AND (LOWER(TRIM(zone)) = LOWER(?) OR LOWER(TRIM(region)) = LOWER(?)) 
       LIMIT 1`,
      [cleanZone, cleanZone]
    );
  }

  // 7. Global default ZH, RSM, ASM if only one exists in system
  if (!zh) {
    zh = await dbGet(
      `SELECT emp_name as zh_name, emp_code as zh_code FROM master_employees 
       WHERE designation IN ('ZH', 'ZONAL HEAD', 'ZONAL_HEAD') 
       LIMIT 1`
    );
  }
  if (!rsm) {
    rsm = await dbGet(
      `SELECT emp_name as rsm_name, emp_code as rsm_code FROM master_employees 
       WHERE designation IN ('RSM', 'REGIONAL SALES MANAGER', 'REGIONAL_SALES_MANAGER') 
       LIMIT 1`
    );
  }
  if (!asm) {
    asm = await dbGet(
      `SELECT emp_name as asm_name, emp_code as asm_code FROM master_employees 
       WHERE designation IN ('ASM', 'AREA SALES MANAGER', 'AREA_SALES_MANAGER') 
       LIMIT 1`
    );
  }

  return {
    zh_name: zh?.zh_name || null,
    zh_code: zh?.zh_code || null,
    rsm_name: rsm?.rsm_name || null,
    rsm_code: rsm?.rsm_code || null,
    asm_name: asm?.asm_name || null,
    asm_code: asm?.asm_code || null,
    so_name: cleanSo || null,
    so_emp_code: cleanEmpCode || null,
    method: 'EMPLOYEE_FALLBACK'
  };
}
}
