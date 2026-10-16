import XLSX from 'xlsx';
import { dbRun, dbGet, dbAll } from '../config/database.js';
import { logMatchingAudit } from '../engines/canonical-matching.engine.js';
import { normalizeCode, parseDOA } from '../engines/normalization.engine.js';
import { fixSheetRef } from './sales-history.importer.js';
import path from 'path';

/**
 * SBG Importer — Authoritative Source for:
 *   - sbg_potential  (dealer Potential — NEVER reads/writes counter_potential)
 *   - sbg_block      (Block — NEVER overwrites Dealer Mapping area or block columns)
 *   - sbg_status     (SBG_MATCHED / SBG_NOT_FOUND)
 *
 * CRITICAL RULES:
 *   1. SBG must ONLY UPDATE existing master_dealers records.
 *      It NEVER inserts new dealers. Dealers not in Dealer Mapping are ignored.
 *   2. SBG potential → sbg_potential  (not counter_potential)
 *   3. SBG block     → sbg_block      (not block, not area)
 *   4. SBG must NOT write to: area, dm_area, block, counter_potential, or any Dealer Mapping column
 *   5. SBG must NOT write to sales_history
 *   6. Dealers in Dealer Mapping but absent from SBG:
 *        sbg_potential = NULL, sbg_block = NULL, sbg_status = 'SBG_NOT_FOUND'
 */

