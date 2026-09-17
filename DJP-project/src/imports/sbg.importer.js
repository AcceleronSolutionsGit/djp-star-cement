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
  
  let selectedSheetName = workbook.SheetNames[0];
  let sheet = workbook.Sheets[selectedSheetName];
  fixSheetRef(sheet);
  let rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  let headerRowIdx = -1;
  let headers = [];

  for (let i = 0; i < Math.min(20, rawRows.length); i++) {
    const row = rawRows[i];
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
      headerRowIdx = i;
      headers = normalized;
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error(`[SBG] Could not find header row with required columns in: ${sourceFileName}`);
  }

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

  let rowsRead = 0;
  let matchedCount = 0;    // updated existing DM dealers
  let notFoundCount = 0;   // SBG rows where dealer not in Dealer Mapping
  let invalidRows = 0;
  const errors = [];
  const warnings = [];

  // Track which DM dealers were matched by SBG (to mark unmatched as SBG_NOT_FOUND)
  const sbgMatchedIds = new Set();

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

    // Other enrichment fields (hierarchy/status — useful for cross-referencing)
    const status = getCell(row, 'status') || 'ACTIVE';
    const doa = parseDOA(colIdx['doa'] !== undefined ? row[colIdx['doa']] : null);
    const soEmpCode = normalizeCode(getCell(row, 'so_emp_code'));
    const soName = getCell(row, 'so_name');
    const asmCode = normalizeCode(getCell(row, 'asm_code'));
    const asmName = getCell(row, 'asm_name');
    const rsmCode = normalizeCode(getCell(row, 'rsm_code'));
    const rsmName = getCell(row, 'rsm_name');
    const zhCode = normalizeCode(getCell(row, 'zh_code'));
    const zhName = getCell(row, 'zh_name');

    if (!rawSapCode && !rawSfaCode && !rawDealerName) {
      invalidRows++;
      continue;
    }

    // ── CRITICAL: SBG must ONLY update existing Dealer Mapping records ──
    // Attempt to find the canonical dealer by SAP code, then SFA code, then name
    let existingDealer = null;

    if (rawSapCode) {
      existingDealer = await dbGet(
        `SELECT id FROM master_dealers WHERE sap_code = ? OR dm_sap_code = ? LIMIT 1`,
        [rawSapCode, rawSapCode]
      );
    }
    if (!existingDealer && rawSfaCode) {
      existingDealer = await dbGet(
        `SELECT id FROM master_dealers WHERE sfa_code = ? OR dm_sfa_code = ? LIMIT 1`,
        [rawSfaCode, rawSfaCode]
      );
    }
    if (!existingDealer && rawDealerName) {
      existingDealer = await dbGet(
        `SELECT id FROM master_dealers WHERE dealer_name = ? LIMIT 1`,
        [rawDealerName]
      );
    }

    if (!existingDealer) {
      // SBG has a dealer that is NOT in Dealer Mapping → IGNORE (do not create)
      notFoundCount++;
      warnings.push({
        row: i + 1,
        code: rawSapCode || rawSfaCode || rawDealerName,
        warning: 'SBG dealer not found in Dealer Mapping — skipped (not creating new dealer)'
      });

      await logMatchingAudit({
        batchCode,
        sourceFile: sourceFileName,
        sourceSheet: selectedSheetName,
        sourceRow: i + 1,
        sourceType: 'SBG',
        dealerId: null,
        sapCode: rawSapCode,
        sfaCode: rawSfaCode,
        dealerName: rawDealerName,
        matchMethod: 'NOT_FOUND',
        matchConfidence: 0,
        matchStatus: 'SBG_NOT_IN_DM',
        errorMessage: 'SBG dealer not found in Dealer Mapping — not creating'
      });
      continue;
    }

    const internalId = existingDealer.id;
    sbgMatchedIds.add(internalId);

    // ── UPDATE only SBG-authoritative columns ──
    // NEVER touch: area, dm_area, block, counter_potential, or Dealer Mapping hierarchy columns
    await dbRun(
      `UPDATE master_dealers SET
        sbg_potential = ?,
        sbg_block = ?,
        sbg_status = 'SBG_MATCHED',
        status = COALESCE(?, status),
        doa = COALESCE(?, doa)
       WHERE id = ?`,
      [
        sbgPotential,  // NULL is valid — means SBG has no potential data for this dealer
        sbgBlock,      // NULL is valid — means SBG has no block data for this dealer
        status || null,
        doa || null,
        internalId
      ]
    );

    matchedCount++;

    await logMatchingAudit({
      batchCode,
      sourceFile: sourceFileName,
      sourceSheet: selectedSheetName,
      sourceRow: i + 1,
      sourceType: 'SBG',
      dealerId: internalId,
      sapCode: rawSapCode,
      sfaCode: rawSfaCode,
      dealerName: rawDealerName,
      matchMethod: rawSapCode ? 'SAP_CODE' : (rawSfaCode ? 'SFA_CODE' : 'NAME'),
      matchConfidence: rawSapCode ? 100 : (rawSfaCode ? 95 : 80),
      matchStatus: 'SBG_MATCHED',
      errorMessage: null
    });
  }

  // ── Mark all Dealer Mapping dealers NOT in SBG as SBG_NOT_FOUND ──
  // This ensures the status is always explicit and queryable
  if (sbgMatchedIds.size > 0) {
    // Mark unmatched dealers
    await dbRun(
      `UPDATE master_dealers
       SET sbg_status = 'SBG_NOT_FOUND',
           sbg_potential = NULL,
           sbg_block = NULL
       WHERE id NOT IN (${[...sbgMatchedIds].map(() => '?').join(',')})
         AND sbg_status != 'SBG_MATCHED'`,
      [...sbgMatchedIds]
    );
  } else {
    // If no SBG rows matched at all, mark ALL dealers as SBG_NOT_FOUND
    await dbRun(
      `UPDATE master_dealers SET sbg_status = 'SBG_NOT_FOUND', sbg_potential = NULL, sbg_block = NULL`
    );
  }

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
