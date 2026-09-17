import XLSX from 'xlsx';
import { dbRun, dbGet, dbAll } from '../config/database.js';
import { matchAndUpsertCanonicalDealer, logMatchingAudit } from '../engines/canonical-matching.engine.js';
import { normalizeString, normalizeCode, normalizeBranch, normalizeRegion } from '../engines/normalization.engine.js';
import path from 'path';

function normalizeHeader(h) {
  return String(h || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function importProspectDealers(filePath, batchCode = null) {
  console.log(`[PROSPECT_DEALERS] Processing from: ${filePath}`);
  const sourceFileName = path.basename(filePath);

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (!rawRows || rawRows.length < 2) {
    throw new Error(`[PROSPECT_DEALERS] File is empty or does not contain data rows.`);
  }

  let headerRowIdx = -1;
  let headers = [];
  for (let i = 0; i < Math.min(20, rawRows.length); i++) {
    const row = rawRows[i];
    if (!row) continue;
    const normalized = row.map(normalizeHeader);
    if (normalized.some(h => h.includes('prospect') || h.includes('sfa code') || h.includes('prospective'))) {
      headerRowIdx = i;
      headers = normalized;
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error(`[PROSPECT_DEALERS] Could not find header row.`);
  }

  const colMap = {};
  const headerMappings = {
    'zone': 'zone',
    'region': 'zone',
    'district': 'zone',
    'area': 'area',
    'branch/territory/area': 'area',
    'branch': 'area',
    'territory name': 'area',
    'territory code': 'territory_code',
    'taluka': 'taluka',
    'block': 'taluka',
    'sfa code': 'sfa_code',
    'sfa_code': 'sfa_code',
    'prospect code': 'sfa_code',
    'prospect_code': 'sfa_code',
    'prospective dealer name': 'prospect_name',
    'name of prospect dealer': 'prospect_name',
    'prospect name': 'prospect_name',
    'dealer name': 'prospect_name',
    'name of so': 'so_name',
    'so name': 'so_name',
    'so emp code': 'so_emp_code',
    'so code': 'so_emp_code',
    'potential': 'potential',
    'total counter potential': 'potential',
    'counter potential': 'potential',
    'status': 'status',
    'expected sale': 'expected_sale'
  };

  for (const [normHeader, canonicalField] of Object.entries(headerMappings)) {
    const idx = headers.indexOf(normHeader);
    if (idx !== -1 && !(canonicalField in colMap)) {
      colMap[canonicalField] = idx;
    }
  }

  const getCell = (row, field) => {
    const idx = colMap[field];
    if (idx === undefined || idx === -1) return null;
    const val = row[idx];
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    return s === '' || s === '-' ? null : s;
  };
  
  const getCellNum = (row, field) => {
    const idx = colMap[field];
    if (idx === undefined || idx === -1) return 0;
    const val = row[idx];
    if (val === null || val === undefined || String(val).trim() === '' || String(val).trim() === '-') return 0;
    const n = Number(val);
    return isNaN(n) ? 0 : n;
  };

  let insertedCount = 0;
  let invalidRows = 0;
  const warnings = [];
  const errors = [];

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;

    const zone = getCell(row, 'zone');
    const territoryCode = normalizeCode(getCell(row, 'territory_code'));
    let area = getCell(row, 'area');
    const taluka = getCell(row, 'taluka');
    const sfaCode = normalizeCode(getCell(row, 'sfa_code'));
    const prospectName = getCell(row, 'prospect_name');
    let soName = getCell(row, 'so_name');
    let soEmpCode = normalizeCode(getCell(row, 'so_emp_code'));
    const potential = getCellNum(row, 'potential');
    const expectedSale = getCellNum(row, 'expected_sale');

    if (!prospectName && !sfaCode) {
      invalidRows++;
      continue;
    }

    // Resolve SO Employee Code & Upper hierarchy from master_dealer_so_mapping / master_employees
    let asmName = null;
    let asmCode = null;
    let rsmName = null;
    let rsmCode = null;
    let zhName = null;
    let zhCode = null;

    if (soEmpCode) {
      const existingMapping = await dbGet(
        'SELECT so_name, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, area, territory_name FROM master_dealer_so_mapping WHERE so_emp_code = ? LIMIT 1',
        [soEmpCode]
      );
      if (existingMapping) {
        if (!soName) soName = existingMapping.so_name;
        asmName = existingMapping.asm_name;
        asmCode = existingMapping.asm_code;
        rsmName = existingMapping.rsm_name;
        rsmCode = existingMapping.rsm_code;
        zhName = existingMapping.zh_name;
        zhCode = existingMapping.zh_code;
        if (!area) area = existingMapping.territory_name || existingMapping.area;
      }
    } else if (soName) {
      const existingMapping = await dbGet(
        'SELECT so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, area, territory_name FROM master_dealer_so_mapping WHERE so_name = ? LIMIT 1',
        [soName]
      );
      if (existingMapping) {
        soEmpCode = existingMapping.so_emp_code;
        asmName = existingMapping.asm_name;
        asmCode = existingMapping.asm_code;
        rsmName = existingMapping.rsm_name;
        rsmCode = existingMapping.rsm_code;
        zhName = existingMapping.zh_name;
        zhCode = existingMapping.zh_code;
        if (!area) area = existingMapping.territory_name || existingMapping.area;
      } else {
        const emp = await dbGet('SELECT emp_code FROM master_employees WHERE emp_name = ?', [soName]);
        if (emp) {
          soEmpCode = emp.emp_code;
        }
      }
    }

    const matchResult = await matchAndUpsertCanonicalDealer({
      dealerType: 'PROSPECTIVE',
      rawSapCode: null, // Prospects never have SAP codes
      rawSfaCode: sfaCode,
      rawDealerName: prospectName,
      rawArea: area,
      rawBranch: area,
      rawBlock: taluka,
      zone,
      region: zone,
      soName,
      soEmpCode,
      asmName,
      asmCode,
      batchCode,
      sourceType: 'PROSPECT_DEALERS'
    });

    await logMatchingAudit({
      batchCode,
      sourceFile: sourceFileName,
      sourceSheet: sheetName,
      sourceRow: i + 1,
      sourceType: 'PROSPECT_DEALERS',
      dealerId: matchResult.dealerId,
      sapCode: null,
      sfaCode: sfaCode,
      dealerName: prospectName,
      matchMethod: matchResult.matchMethod,
      matchConfidence: matchResult.matchConfidence,
      matchStatus: matchResult.matchStatus,
      errorMessage: matchResult.message || null
    });

    if (!matchResult.success) {
      invalidRows++;
      errors.push({ row: i + 1, error: matchResult.message });
      continue;
    }

    // Update with extra prospect data
    if (matchResult.internalId) {
      await dbRun(
        `UPDATE master_dealers SET 
          counter_potential = COALESCE(?, counter_potential), 
          expected_sale = COALESCE(?, expected_sale), 
          counter_strategy = "PROSPECT", 
          dealer_type = "PROSPECTIVE",
          prospect_status = "PROSPECT_MATCHED",
          territory_code = COALESCE(?, territory_code),
          territory_name = COALESCE(?, territory_name),
          rsm_name = COALESCE(?, rsm_name),
          rsm_code = COALESCE(?, rsm_code),
          zh_name = COALESCE(?, zh_name),
          zh_code = COALESCE(?, zh_code)
         WHERE id = ?`,
        [potential, expectedSale, territoryCode, area, rsmName, rsmCode, zhName, zhCode, matchResult.internalId]
      );
    }

    insertedCount++;
  }

  return { totalRows: rawRows.length - headerRowIdx - 1, validRows: insertedCount, invalidRows, duplicateRows: 0, warnings, errors };
}
