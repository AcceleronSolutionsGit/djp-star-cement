import XLSX from 'xlsx';
import { dbRun, dbGet, dbAll } from '../config/database.js';
import { matchAndUpsertCanonicalDealer, logMatchingAudit } from '../engines/canonical-matching.engine.js';
import { normalizeString, normalizeCode, normalizeBranch, normalizeRegion } from '../engines/normalization.engine.js';
import { resolveProspectHierarchy } from '../services/hierarchyResolution.service.js';
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
    'asm': 'asm_name',
    'asm name': 'asm_name',
    'name of asm': 'asm_name',
    'asm emp code': 'asm_code',
    'asm code': 'asm_code',
    'rsm': 'rsm_name',
    'rsm name': 'rsm_name',
    'zh': 'zh_name',
    'zh name': 'zh_name',
    'potential': 'potential',
    'total counter potential': 'potential',
    'counter potential': 'potential',
    'status': 'status',
    'expected sale': 'expected_sale',
    'month': 'month',
    'period month': 'month',
    'plan month': 'month'
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
    let asmName = getCell(row, 'asm_name');
    let asmCode = normalizeCode(getCell(row, 'asm_code'));
    let rsmName = getCell(row, 'rsm_name');
    let rsmCode = normalizeCode(getCell(row, 'rsm_code'));
    let zhName = getCell(row, 'zh_name');
    let zhCode = normalizeCode(getCell(row, 'zh_code'));
    const potential = getCellNum(row, 'potential');
    const expectedSale = getCellNum(row, 'expected_sale');

    if (!prospectName && !sfaCode) {
      invalidRows++;
      continue;
    }

    // Upper hierarchy resolution for prospective dealers (resolves ASM, RSM, ZH, and SO details)
    if (!asmName || !rsmName || !zhName || !soEmpCode || !soName) {
      const hierarchy = await resolveProspectHierarchy({
        soEmpCode,
        soName,
        area,
        zone,
        region: zone
      });

      if (!soEmpCode && hierarchy.so_emp_code) soEmpCode = hierarchy.so_emp_code;
      if (!soName && hierarchy.so_name) soName = hierarchy.so_name;
      if (!asmName && hierarchy.asm_name) { asmName = hierarchy.asm_name; asmCode = hierarchy.asm_code; }
      if (!rsmName && hierarchy.rsm_name) { rsmName = hierarchy.rsm_name; rsmCode = hierarchy.rsm_code; }
      if (!zhName && hierarchy.zh_name) { zhName = hierarchy.zh_name; zhCode = hierarchy.zh_code; }
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
      zhName,
      zhCode,
      rsmName,
      rsmCode,
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

    // Update with extra prospect data into master_dealers
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
          dm_area = COALESCE(dm_area, ?),
          area = COALESCE(area, ?),
          rsm_name = COALESCE(?, rsm_name),
          rsm_code = COALESCE(?, rsm_code),
          zh_name = COALESCE(?, zh_name),
          zh_code = COALESCE(?, zh_code),
          asm_name = COALESCE(?, asm_name),
          asm_code = COALESCE(?, asm_code),
          status = 'ACTIVE'
         WHERE id = ? AND (dealer_type = 'PROSPECTIVE' OR prospect_status = 'PROSPECT_MATCHED')`,
        [potential, expectedSale, territoryCode, area, area, area, rsmName, rsmCode, zhName, zhCode, asmName, asmCode, matchResult.internalId]
      );

      // Also mirror prospect hierarchy into master_dealer_so_mapping
      const existingMap = await dbGet('SELECT id FROM master_dealer_so_mapping WHERE dealer_id = ?', [matchResult.internalId]);
      if (existingMap) {
        await dbRun(
          `UPDATE master_dealer_so_mapping SET 
            sap_code = COALESCE(?, sap_code),
            dealer_name = ?,
            area = COALESCE(?, area),
            branch = COALESCE(?, branch),
            region = COALESCE(?, region),
            block = COALESCE(?, block),
            so_name = COALESCE(?, so_name),
            so_emp_code = COALESCE(?, so_emp_code),
            asm_name = COALESCE(?, asm_name),
            asm_code = COALESCE(?, asm_code),
            rsm_name = COALESCE(?, rsm_name),
            rsm_code = COALESCE(?, rsm_code),
            zh_name = COALESCE(?, zh_name),
            zh_code = COALESCE(?, zh_code),
            batch_code = ?
           WHERE id = ?`,
          [
            sfaCode || null, prospectName, area, area, zone, taluka,
            soName, soEmpCode, asmName, asmCode, rsmName, rsmCode, zhName, zhCode,
            batchCode, existingMap.id
          ]
        );
      } else {
        await dbRun(
          `INSERT INTO master_dealer_so_mapping 
            (dealer_id, sap_code, dealer_name, area, branch, region, block,
             so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, batch_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            matchResult.internalId, sfaCode || null, prospectName, area, area, zone, taluka,
            soName, soEmpCode, asmName, asmCode, rsmName, rsmCode, zhName, zhCode, batchCode
          ]
        );
      }
    }

    insertedCount++;
  }

  return { totalRows: rawRows.length - headerRowIdx - 1, validRows: insertedCount, invalidRows, duplicateRows: 0, warnings, errors };
}