function normalizeHeader(h) {
  if (!h) return '';
  return String(h)
    .trim()
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * HEADER MAP — SBG-specific fields only.
 * NOTE: 'potential' maps to sbg_potential (NOT counter_potential).
 * NOTE: 'block'/'taluka' maps to sbg_block (NOT the master_dealers.block column).
 * IMPORTANT: 'area'/'territory' is read for matching only, NOT stored as area.
 */
const HEADER_MAP = {
  // Identity fields (for matching to existing Dealer Mapping records)
  'customer code':    'sap_code',
  'customer_code':    'sap_code',
  'dealer sap code':  'sap_code',
  'sap code':         'sap_code',
  'sap':              'sap_code',
  'sfa code':         'sfa_code',
  'dealer name':      'dealer_name',
  'customer name':    'dealer_name',
  'account name':     'dealer_name',

  // SBG-AUTHORITATIVE: Potential → sbg_potential
  'potential':                        'sbg_potential',
  'counter potential':                'sbg_potential',
  'counter potential average':        'sbg_potential',
  'counter potential average (mt)':   'sbg_potential',
  'counter potential average mt':     'sbg_potential',
  'sfa pot':                          'sbg_potential',
  'dlr counter potential':            'sbg_potential',

  // SBG-AUTHORITATIVE: Block → sbg_block
  'block':            'sbg_block',
  'block (taluka)':   'sbg_block',
  'taluka':           'sbg_block',

  // Other SBG fields (for enrichment — hierarchy/status)
  'territory code':   'territory_code',
  'territory name':   'territory_name',
  'territory':        'territory_name',
  // NOTE: 'area' is NOT mapped here — SBG area is for reference/matching only
  'zone':             'zone',
  'so code':          'so_emp_code',
  'so emp code':      'so_emp_code',
  'so name':          'so_name',
  'so/se name':       'so_name',
  'asm code':         'asm_code',
  'asm name':         'asm_name',
  'rsm code':         'rsm_code',
  'rsm name':         'rsm_name',
  'zh code':          'zh_code',
  'zh name':          'zh_name',
  'status':           'status',
  'status in sap':    'status',
  'sfa status':       'status',
  'dealer start date':'doa',
  'doa':              'doa'
};

export async function importSBG(filePath, batchCode = null) {
  console.log(`[SBG] Processing from: ${filePath}`);
  const sourceFileName = path.basename(filePath);
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  
  let selectedSheetName = null;
  let rawRows = null;
  let headerRowIdx = -1;
  let headers = [];

  // Multi-sheet evaluation: find the sheet with SBG header structure
  for (const sName of workbook.SheetNames) {
    const s = workbook.Sheets[sName];
    if (!s) continue;
    fixSheetRef(s);
    const candidateRows = XLSX.utils.sheet_to_json(s, { header: 1, defval: null });
    if (!candidateRows || candidateRows.length < 2) continue;

    for (let i = 0; i < Math.min(25, candidateRows.length); i++) {
      const row = candidateRows[i];
      if (!row) continue;
      const normalized = row.map(normalizeHeader);
      const hasCode = normalized.some(h =>
        h === 'customer code' || h === 'dealer name' || h === 'sap code' ||
        h === 'sap' || h === 'account name' || h === 'dealer sap code' || h === 'sfa code'
      );
      const hasPotOrSales = normalized.some(h =>
        h.includes('potential') || h.includes('doa') ||
        h.includes('start date') || h.includes('counter') || h.includes('pot') ||
        h.includes('block') || h.includes('taluka')
      );
      if (hasCode && hasPotOrSales) {
        selectedSheetName = sName;
        rawRows = candidateRows;
        headerRowIdx = i;
        headers = normalized;
        break;
      }
    }
    if (selectedSheetName) break;
  }

  // Fallback to first sheet if no candidate specifically matched
  if (!selectedSheetName) {
    selectedSheetName = workbook.SheetNames[0];
    const s = workbook.Sheets[selectedSheetName];
    fixSheetRef(s);
    rawRows = XLSX.utils.sheet_to_json(s, { header: 1, defval: null });
    for (let i = 0; i < Math.min(25, rawRows.length); i++) {
      const row = rawRows[i];
      if (!row) continue;
      const normalized = row.map(normalizeHeader);
      if (normalized.some(h => h.includes('customer') || h.includes('dealer') || h.includes('code') || h.includes('potential'))) {
        headerRowIdx = i;
        headers = normalized;
        break;
      }
    }
  }

  if (headerRowIdx === -1 || !rawRows) {
    throw new Error(`[SBG] Could not find header row with required columns in: ${sourceFileName}. Scanned sheets: [${workbook.SheetNames.join(', ')}]`);
  }

  console.log(`[SBG] Using sheet "${selectedSheetName}", header row ${headerRowIdx}`);

  const colIdx = {};
  for (const [normH, field] of Object.entries(HEADER_MAP)) {
    const idx = headers.indexOf(normH);
    if (idx !== -1 && !(field in colIdx)) {
      colIdx[field] = idx;
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
    if (idx === undefined || idx === -1) return null; // NULL, not 0 — SBG missing ≠ zero
    const val = row[idx];
    if (val === null || val === undefined || String(val).trim() === '' || String(val).trim() === '-') return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  };

  // Pre-load all existing dealers into memory maps for O(1) matching without thousands of DB queries
  const allDealers = await dbAll(
    `SELECT id, sap_code, dm_sap_code, sfa_code, dm_sfa_code, dealer_name FROM master_dealers`
  );
  const sapMap = new Map();
  const sfaMap = new Map();
  const nameMap = new Map();

  for (const d of allDealers) {
    if (d.sap_code) sapMap.set(d.sap_code, d.id);
    if (d.dm_sap_code) sapMap.set(d.dm_sap_code, d.id);
    if (d.sfa_code) sfaMap.set(d.sfa_code, d.id);
    if (d.dm_sfa_code) sfaMap.set(d.dm_sfa_code, d.id);
    if (d.dealer_name) nameMap.set(d.dealer_name.toLowerCase().trim(), d.id);
  }

  // Mark all current dealers as SBG_PENDING so we know which ones remain unmatched at the end
  await dbRun(`UPDATE master_dealers SET sbg_status = 'SBG_PENDING'`);

  let rowsRead = 0;
  let matchedCount = 0;    // updated existing DM dealers
  let notFoundCount = 0;   // SBG rows where dealer not in Dealer Mapping
  let invalidRows = 0;
  const errors = [];
  const warnings = [];

  const auditEntries = [];
  const flushAudit = async () => {
    if (auditEntries.length === 0) return;
    const placeholders = auditEntries.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = auditEntries.flat();
    try {
      await dbRun(
        `INSERT INTO matching_audit 
        (batch_code, source_file, source_sheet, source_row, source_type, dealer_id, sap_code, sfa_code, dealer_name, match_method, match_confidence, match_status, error_message) 
        VALUES ${placeholders}`,
        params
      );
    } catch (e) {
      console.warn('[SBG] Audit log batch insert error:', e.message);
    }
    auditEntries.length = 0;
  };

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;
    rowsRead++;

    const rawSapCode = normalizeCode(getCell(row, 'sap_code'));
    const rawSfaCode = normalizeCode(getCell(row, 'sfa_code'));
    const rawDealerName = getCell(row, 'dealer_name');

    // sbg_potential: the authoritative SBG Potential (may be NULL)
    const sbgPotential = getCellNum(row, 'sbg_potential');

    // sbg_block: the authoritative SBG Block (may be NULL)
    const sbgBlock = getCell(row, 'sbg_block');

    // Other enrichment fields (hierarchy/status)
    const status = getCell(row, 'status') || 'ACTIVE';
    const doa = parseDOA(colIdx['doa'] !== undefined ? row[colIdx['doa']] : null);

    if (!rawSapCode && !rawSfaCode && !rawDealerName) {
      invalidRows++;
      continue;
    }

    // O(1) in-memory lookup
    let internalId = null;
    let matchMethod = 'NONE';
    let matchConfidence = 0;

    if (rawSapCode && sapMap.has(rawSapCode)) {
      internalId = sapMap.get(rawSapCode);
      matchMethod = 'SAP_CODE';
      matchConfidence = 100;
    } else if (rawSfaCode && sfaMap.has(rawSfaCode)) {
      internalId = sfaMap.get(rawSfaCode);
      matchMethod = 'SFA_CODE';
      matchConfidence = 95;
    } else if (rawDealerName && nameMap.has(rawDealerName.toLowerCase().trim())) {
      internalId = nameMap.get(rawDealerName.toLowerCase().trim());
      matchMethod = 'NAME';
      matchConfidence = 80;
    }

    if (!internalId) {
      notFoundCount++;
      if (warnings.length < 50) {
        warnings.push({
          row: i + 1,
          code: rawSapCode || rawSfaCode || rawDealerName,
          warning: 'SBG dealer not found in Dealer Mapping — skipped (not creating new dealer)'
        });
      }

      if (auditEntries.length < 500) {
        auditEntries.push([
          batchCode,
          sourceFileName,
          selectedSheetName,
          i + 1,
          'SBG',
          null,
          rawSapCode,
          rawSfaCode,
          rawDealerName,
          'NOT_FOUND',
          0,
          'SBG_NOT_IN_DM',
          'SBG dealer not found in Dealer Mapping — not creating'
        ]);
      }
      continue;
    }

    // Update master_dealers
    await dbRun(
      `UPDATE master_dealers SET
        sbg_potential = ?,
        sbg_block = ?,
        sbg_status = 'SBG_MATCHED',
        status = COALESCE(?, status),
        doa = COALESCE(?, doa)
       WHERE id = ?`,
      [
        sbgPotential,
        sbgBlock,
        status || null,
        doa || null,
        internalId
      ]
    );

    matchedCount++;

    if (auditEntries.length < 500) {
      auditEntries.push([
        batchCode,
        sourceFileName,
        selectedSheetName,
        i + 1,
        'SBG',
        internalId,
        rawSapCode,
        rawSfaCode,
        rawDealerName,
        matchMethod,
        matchConfidence,
        'SBG_MATCHED',
        null
      ]);
    }

    if (auditEntries.length >= 200) {
      await flushAudit();
    }
  }

  await flushAudit();

  // Mark all Dealer Mapping dealers NOT matched in this run as SBG_NOT_FOUND
  await dbRun(
    `UPDATE master_dealers
     SET sbg_status = 'SBG_NOT_FOUND',
         sbg_potential = NULL,
         sbg_block = NULL
     WHERE sbg_status != 'SBG_MATCHED'`
  );

  const notFoundInDM = await dbGet(
    `SELECT COUNT(*) as cnt FROM master_dealers WHERE sbg_status = 'SBG_NOT_FOUND'`
  );

  const result = {
    success: true,
    totalRows: rowsRead,
    validRows: matchedCount,
    matchedCount,
    notFoundInSBG: notFoundInDM?.cnt || 0,
    notFoundInDM: notFoundCount,
    invalidRows,
    warnings,
    errors
  };

  console.log(`[SBG] Import complete:`, {
    matched: matchedCount,
    notFoundInDM: notFoundCount,
    dealersWithoutSBG: notFoundInDM?.cnt || 0,
    invalid: invalidRows
  });
  console.log(`[SBG] NOTE: ${notFoundInDM?.cnt || 0} Dealer Mapping dealers have no SBG data (sbg_potential=NULL, sbg_block=NULL, sbg_status=SBG_NOT_FOUND)`);

  return result;
}
