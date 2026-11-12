import XLSX from 'xlsx';
import { dbRun, dbGet, dbAll } from '../config/database.js';
import { normalizeCode, normalizeString, parseDOA } from '../engines/normalization.engine.js';
import { fixSheetRef } from './sales-history.importer.js';
import path from 'path';

/**
 * SBG Importer — Authoritative Source for:
 *   - sbg_potential  (dealer Potential — NEVER reads/writes counter_potential)
 *   - sbg_block      (Block — NEVER overwrites Dealer Mapping area or block columns)
 *   - sbg_status     (SBG_MATCHED / SBG_NOT_FOUND)
 *
 * RULES:
 *   1. SBG updates existing master_dealers records when matched.
 *   2. SBG does NOT insert new dealers — Dealer Mapping is the exclusive authority for master dealers. Unmatched SBG records are skipped.
 *   3. SBG potential -> sbg_potential  (not counter_potential)
 *   4. SBG block     -> sbg_block      (not block, not area)
 *   5. SBG must NOT write to: dm_area, counter_potential, or any Dealer Mapping-authoritative column
 *   6. SBG must NOT write to sales_history
 *   7. Dealers in Dealer Mapping but absent from SBG:
 *        sbg_potential = NULL, sbg_block = NULL, sbg_status = 'SBG_NOT_FOUND'
 */

