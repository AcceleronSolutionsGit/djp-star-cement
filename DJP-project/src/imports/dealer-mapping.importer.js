import XLSX from 'xlsx';
import { dbRun, dbGet, dbAll } from '../config/database.js';
import { matchAndUpsertCanonicalDealer, logMatchingAudit } from '../engines/canonical-matching.engine.js';
import { normalizeString, normalizeCode, normalizeBranch, normalizeRegion, parseDOA } from '../engines/normalization.engine.js';
import path from 'path';

function normalizeHeader(h) {
  return String(h || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const HEADER_MAP = {
  // Canonical 9-column headers
  'dealer sap code': 'sap_code',
  'dealer name': 'dealer_name',
  'account name': 'dealer_name',
  'branch': 'branch',
  'branch name': 'branch',
  'region': 'region',
  'so name': 'so_name',
  'so e code': 'so_emp_code',
  'asm name': 'asm_name',
  'asm code': 'asm_code',
  'linked dealer code': 'linked_dealer_code',

  // 10-column Territory / Dealer Mapping headers
  'zone': 'zone',
  'cust type': 'cust_type',
  'customer type': 'cust_type',
  'area': 'area',
  'territory code': 'territory_code',
  'territory name': 'territory_name',
  'territory': 'territory_name',
  'block': 'block',
  'block (taluka)': 'block',
  'taluka': 'block',
  'zonal head': 'zh_name',
  'zh': 'zh_name',
  'zh name': 'zh_name',
  'zh code': 'zh_code',
  'rsm': 'rsm_name',
  'rsm name': 'rsm_name',
  'rsm code': 'rsm_code',
  'asm': 'asm_name',
  'so/se name': 'so_name',
  'so/se  name': 'so_name',
  'so / se name': 'so_name',
  'so emp code': 'so_emp_code',
  'so code': 'so_emp_code',
  'customer code': 'customer_code',
  'sap code': 'sap_code',
  'sap': 'sap_code',
  'sfa code': 'sfa_code',
  'customer name': 'dealer_name',
  'dlr counter potential': 'counter_potential',
  'counter potential': 'counter_potential',
  'potential': 'counter_potential',
  'doa': 'doa',
  'date of activation': 'doa'
};

/**
 * Create or refresh one master_employees row.
 *
 * Designation is only written when the row is created, or when the existing row has
 * none — a person who appears as an ASM on one line and an RSM on another keeps the
 * designation they were first recorded with rather than flip-flopping per row.
 */
async function upsertEmployee(empCode, empName, designation, region) {
  if (!empCode || !empName) return;

  const existing = await dbGet(
    'SELECT id, designation FROM master_employees WHERE emp_code = ?',
    [empCode]
  );

  if (!existing) {
    await dbRun(
      'INSERT INTO master_employees (emp_code, emp_name, designation, zone, region) VALUES (?, ?, ?, ?, ?)',
      [empCode, empName, designation, region || null, region || null]
    );
    return;
  }

  await dbRun(
    `UPDATE master_employees
     SET emp_name = ?,
         designation = COALESCE(NULLIF(designation, ''), ?),
         region = COALESCE(?, region)
     WHERE id = ?`,
    [empName, designation, region || null, existing.id]
  );
}

export async function importDealerMapping(filePath, batchCode = null) {
  console.log(`[DEALER_MAPPING] Processing from: ${filePath}`);
  const sourceFileName = path.basename(filePath);

  const workbook = XLSX.readFile(filePath);
  
  let selectedSheetName = null;
  let headerRowIdx = -1;
  let headers = [];
  let rawRows = [];

  // Search across all sheets for mapping headers
  for (const sName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (!rows || rows.length < 2) continue;

    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const row = rows[i];
      if (!row) continue;
      const normalized = row.map(normalizeHeader);
      if (
        normalized.some(h => h === 'dealer sap code' || h === 'dealer name' || h === 'customer code' || h === 'sfa code' || h === 'sap code') &&
        normalized.some(h => h === 'so name' || h === 'so/se name' || h === 'so/se  name' || h === 'so e code' || h === 'asm' || h === 'asm name' || h === 'area' || h === 'branch')
      ) {
        selectedSheetName = sName;
        headerRowIdx = i;
        headers = normalized;
        rawRows = rows;
        break;
      }
    }
    if (selectedSheetName) break;
  }

  // Fallback to first available sheet if not matched by heuristic
  if (!selectedSheetName) {
    const preferredSheets = ['Dealer SO Mapping', 'Sheet1', 'Master', 'Master ', 'Dealer', 'Territory Mapping'];
    selectedSheetName = workbook.SheetNames.find(s => preferredSheets.includes(s)) || workbook.SheetNames[0];
    const sheet = workbook.Sheets[selectedSheetName];
    rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    for (let i = 0; i < Math.min(15, rawRows.length); i++) {
      const row = rawRows[i];
      if (!row) continue;
      const normalized = row.map(normalizeHeader);
      if (normalized.some(h => h === 'dealer sap code' || h === 'dealer name' || h === 'customer code' || h === 'sfa code' || h === 'so e code' || h === 'so/se name')) {
        headerRowIdx = i;
        headers = normalized;
        break;
      }
    }
  }

  if (headerRowIdx === -1) {
    throw new Error(`[DEALER_MAPPING] Could not find valid header row in file: ${sourceFileName}`);
  }

  const colIdx = {};
  for (const [normHeader, canonicalField] of Object.entries(HEADER_MAP)) {
    const idx = headers.indexOf(normHeader);
    if (idx !== -1 && !(canonicalField in colIdx)) {
      colIdx[canonicalField] = idx;
    }
  }

  const getCell = (row, field) => {
    const idx = colIdx[field];
    if (idx === undefined || idx === -1) return null;
    const val = row[idx];
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    return s === '' || s === '-' ? null : s;
  };

  const getCellNum = (row, field) => {
    const idx = colIdx[field];
    if (idx === undefined || idx === -1) return null;
    const val = row[idx];
    if (val === null || val === undefined || String(val).trim() === '' || String(val).trim() === '-') return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  };

  let rowsRead = 0;
  let dealersCreated = 0;
  let dealersUpdated = 0;
  let mappingsCreated = 0;
  let mappingsUpdated = 0;
  let duplicateRows = 0;
  let invalidRows = 0;
  let ambiguousRows = 0;
  let missingSapCount = 0;
  let missingSoCodeCount = 0;
  let missingAsmCodeCount = 0;

  const uniqueDealers = new Set();
  const uniqueSos = new Set();
  const uniqueAsms = new Set();
  const uniqueRegions = new Set();
  const uniqueBranches = new Set();

  const errors = [];
  const warnings = [];

  const seenInFile = new Map(); // key -> first row idx
  
  // Preload existing employees in memory for lightning fast lookup
  const existingEmployees = await dbAll('SELECT emp_code, emp_name FROM master_employees');
  const empMapByName = new Map();
  for (const emp of existingEmployees) {
    if (emp.emp_name) empMapByName.set(emp.emp_name.trim().toUpperCase(), emp.emp_code);
  }

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;
    rowsRead++;

    const rawSapCode = normalizeCode(getCell(row, 'sap_code') || getCell(row, 'customer_code'));
    const rawCustomerCode = normalizeCode(getCell(row, 'customer_code') || getCell(row, 'sap_code'));
    const rawSfaCode = normalizeCode(getCell(row, 'sfa_code'));
    const rawLinkedCode = normalizeCode(getCell(row, 'linked_dealer_code'));
    const rawDealerName = getCell(row, 'dealer_name');
    const custType = getCell(row, 'cust_type') || 'STAR';

    // Dealer Mapping Area — authoritative Area source (stored in dm_area)
    // Branch is a separate concept — used for mapping/grouping, not the Area field
    const branch = getCell(row, 'branch');
    const territoryCode = normalizeCode(getCell(row, 'territory_code'));
    const territoryName = getCell(row, 'territory_name');
    // dm_area: strictly from the 'area' column in Dealer Mapping
    // Falls back to territory_name only if area column is absent
    const dmArea = getCell(row, 'area') || territoryName || null;
    const region = getCell(row, 'region') || getCell(row, 'zone');
    const zone = getCell(row, 'zone') || getCell(row, 'region');
    const soName = getCell(row, 'so_name');
    let soEmpCode = normalizeCode(getCell(row, 'so_emp_code') || getCell(row, 'so_code'));
    const asmName = getCell(row, 'asm_name');
    let asmCode = normalizeCode(getCell(row, 'asm_code'));
    const rsmName = getCell(row, 'rsm_name');
    let rsmCode = normalizeCode(getCell(row, 'rsm_code'));
    const zhName = getCell(row, 'zh_name');
    let zhCode = normalizeCode(getCell(row, 'zh_code'));
    // Block from Dealer Mapping — stored in master_dealers.block (NOT sbg_block)
    // sbg_block is only written by the SBG importer
    const block = getCell(row, 'block');
    const counterPotential = getCellNum(row, 'counter_potential');
    const doa = parseDOA(colIdx['doa'] !== undefined ? row[colIdx['doa']] : null);
    // Convenience alias for canonical-matching engine (expects 'area')
    const area = dmArea;

    if (!rawDealerName && !rawSapCode && !rawLinkedCode) {
      invalidRows++;
      continue;
    }

    if (!rawSapCode) missingSapCount++;
    if (!soEmpCode) missingSoCodeCount++;
    if (!asmCode) missingAsmCodeCount++;

    if (rawSapCode) uniqueDealers.add(rawSapCode);
    else if (rawDealerName) uniqueDealers.add(rawDealerName);

    if (soEmpCode) uniqueSos.add(soEmpCode);
    if (asmCode) uniqueAsms.add(asmCode);
    if (region) uniqueRegions.add(region);
    if (branch) uniqueBranches.add(branch);

    // Duplicate detection within the file
    const dedupeKey = `${rawSapCode || rawDealerName}_${soEmpCode || soName}`;
    if (seenInFile.has(dedupeKey)) {
      duplicateRows++;
    } else {
      seenInFile.set(dedupeKey, i);
    }

    if (!soEmpCode && soName) {
      soEmpCode = empMapByName.get(soName.trim().toUpperCase()) || null;
    }
    if (!asmCode && asmName) {
      asmCode = empMapByName.get(asmName.trim().toUpperCase()) || null;
    }

    const dType = (custType.toUpperCase() === 'NON_STAR' || custType.toUpperCase() === 'NON-STAR') ? 'NON_STAR' : 'STAR';

    // Canonical Matching & Upsert
    const matchResult = await matchAndUpsertCanonicalDealer({
      dealerType: dType,
      rawSapCode,
      rawSfaCode,
      rawLinkedDealerCode: rawLinkedCode,
      rawDealerName,
      rawArea: dmArea,   // Dealer Mapping authoritative area
      rawBranch: branch,
      rawBlock: block,
      zone,
      region,
      soName,
      soEmpCode,
      asmName,
      asmCode,
      batchCode,
      sourceType: 'DEALER_MAPPING'
    });

    await logMatchingAudit({
      batchCode,
      sourceFile: sourceFileName,
      sourceSheet: selectedSheetName,
      sourceRow: i + 1,
      sourceType: 'DEALER_MAPPING',
      dealerId: matchResult.dealerId,
      sapCode: rawSapCode,
      sfaCode: rawSfaCode,
      dealerName: rawDealerName,
      matchMethod: matchResult.matchMethod,
      matchConfidence: matchResult.matchConfidence,
      matchStatus: matchResult.matchStatus,
      errorMessage: matchResult.message || null
    });

    if (!matchResult.success) {
      if (matchResult.matchStatus === 'AMBIGUOUS') ambiguousRows++;
      else invalidRows++;
      errors.push({ row: i + 1, error: matchResult.message });
      continue;
    }

    if (matchResult.isNew) {
      dealersCreated++;
    } else {
      dealersUpdated++;
    }

    const internalId = matchResult.internalId;

    if (internalId) {
      // Update Dealer Mapping authoritative columns
      // dm_area is the authoritative Dealer Mapping area — always update from DM
      // counter_potential is the DM potential (separate from sbg_potential)
      await dbRun(
        `UPDATE master_dealers SET
          dm_area = ?,
          dm_sap_code = COALESCE(?, dm_sap_code),
          dm_customer_code = COALESCE(?, dm_customer_code),
          dm_sfa_code = COALESCE(?, dm_sfa_code),
          area = COALESCE(?, area),
          counter_potential = COALESCE(?, counter_potential),
          doa = COALESCE(?, doa),
          territory_code = COALESCE(?, territory_code),
          territory_name = COALESCE(?, territory_name),
          rsm_code = COALESCE(?, rsm_code),
          rsm_name = COALESCE(?, rsm_name),
          zh_code = COALESCE(?, zh_code),
          zh_name = COALESCE(?, zh_name)
         WHERE id = ?`,
        [
          dmArea || null,
          rawSapCode || null,
          rawCustomerCode || null,
          rawSfaCode || null,
          dmArea || null,
          counterPotential,
          doa,
          territoryCode || null,
          territoryName || null,
          rsmCode || null,
          rsmName || null,
          zhCode || null,
          zhName || null,
          internalId
        ]
      );

      // Upsert authoritative relationship into master_dealer_so_mapping
      const effectiveSoName = soName || (soEmpCode ? `SO ${soEmpCode}` : (rawDealerName ? `SO for ${rawDealerName}` : 'Unassigned SO'));
      const existingMapping = await dbGet('SELECT id FROM master_dealer_so_mapping WHERE dealer_id = ?', [internalId]);
      
      if (existingMapping) {
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
          territory_code = COALESCE(?, territory_code),
          territory_name = COALESCE(?, territory_name),
          linked_dealer_code = COALESCE(?, linked_dealer_code),
          batch_code = ?
          WHERE id = ?`,
          [
            rawSapCode || null, rawDealerName,
            dmArea || null,    // DM area — authoritative
            branch || null, region || null,
            block || null,     // DM block (not sbg_block)
            effectiveSoName, soEmpCode || null, asmName || null, asmCode || null,
            rsmName || null, rsmCode || null, zhName || null, zhCode || null,
            territoryCode || null, territoryName || null,
            rawLinkedCode || null, batchCode, existingMapping.id
          ]
        );
        mappingsUpdated++;
      } else {
        await dbRun(
          `INSERT INTO master_dealer_so_mapping 
          (dealer_id, sap_code, dealer_name, area, branch, region, block, so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, territory_code, territory_name, linked_dealer_code, batch_code) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            internalId, rawSapCode || null, rawDealerName,
            dmArea || null,    // DM area — authoritative
            branch || null, region || null,
            block || null,     // DM block (not sbg_block)
            effectiveSoName, soEmpCode || null, asmName || null, asmCode || null,
            rsmName || null, rsmCode || null, zhName || null, zhCode || null,
            territoryCode || null, territoryName || null,
            rawLinkedCode || null, batchCode
          ]
        );
        mappingsCreated++;
      }

      // Maintain employee master records for EVERY level of the hierarchy.
      //
      // This used to cover SO and ASM only. RSMs and ZHs therefore had no row in
      // master_employees at all, so anything that looked a person up by code — plan
      // generation above all — fell back to printing the employee CODE where the name
      // should be. The mapping file carries a name for all four levels; store all four.
      await upsertEmployee(soEmpCode,  soName,  'SO/SE', region);
      await upsertEmployee(asmCode,    asmName, 'ASM',   region);
      await upsertEmployee(rsmCode,    rsmName, 'RSM',   region);
      await upsertEmployee(zhCode,     zhName,  'ZH',    region);
    }
  }

  const validRows = (dealersCreated + dealersUpdated) || (mappingsCreated + mappingsUpdated) || (rowsRead - invalidRows);
  const result = {
    success: true,
    totalRows: rowsRead,
    validRows: validRows,
    invalidRows: invalidRows,
    duplicateRows: duplicateRows,
    rowsRead,
    dealersCreated,
    dealersUpdated,
    mappingsCreated,
    mappingsUpdated,
    duplicates: duplicateRows,
    unmatched: invalidRows,
    ambiguous: ambiguousRows,
    missingSap: missingSapCount,
    missingSoCode: missingSoCodeCount,
    missingAsmCode: missingAsmCodeCount,
    uniqueDealers: uniqueDealers.size,
    uniqueSos: uniqueSos.size,
    uniqueAsms: uniqueAsms.size,
    uniqueRegions: uniqueRegions.size,
    uniqueBranches: uniqueBranches.size,
    warnings,
    errors
  };

  console.log(`[DEALER_MAPPING] Ingestion Complete:`, result);
  return result;
}
