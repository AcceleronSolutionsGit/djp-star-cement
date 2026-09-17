import XLSX from 'xlsx';
import { dbRun, dbGet, dbAll } from '../config/database.js';
import { logMatchingAudit } from '../engines/canonical-matching.engine.js';
import path from 'path';

function normalizeHeader(h) {
  return String(h || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function importPjpTradeFile(filePath, periodMonth, cycleCode = 'C1', batchCode = null) {
  if (!periodMonth) {
    throw new Error('[PJP_TRADE] periodMonth is required. Do not import without specifying the report month.');
  }
  if (!cycleCode) {
    throw new Error('[PJP_TRADE] cycleCode is required.');
  }

  console.log(`[PJP_TRADE] Processing reference visit master from: ${filePath}`);
  const sourceFileName = path.basename(filePath);

  const workbook = XLSX.readFile(filePath);
  const preferredSheets = ['Visits', 'Sheet1', 'Data'];
  let sheetName = workbook.SheetNames.find(s => preferredSheets.includes(s)) || workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (!rawRows || rawRows.length < 3) {
    throw new Error(`[PJP_TRADE] Sheet '${sheetName}' does not contain sufficient data rows.`);
  }

  let headerRowIdx = -1;
  let headers = [];
  for (let i = 0; i < Math.min(15, rawRows.length); i++) {
    const row = rawRows[i];
    if (!row) continue;
    const normalized = row.map(normalizeHeader);
    if (normalized.some(h => h === 'dealer name' || h === 'sfa code' || h === 'so/se name' || h === 'so/se  name')) {
      headerRowIdx = i;
      headers = normalized;
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error(`[PJP_TRADE] Could not find a header row with 'DEALER NAME', 'SFA CODE', or 'SO/SE NAME'.`);
  }

  const colMap = {};
  const headerMappings = {
    'sfa code': 'sfa_code',
    'sap code': 'sap_code',
    'customer code': 'sap_code',
    'dealer name': 'dealer_name'
  };
  for (const [normHeader, canonicalField] of Object.entries(headerMappings)) {
    const idx = headers.indexOf(normHeader);
    if (idx !== -1 && !(canonicalField in colMap)) {
      colMap[canonicalField] = idx;
    }
  }

  const getCell = (row, field) => {
    const idx = colMap[field];
    if (idx === undefined) return null;
    const val = row[idx];
    return val !== null && val !== undefined ? String(val).trim() : null;
  };

  let invalidRows = 0;
  let validTargetsCount = 0;
  const warnings = [];

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;

    const dealerName = getCell(row, 'dealer_name');
    const sfaCode = getCell(row, 'sfa_code');
    const sapCodeFromFile = getCell(row, 'sap_code');

    if (!dealerName && !sfaCode && !sapCodeFromFile) {
      invalidRows++;
      continue;
    }

    // Resolve Canonical Identity for Audit
    let matchedDealer = null;
    let matchMethod = 'NONE';
    if (sapCodeFromFile) {
      matchedDealer = await dbGet('SELECT * FROM master_dealers WHERE sap_code = ?', [sapCodeFromFile]);
      matchMethod = 'SAP_CODE';
    } else if (sfaCode) {
      matchedDealer = await dbGet('SELECT * FROM master_dealers WHERE sfa_code = ?', [sfaCode]);
      matchMethod = 'SFA_CODE';
    } else if (dealerName) {
      matchedDealer = await dbGet('SELECT * FROM master_dealers WHERE normalized_dealer_name = ?', [dealerName.toUpperCase().trim()]);
      matchMethod = 'COMPOSITE_NAME';
    }

    await logMatchingAudit({
      batchCode,
      sourceFile: sourceFileName,
      sourceSheet: sheetName,
      sourceRow: i + 1,
      sourceType: 'PJP_TRADE',
      dealerId: matchedDealer ? matchedDealer.dealer_id : null,
      sapCode: sapCodeFromFile,
      sfaCode: sfaCode,
      dealerName: dealerName,
      matchMethod: matchMethod,
      matchConfidence: matchedDealer ? 100 : 0,
      matchStatus: matchedDealer ? 'MATCHED' : 'UNMATCHED',
      errorMessage: null
    });

    validTargetsCount++;
  }

  console.log(`[PJP_TRADE] Done: ${validTargetsCount} parsed as reference, ${invalidRows} invalid.`);
  return { validTargetsCount, invalidRows, warnings };
}