function normalizeHeader(h) {
  if (!h) return '';
  return String(h)
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
    .replace(/[\u2011\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g, '-')
    .trim()
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * HEADER MAP — SBG-specific fields and extensive aliases
 */
const HEADER_MAP = {
  // Identity fields (for matching to existing Dealer Mapping records)
  'customer code':    'sap_code',
  'customer_code':    'sap_code',
  'dealer sap code':  'sap_code',
  'dealer code':      'sap_code',
  'cust code':        'sap_code',
  'party code':       'sap_code',
  'account code':     'sap_code',
  'dealer id':        'sap_code',
  'sap code':         'sap_code',
  'sap':              'sap_code',
  'sfa code':         'sfa_code',
  'sfa id':           'sfa_code',
  'sfa':              'sfa_code',
  'dealer name':      'dealer_name',
  'customer name':    'dealer_name',
  'account name':     'dealer_name',
  'party name':       'dealer_name',
  'dealer':           'dealer_name',
  'customer':         'dealer_name',

  // SBG-AUTHORITATIVE: Potential -> sbg_potential
  'potential':                        'sbg_potential',
  'counter potential':                'sbg_potential',
  'counter potential average':        'sbg_potential',
  'counter potential average (mt)':   'sbg_potential',
  'counter potential average mt':     'sbg_potential',
  'sfa pot':                          'sbg_potential',
  'dlr counter potential':            'sbg_potential',
  'dealer counter potential':         'sbg_potential',

  // SBG-AUTHORITATIVE: Block -> sbg_block
  'block':            'sbg_block',
  'block (taluka)':   'sbg_block',
  'taluka':           'sbg_block',
  'taluk':            'sbg_block',

  // Other SBG fields (for enrichment — hierarchy/status)
  'territory code':   'territory_code',
  'territory id':     'territory_code',
  'territory name':   'territory_name',
  'territory':        'territory_name',
  'zone':             'zone',
  'so code':          'so_emp_code',
  'so emp code':      'so_emp_code',
  'so id':            'so_emp_code',
  'so e code':        'so_emp_code',
  'so name':          'so_name',
  'so/se name':       'so_name',
  'se name':          'so_name',
  'asm code':         'asm_code',
  'asm emp code':     'asm_code',
  'asm name':         'asm_name',
  'rsm code':         'rsm_code',
  'rsm emp code':     'rsm_code',
  'rsm name':         'rsm_name',
  'zh code':          'zh_code',
  'zh emp code':      'zh_code',
  'zh name':          'zh_name',
  'status':           'status',
  'status in sap':    'status',
  'sfa status':       'status',
  'dealer start date':'doa',
  'start date':       'doa',
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
        h === 'sap' || h === 'account name' || h === 'dealer sap code' ||
        h === 'sfa code' || h === 'dealer code' || h === 'cust code'
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
    return s === '' || s === '-' || s.toLowerCase() === 'null' ? null : s;
  };

  const getCellNum = (row, field) => {
    const idx = colIdx[field];
    if (idx === undefined || idx === -1) return null;
    const val = row[idx];
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    if (s === '' || s === '-' || s.toLowerCase() === 'null') return null;
    // Strip commas in formatted numbers like "1,200.50"
    const cleaned = s.replace(/,/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  };

  // Pre-load all existing dealers into memory maps for O(1) matching
  const allDealers = await dbAll(
    `SELECT id, sap_code, dm_sap_code, sfa_code, dm_sfa_code, dealer_name FROM master_dealers`
  );
  const existingSapMap = new Map();
  const existingSfaMap = new Map();
  const existingNameMap = new Map();

  for (const d of allDealers) {
    const nSap = normalizeCode(d.sap_code);
    const nDmSap = normalizeCode(d.dm_sap_code);
    const nSfa = normalizeCode(d.sfa_code);
    const nDmSfa = normalizeCode(d.dm_sfa_code);
    if (nSap) existingSapMap.set(nSap, d.id);
    if (nDmSap) existingSapMap.set(nDmSap, d.id);
    if (nSfa) existingSfaMap.set(nSfa, d.id);
    if (nDmSfa) existingSfaMap.set(nDmSfa, d.id);
    if (d.dealer_name) existingNameMap.set(d.dealer_name.toLowerCase().trim(), d.id);
  }

  // Mark all current dealers as SBG_PENDING so we know which ones remain unmatched at the end
  await dbRun(`UPDATE master_dealers SET sbg_status = 'SBG_PENDING'`);

  // Data structures for batch operations
  const updatesById = new Map();     // id -> update payload
  const auditEntries = [];

  let rowsRead = 0;
  let matchedRows = 0;
  let unmatchedRows = 0;
  let duplicateRows = 0;
  let invalidRows = 0;
  const errors = [];
  const warnings = [];

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;
    rowsRead++;

    const rawSapCode = normalizeCode(getCell(row, 'sap_code'));
    const rawSfaCode = normalizeCode(getCell(row, 'sfa_code'));
    const rawDealerName = getCell(row, 'dealer_name');

    // sbg_potential: authoritative SBG Potential
    const sbgPotential = getCellNum(row, 'sbg_potential');

    // sbg_block: authoritative SBG Block
    const sbgBlock = getCell(row, 'sbg_block');

    // Enrichment fields
    const status = getCell(row, 'status') || 'ACTIVE';
    const doa = parseDOA(colIdx['doa'] !== undefined ? row[colIdx['doa']] : null);

    // Hierarchy fields
    const zone = getCell(row, 'zone');
    const territoryCode = normalizeCode(getCell(row, 'territory_code'));
    const territoryName = getCell(row, 'territory_name');
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

    // Check if dealer exists in database
    let internalId = null;
    let matchMethod = 'NONE';
    let matchConfidence = 0;

    if (rawSapCode && existingSapMap.has(rawSapCode)) {
      internalId = existingSapMap.get(rawSapCode);
      matchMethod = 'SAP_CODE';
      matchConfidence = 100;
    } else if (rawSfaCode && existingSfaMap.has(rawSfaCode)) {
      internalId = existingSfaMap.get(rawSfaCode);
      matchMethod = 'SFA_CODE';
      matchConfidence = 95;
    } else if (rawDealerName && existingNameMap.has(rawDealerName.toLowerCase().trim())) {
      internalId = existingNameMap.get(rawDealerName.toLowerCase().trim());
      matchMethod = 'NAME';
      matchConfidence = 80;
    }

    if (internalId) {
      // ─── EXISTING DEALER: Update SBG-authoritative fields only (Rule 5: DM is hierarchy authority) ───
      updatesById.set(internalId, {
        id: internalId,
        sbgPotential: sbgPotential ?? null,
        sbgBlock: sbgBlock || null,
        doa: doa || null
      });

      matchedRows++;

      if (auditEntries.length < 500) {
        auditEntries.push([
          batchCode,
          sourceFileName,
          selectedSheetName,
          i + 1,
          'SBG',
          String(internalId),
          rawSapCode,
          rawSfaCode,
          rawDealerName,
          matchMethod,
          matchConfidence,
          'SBG_MATCHED',
          null
        ]);
      }
    } else {
      // ─── UNMATCHED DEALER: Do NOT add new dealers from SBG (Dealer Mapping is exclusive master authority) ───
      unmatchedRows++;

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
          'NONE',
          0,
          'SBG_UNMATCHED_SKIPPED',
          'Dealer not found in Dealer Mapping master — skipped (SBG does not insert new dealers)'
        ]);
      }
    }
  }

  // ─── 1. BATCH EXECUTE UPDATES TO EXISTING DEALERS (HIGH PERFORMANCE) ───
  // Rule 5: Dealer Mapping is hierarchy authority — update ONLY sbg_potential, sbg_block, sbg_status
  const updateEntries = Array.from(updatesById.values());
  console.log(`[SBG] Applying updates for ${updateEntries.length} matched existing dealers...`);

  const UPDATE_CONCURRENCY = 20;
  for (let c = 0; c < updateEntries.length; c += UPDATE_CONCURRENCY) {
    const chunk = updateEntries.slice(c, c + UPDATE_CONCURRENCY);
    await Promise.all(
      chunk.map(u =>
        dbRun(
          `UPDATE master_dealers SET
            sbg_potential = ?,
            sbg_block = ?,
            sbg_status = 'SBG_MATCHED',
            doa = COALESCE(doa, ?)
           WHERE id = ?`,
          [
            u.sbgPotential,
            u.sbgBlock,
            u.doa,
            u.id
          ]
        )
      )
    );
  }

  // ─── 2. AUDIT LOGGING (BULK INSERT) ───
  if (auditEntries.length > 0) {
    const AUDIT_BATCH_SIZE = 200;
    for (let c = 0; c < auditEntries.length; c += AUDIT_BATCH_SIZE) {
      const chunk = auditEntries.slice(c, c + AUDIT_BATCH_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params = chunk.flat();
      try {
        await dbRun(
          `INSERT INTO matching_audit 
          (batch_code, source_file, source_sheet, source_row, source_type, dealer_id, sap_code, sfa_code, dealer_name, match_method, match_confidence, match_status, error_message) 
          VALUES ${placeholders}`,
          params
        );
      } catch (auditErr) {
        console.warn('[SBG] Audit log batch insert error:', auditErr.message);
      }
    }
  }

  // ─── 3. MARK UNMATCHED DEALER MAPPING DEALERS ───
  await dbRun(
    `UPDATE master_dealers
     SET sbg_status = 'SBG_NOT_FOUND',
         sbg_potential = NULL,
         sbg_block = NULL
     WHERE sbg_status = 'SBG_PENDING'`
  );

  const notFoundInDM = await dbGet(
    `SELECT COUNT(*) as cnt FROM master_dealers WHERE sbg_status = 'SBG_NOT_FOUND'`
  );

  const totalValid = matchedRows;

  const result = {
    success: true,
    totalRows: rowsRead,
    validRows: totalValid,
    matchedCount: matchedRows,
    unmatchedCount: unmatchedRows,
    insertedCount: 0,
    duplicateRows: 0,
    notFoundInSBG: notFoundInDM?.cnt || 0,
    invalidRows,
    warnings,
    errors
  };

  console.log(`[SBG] Import complete:`, {
    totalRead: rowsRead,
    validRows: totalValid,
    matchedRows,
    unmatchedRows,
    insertedRows: 0,
    dealersWithoutSBG: notFoundInDM?.cnt || 0,
    invalid: invalidRows
  });

  return result;
}
