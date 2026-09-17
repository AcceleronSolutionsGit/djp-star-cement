import XLSX from 'xlsx';
import { dbRun, dbAll, dbGet } from '../config/database.js';
import { logMatchingAudit } from '../engines/canonical-matching.engine.js';
import { normalizeCode } from '../engines/normalization.engine.js';
import path from 'path';

const MONTH_ABBREV = {
  jan: '01', feb: '02', mar: '03', apr: '04',
  may: '05', jun: '06', jul: '07', aug: '08',
  sep: '09', oct: '10', nov: '11', dec: '12'
};

const MONTH_FULL = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12'
};

export function parseMonthKey(key) {
  if (!key) return null;

  // 1. JS Date object
  if (key instanceof Date && !isNaN(key.getTime())) {
    const y = key.getFullYear();
    const m = String(key.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  const s = String(key || '').trim();
  if (!s) return null;

  // Exclude non-month metric/summary keywords
  if (/\b(tgt|target|prorata|shortfall|achv|achievement|varience|variance|growth|avg|average|vs)\b/i.test(s)) {
    return null;
  }

  // Exclude full calendar dates like 30-Jun-26, 01-Jan-2024
  if (/^\d{1,2}[-_/][A-Za-z]{3,9}[-_/]\d{2,4}$/i.test(s)) {
    return null;
  }

  // 2. Standard ISO date string YYYY-MM or YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  const isoMatch = s.match(/^(\d{4})[-_/](\d{1,2})([-_/]\d{1,2})?/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = String(parseInt(isoMatch[2], 10)).padStart(2, '0');
    if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12) {
      return `${y}-${m}`;
    }
  }

  // 3. Reverse format MM-YYYY or MM/YYYY
  const revMatch = s.match(/^(\d{1,2})[-_/](\d{4})$/);
  if (revMatch) {
    const m = String(parseInt(revMatch[1], 10)).padStart(2, '0');
    const y = revMatch[2];
    if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12) {
      return `${y}-${m}`;
    }
  }

  // Clean apostrophes and trailing sales/qty/vol words like "June'26 Sales", "May'26", "Jun-26 (Sales)", "June-25 SALE", "May'26 DEALER"
  const cleaned = s.replace(/['`’]/g, '').replace(/\s*\b(sales|sale|qty|quantity|vol|volume|mt|dealer|dlr)\b/gi, '').trim();

  // 4. String month abbreviations like Apr-24, April-2024, Apr 2024, June26
  const abbrev = cleaned.match(/^([A-Za-z]{3,9})[-_/ ]?(\d{2,4})$/);
  if (abbrev) {
    const monthPart = abbrev[1].toLowerCase();
    let year = abbrev[2];
    if (year.length === 2) year = '20' + year;
    const mm = MONTH_ABBREV[monthPart.slice(0, 3)] || MONTH_FULL[monthPart];
    if (mm) return `${year}-${mm}`;
  }

  // 5. String month first with year like 2024-Apr or 24-Apr
  const yearFirstAbbrev = s.match(/^(\d{2,4})[-_/ ]?([A-Za-z]{3,9})$/);
  if (yearFirstAbbrev) {
    let year = yearFirstAbbrev[1];
    if (year.length === 2) year = '20' + year;
    const monthPart = yearFirstAbbrev[2].toLowerCase();
    const mm = MONTH_ABBREV[monthPart.slice(0, 3)] || MONTH_FULL[monthPart];
    if (mm) return `${year}-${mm}`;
  }

  // 6. Native JS Date parse fallback for full string dates
  const d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() >= 2020 && d.getFullYear() <= 2035) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  // 7. Excel numeric serial date (e.g. 45383)
  const numDate = parseFloat(s);
  if (!isNaN(numDate) && numDate > 30000 && numDate < 60000) {
    const date = new Date(Math.round((numDate - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    }
  }

  return null;
}

const NON_MONTH_COLUMNS = new Set([
  'sap code', 'rssd code', 'sub dealer name', 'linked dealer code',
  'linked dealer name', 'branch', 'zone', 'region', 'area',
  'branch as per rssd master', 'dealer name', 'dealer code',
  'sl no', 'sl.no', 's.no', 'sno', 'sr no', 'sr.no'
]);

function findField(row, variants) {
  for (const v of variants) {
    if (row[v] !== null && row[v] !== undefined) {
      const val = String(row[v]).trim();
      if (val && val !== '-') return val;
    }
  }
  return null;
}

export function fixSheetRef(sheet) {
  if (!sheet || !sheet['!ref']) return;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.r > 15000) {
    let maxR = 0;
    for (const k in sheet) {
      if (k[0] === '!') continue;
      const cell = XLSX.utils.decode_cell(k);
      if (cell.r > maxR) maxR = cell.r;
    }
    if (maxR < range.e.r) {
      sheet['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: maxR, c: range.e.c } });
    }
  }
}

export async function importSalesHistory(filePath, batchCode = null) {
  console.log(`[SALES_HISTORY] Processing from: ${filePath}`);
  const sourceFileName = path.basename(filePath);

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  fixSheetRef(sheet);
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('[SALES_HISTORY] The uploaded file contains no data rows.');
  }

  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(15, rawRows.length); i++) {
    const row = rawRows[i];
    if (!row) continue;
    const norm = row.map(c => String(c || '').trim().toLowerCase().replace(/[_\-]+/g, ' '));
    if (
      norm.some(h => h.includes('sap') || h.includes('customer') || h.includes('dealer') || h.includes('rssd')) &&
      norm.some(h => h.includes('sales') || h.includes('month') || parseMonthKey(h))
    ) {
      headerRowIdx = i;
      break;
    }
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { range: headerRowIdx, defval: null });

  if (rows.length === 0) {
    throw new Error('[SALES_HISTORY] The uploaded file contains no data rows.');
  }

  const sampleRow = rows[0];
  const allKeys = Object.keys(sampleRow);
  const isRsarFormat = allKeys.some(k => k.trim().toLowerCase() === 'current sales' || k.trim().toLowerCase() === 'current month');

  let monthCols = [];
  if (!isRsarFormat) {
    for (const key of allKeys) {
      const norm = String(key).trim().toLowerCase();
      if (NON_MONTH_COLUMNS.has(norm)) continue;
      const periodYM = parseMonthKey(key);
      if (periodYM) monthCols.push({ key, periodYM });
    }

    if (monthCols.length === 0) {
      throw new Error(
        '[SALES_HISTORY] No monthly sales columns found. ' +
        'Expected columns like "Apr-24", "May-24", "Jun-26", or Excel Date headers.'
      );
    }
  }

  const monthsFoundSet = new Set();
  if (!isRsarFormat) {
    monthCols.forEach(m => monthsFoundSet.add(m.periodYM));
  }

  let insertedCount = 0;
  let skippedCount = 0;
  let warningCount = 0;
  const errors = [];
  let rowIdx = 2;

  const recordsToInsert = [];
  const matchedSapCodes = new Set();

  const flushRecords = async () => {
    if (recordsToInsert.length === 0) return;
    const placeholders = recordsToInsert.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = recordsToInsert.flat();
    const sql = `
      INSERT INTO sales_history 
      (sap_code, rssd_code, linked_dealer_code, linked_dealer_name, sub_dealer_name, zone, period_year_month, quantity_mt, batch_code)
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE 
        quantity_mt = VALUES(quantity_mt),
        linked_dealer_name = COALESCE(VALUES(linked_dealer_name), linked_dealer_name),
        sub_dealer_name = COALESCE(VALUES(sub_dealer_name), sub_dealer_name),
        zone = COALESCE(VALUES(zone), zone),
        batch_code = VALUES(batch_code)
    `;
    await dbRun(sql, params);
    insertedCount += recordsToInsert.length;
    recordsToInsert.length = 0;
  };

  for (const row of rows) {
    let sapCode = normalizeCode(findField(row, ['Customer CODE', 'Customer Code', 'SAP Code', 'SAP CODE', 'Sap Code', 'Dealer Code']));
    let linkedDealerCode = normalizeCode(findField(row, ['Linked Dealer code', 'Linked Dealer Code', 'LINKED DEALER CODE']));
    let rssdCode = normalizeCode(findField(row, ['RSSD Code', 'RSSD CODE', 'Rssd Code']));
    const linkedDealerName = findField(row, ['Linked Dealer Name', 'LINKED DEALER NAME']);
    const subDealerName = findField(row, ['Sub Dealer Name', 'SUB DEALER NAME', 'Dealer Name', 'DEALER NAME', 'Customer Name']);
    const zone = findField(row, ['Zone', 'ZONE', 'Region', 'REGION']);

    if (!sapCode && !rssdCode && !linkedDealerCode && !subDealerName) {
      warningCount++;
      rowIdx++;
      continue;
    }

    if (isRsarFormat) {
      const currMonthRaw = findField(row, ['Current Month', 'CURRENT MONTH']);
      const currSalesRaw = findField(row, ['Current Sales', 'CURRENT SALES']);
      const prevMonthRaw = findField(row, ['Previous Month', 'PREVIOUS MONTH']);
      const prevSalesRaw = findField(row, ['Previous Sales', 'PREVIOUS SALES']);

      const currYM = parseMonthKey(currMonthRaw) || '2026-06';
      const prevYM = parseMonthKey(prevMonthRaw) || '2025-06';
      const currSales = parseFloat(currSalesRaw) || 0;
      const prevSales = parseFloat(prevSalesRaw) || 0;

      monthsFoundSet.add(currYM);
      monthsFoundSet.add(prevYM);

      recordsToInsert.push([sapCode || null, rssdCode || null, linkedDealerCode || null, linkedDealerName || null, subDealerName || null, zone || null, currYM, currSales, batchCode]);
      recordsToInsert.push([sapCode || null, rssdCode || null, linkedDealerCode || null, linkedDealerName || null, subDealerName || null, zone || null, prevYM, prevSales, batchCode]);

      if (sapCode) matchedSapCodes.add(sapCode);

      if (recordsToInsert.length >= 2000) {
        await flushRecords();
      }
    } else {
      // Insert or update sales rows directly in batch (append/upsert - NON-DESTRUCTIVE)
      for (const { key, periodYM } of monthCols) {
        const raw = row[key];
        if (raw === null || raw === undefined || raw === '' || raw === '-') continue;
        const quantity = parseFloat(raw);
        if (isNaN(quantity)) {
          warningCount++;
          continue;
        }

        recordsToInsert.push([sapCode || null, rssdCode || null, linkedDealerCode || null, linkedDealerName || null, subDealerName || null, zone || null, periodYM, quantity, batchCode]);

        if (sapCode) matchedSapCodes.add(sapCode);

        if (recordsToInsert.length >= 2000) {
          await flushRecords();
        }
      }
    }
    
    rowIdx++;
  }

  // Flush remaining buffered records
  await flushRecords();

  // Batch update rsar_status on master_dealers
  if (matchedSapCodes.size > 0) {
    const sapArray = Array.from(matchedSapCodes);
    for (let i = 0; i < sapArray.length; i += 1000) {
      const chunk = sapArray.slice(i, i + 1000);
      const ph = chunk.map(() => '?').join(',');
      await dbRun(`UPDATE master_dealers SET rsar_status = 'RSAR_MATCHED' WHERE sap_code IN (${ph})`, chunk);
    }
  }

  const monthsFound = [...monthsFoundSet].sort();
  const result = { validRows: insertedCount, skippedCount, warningCount, errors, monthsFound };
  console.log(`[SALES_HISTORY] Ingestion complete. Ingested/updated ${insertedCount} sales monthly records across ${monthsFound.length} months.`);
  return result;
}
