import XLSX from 'xlsx';
import { dbRun, dbGet, dbAll } from '../config/database.js';
import { normalizeCode, parseDOA } from '../engines/normalization.engine.js';
import { parseMonthKey, fixSheetRef } from './sales-history.importer.js';
import path from 'path';

/**
 * Dealer Performance Importer
 *
 * CRITICAL: This importer writes to dealer_performance_history ONLY.
 * It must NEVER write to sales_history (RSAR table).
 *
 * This ensures complete separation:
 *   sales_history            ← RSAR data only
 *   dealer_performance_history ← Dealer Performance data only
 *
 * The PJP engine reads these as two independent sources:
 *   rsarSixMonthAverage   ← from sales_history
 *   dpSixMonthAverage     ← from dealer_performance_history
 */

function normalizeHeader(h) {
  if (!h) return '';
  return String(h).trim().toLowerCase().replace(/[\r\n]+/g, ' ').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
}

export async function importDealerPerformance(filePath, batchCode = null) {
  console.log(`[DEALER_PERFORMANCE] Processing from: ${filePath}`);
  console.log(`[DEALER_PERFORMANCE] Writing to dealer_performance_history (NOT sales_history)`);
  const sourceFileName = path.basename(filePath);
  const workbook = XLSX.readFile(filePath, { cellDates: true });

  let selectedSheetName = null;
  let headerRowIdx = -1;
  let headers = [];
  let rawRows = [];

  for (const sName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sName];
    fixSheetRef(sheet);
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (!rows || rows.length < 2) continue;

    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const row = rows[i];
      if (!row) continue;
      const normalized = row.map(normalizeHeader);
      if (
        normalized.some(h => h === 'customer code' || h === 'dealer name' || h === 'dealers name' || h === 'sap code' || h === 'sap' || h === 'account name') &&
        normalized.some(h => h.includes('26') || h.includes('25') || h.includes('prev year') || h.includes('sales') || h.includes('sale') || h.includes('jan') || h.includes('jun') || h === 'doa' || h.includes('activation'))
      ) {
        selectedSheetName = sName;
        headerRowIdx = i;
        headers = normalized;
        rawRows = rows;
        break;
      }
    }
    if (headerRowIdx !== -1) break;
  }

  if (headerRowIdx === -1) {
    throw new Error(`[DEALER_PERFORMANCE] Could not find valid header row in: ${sourceFileName}`);
  }

  console.log(`[DEALER_PERFORMANCE] Using sheet: ${selectedSheetName}, header row: ${headerRowIdx}`);

  // Map header columns — prefer explicit SAP column over SFA/generic code
  const sapIdx = headers.findIndex(h => h === 'sap' || h === 'sap code' || h === 'customer code');
  const sfaIdx = headers.findIndex(h => h === 'dealer code' || h === 'code' || h === 'sfa code');
  const codeIdx = sapIdx !== -1 ? sapIdx : sfaIdx;
  const nameIdx = headers.findIndex(h => h === 'dealers name' || h === 'dealer name' || h === 'customer name' || h === 'account name');
  const areaIdx = headers.findIndex(h => h === 'area' || h === 'branch');
  const regionIdx = headers.findIndex(h => h === 'region' || h === 'zone');
  const doaIdx = headers.findIndex(h =>
    h === 'doa' ||
    h === 'date of activation' ||
    h === 'activation date' ||
    h === 'dealer start date' ||
    h.startsWith('doa') ||
    h.includes('date of activation') ||
    h.includes('activation')
  );

  // Identify monthly columns dynamically
  const monthMap = []; // Array of { colIdx, periodYM }
  const prevMonthNames = {
    'prev year jan': '2025-01',
    'prev year feb': '2025-02',
    'prev year mar': '2025-03',
    'prev year apr': '2025-04',
    'prev year may': '2025-05',
    'prev year jun': '2025-06',
    'prev year jul': '2025-07',
    'prev year aug': '2025-08',
    'prev year sep': '2025-09',
    'prev year oct': '2025-10',
    'prev year nov': '2025-11',
    'prev year dec': '2025-12'
  };

  // Identify target and prorata target columns dynamically
  let targetColIdx = -1;
  let targetYM = null;
  let prorataColIdx = -1;

  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    if (c === codeIdx || c === nameIdx || c === sfaIdx) continue;

    const isProrata = /prorata/i.test(h);
    const isTarget = /\b(tgt|target)\b/i.test(h) && !isProrata;

    if (isTarget && targetColIdx === -1) {
      targetColIdx = c;
      const rawHeader = String(rawRows[headerRowIdx][c] || '');
      const cleaned = rawHeader.replace(/\b(tgt|target|prorata|sale|dealer)\b/gi, '').trim();
      targetYM = parseMonthKey(cleaned);
    } else if (isProrata && prorataColIdx === -1) {
      prorataColIdx = c;
    }

    if (prevMonthNames[h]) {
      monthMap.push({ colIdx: c, periodYM: prevMonthNames[h] });
      continue;
    }

    const parsedYM = parseMonthKey(rawRows[headerRowIdx][c]);
    if (parsedYM) {
      monthMap.push({ colIdx: c, periodYM: parsedYM });
    }
  }

  const latestPeriodInMap = monthMap.length > 0 
    ? [...monthMap].sort((a, b) => b.periodYM.localeCompare(a.periodYM))[0].periodYM 
    : null;

  if (monthMap.length === 0) {
    throw new Error(`[DEALER_PERFORMANCE] No monthly columns found. Expected columns like Jan-26, Feb-26, etc.`);
  }

  let rowsRead = 0;
  let recordsInserted = 0;
  const errors = [];
  const warnings = [];

  const avgColIdx = headers.findIndex(h => h.includes('last 6 month') || h.includes('6 month avg') || h.includes('6m avg'));

  // Pre-load known dealers to avoid per-row DB queries
  const existingDealers = await dbAll('SELECT sap_code, sfa_code FROM master_dealers');
  const knownSapCodes = new Set(existingDealers.map(d => d.sap_code).filter(Boolean));
  const knownSfaCodes = new Set(existingDealers.map(d => d.sfa_code).filter(Boolean));

  const newDealersToInsert = [];
  const dealersToUpdateDoa = [];
  const recordsToInsert = [];

  /**
   * Clear the (dealer, period) pairs this upload is about to write.
   *
   * The INSERT below carries ON DUPLICATE KEY UPDATE, which only fires when a UNIQUE
   * key is violated — and dealer_performance_history declares none, so on a real MySQL
   * database the clause was dead and every upload simply appended. Because
   * loadDealerPerformanceHistory aggregates with SUM(quantity_mt) GROUP BY sap_code,
   * period_year_month, a second upload did not replace the first: it was ADDED to it.
   * Correcting a figure from 1200 to 500 and re-uploading produced 1700.
   *
   * migrate-dp-unique-key.js adds the unique key so the upsert works, but this delete
   * makes the importer correct on its own — on a database where that migration has not
   * been run, and for rows the upload no longer contains.
   */
  const clearExistingFor = async (records) => {
    if (records.length === 0) return;
    const pairs = new Map();
    for (const [sap, , period] of records) {
      if (!sap) continue;
      if (!pairs.has(period)) pairs.set(period, new Set());
      pairs.get(period).add(sap);
    }
    for (const [period, saps] of pairs) {
      const list = [...saps];
      const chunk = 400;
      for (let i = 0; i < list.length; i += chunk) {
        const slice = list.slice(i, i + chunk);
        await dbRun(
          `DELETE FROM dealer_performance_history
            WHERE period_year_month = ? AND sap_code IN (${slice.map(() => '?').join(',')})`,
          [period, ...slice]
        );
      }
    }
  };

  const flushRecords = async () => {
    if (recordsToInsert.length === 0) return;
    await clearExistingFor(recordsToInsert);
    const placeholders = recordsToInsert.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = recordsToInsert.flat();
    const sql = `
      INSERT INTO dealer_performance_history
        (sap_code, dealer_name, period_year_month, quantity_mt, target_mt, prorata_target_mt, batch_code)
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        quantity_mt = VALUES(quantity_mt),
        target_mt = CASE WHEN VALUES(target_mt) > 0 THEN VALUES(target_mt) ELSE dealer_performance_history.target_mt END,
        prorata_target_mt = CASE WHEN VALUES(prorata_target_mt) > 0 THEN VALUES(prorata_target_mt) ELSE dealer_performance_history.prorata_target_mt END,
        dealer_name = COALESCE(VALUES(dealer_name), dealer_performance_history.dealer_name),
        batch_code = VALUES(batch_code)
    `;
    await dbRun(sql, params);
    recordsInserted += recordsToInsert.length;
    recordsToInsert.length = 0;
  };

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;
    rowsRead++;

    const sapCode = normalizeCode(sapIdx !== -1 ? row[sapIdx] : null);
    const sfaCode = normalizeCode(sfaIdx !== -1 ? row[sfaIdx] : null);
    const primaryCode = sapCode || sfaCode;
    const dealerName = nameIdx !== -1 ? String(row[nameIdx] || '').trim() : null;
    const rowArea = areaIdx !== -1 && row[areaIdx] ? String(row[areaIdx]).trim() : '-';
    const rowRegion = regionIdx !== -1 && row[regionIdx] ? String(row[regionIdx]).trim() : '-';
    const rawDoa = doaIdx !== -1 && row[doaIdx] !== null && row[doaIdx] !== undefined ? row[doaIdx] : null;
    const parsedDoa = parseDOA(rawDoa);

    if (!primaryCode && !dealerName) continue;

    if (parsedDoa && (sapCode || sfaCode)) {
      dealersToUpdateDoa.push({ sapCode, sfaCode, doa: parsedDoa });
    }

    const isKnown = (sapCode && knownSapCodes.has(sapCode)) || (sfaCode && knownSfaCodes.has(sfaCode));
    if (!isKnown && primaryCode) {
      newDealersToInsert.push([
        sapCode || null,
        sfaCode || null,
        dealerName || null,
        rowArea,
        rowArea,
        rowRegion,
        rowRegion,
        parsedDoa || null
      ]);
      if (sapCode) knownSapCodes.add(sapCode);
      if (sfaCode) knownSfaCodes.add(sfaCode);
    }

    // Capture explicit 6-Month Average column if present
    if (avgColIdx !== -1) {
      const avgVal = row[avgColIdx];
      if (avgVal !== null && avgVal !== undefined && String(avgVal).trim() !== '' && String(avgVal).trim() !== '-') {
        const avgQty = parseFloat(avgVal);
        if (!isNaN(avgQty)) {
          recordsToInsert.push([sapCode || null, dealerName || null, '6M_AVG', avgQty, 0, 0, batchCode]);
        }
      }
    }

    const seenInRow = new Map();
    const targetVal = targetColIdx !== -1 && row[targetColIdx] !== null && row[targetColIdx] !== undefined ? parseFloat(row[targetColIdx]) : 0;
    const prorataVal = prorataColIdx !== -1 && row[prorataColIdx] !== null && row[prorataColIdx] !== undefined ? parseFloat(row[prorataColIdx]) : 0;

    // The DLRWISE export names some months twice — "Jun'26 SALE" as the headline figure
    // and "Jun-26 SALE" as the last cell of the monthly series. Both parse to the same
    // period, so one of them has to win.
    //
    // This used to keep the LARGER of the two silently, which meant editing the smaller
    // column had no effect at all: a figure corrected downwards in one place was simply
    // ignored, with nothing on screen to say so. The later column now wins — the monthly
    // series is the canonical run of months — and a disagreement is reported as a
    // warning naming the dealer, the two column headers and the two values, so a
    // half-edited sheet is visible instead of silent.
    const seenHeader = new Map();
    for (const { colIdx, periodYM } of monthMap) {
      const val = row[colIdx];
      if (val === null || val === undefined || String(val).trim() === '' || String(val).trim() === '-') continue;
      const quantity = parseFloat(val);
      if (isNaN(quantity)) continue;

      if (seenInRow.has(periodYM)) {
        const prev = seenInRow.get(periodYM);
        if (Math.abs(prev - quantity) > 1e-9) {
          const prevHeader = seenHeader.get(periodYM);
          const thisHeader = String(rawRows[headerRowIdx][colIdx] ?? `column ${colIdx + 1}`);
          warnings.push(
            `${dealerName || sapCode || 'row ' + rowsRead}: ${periodYM} appears twice with different values — ` +
            `"${prevHeader}" = ${prev}, "${thisHeader}" = ${quantity}. Using ${quantity} (the later column). ` +
            `If you edited one of these, edit the other to match.`
          );
        }
      }
      seenInRow.set(periodYM, quantity);
      seenHeader.set(periodYM, String(rawRows[headerRowIdx][colIdx] ?? `column ${colIdx + 1}`));
    }

    // If targetYM is defined or latestPeriodInMap is available, make sure target period exists in seenInRow even if sale wasn't entered
    const activeTargetPeriod = targetYM || latestPeriodInMap;
    if (activeTargetPeriod && !seenInRow.has(activeTargetPeriod) && (!isNaN(targetVal) && targetVal > 0)) {
      seenInRow.set(activeTargetPeriod, 0);
    }

    for (const [periodYM, quantity] of seenInRow.entries()) {
      // ── WRITE TO dealer_performance_history ONLY (NOT sales_history) ──
      const isTargetPeriod = periodYM === activeTargetPeriod;
      const rowTarget = isTargetPeriod && !isNaN(targetVal) ? targetVal : 0;
      const rowProrata = isTargetPeriod && !isNaN(prorataVal) ? prorataVal : 0;

      recordsToInsert.push([sapCode || null, dealerName || null, periodYM, quantity, rowTarget, rowProrata, batchCode]);

      if (recordsToInsert.length >= 1000) {
        await flushRecords();
      }
    }
  }

  // Insert any newly discovered dealers
  if (newDealersToInsert.length > 0) {
    for (const d of newDealersToInsert) {
      await dbRun(
        `INSERT INTO master_dealers (
          sap_code, sfa_code, dealer_name, dealer_type, status,
          area, dm_area, zone, region, doa,
          so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code,
          block, sbg_block, sbg_potential, counter_potential,
          sbg_status, dp_status
        ) VALUES (
          ?, ?, ?, 'STAR', 'ACTIVE',
          ?, ?, ?, ?, ?,
          '-', '-', '-', '-', '-', '-', '-', '-',
          '-', '-', NULL, 0,
          'SBG_NOT_FOUND', 'DP_MATCHED'
        )`,
        d
      );
    }
  }

  // Update DOA on all matching master_dealers records from DEALER Performance
  if (dealersToUpdateDoa.length > 0) {
    console.log(`[DEALER_PERFORMANCE] Updating DOA for ${dealersToUpdateDoa.length} dealers in master_dealers...`);
    const chunkSize = 200;
    for (let c = 0; c < dealersToUpdateDoa.length; c += chunkSize) {
      const chunk = dealersToUpdateDoa.slice(c, c + chunkSize);
      const sapChunk = chunk.filter(d => d.sapCode);
      if (sapChunk.length > 0) {
        const cases = sapChunk.map(() => 'WHEN ? THEN ?').join(' ');
        const params = [];
        const codes = [];
        for (const d of sapChunk) {
          params.push(d.sapCode, d.doa);
          codes.push(d.sapCode);
        }
        params.push(...codes);
        const sql = `UPDATE master_dealers SET doa = CASE sap_code ${cases} END WHERE sap_code IN (${codes.map(() => '?').join(',')})`;
        await dbRun(sql, params);
      }

      const sfaChunk = chunk.filter(d => !d.sapCode && d.sfaCode);
      for (const d of sfaChunk) {
        await dbRun('UPDATE master_dealers SET doa = ? WHERE sfa_code = ?', [d.doa, d.sfaCode]);
      }
    }
  }

  await flushRecords();

  const monthsFound = [...new Set(monthMap.map(m => m.periodYM))].sort();

  if (monthsFound.length < 6) {
    const warnMsg = `[DEALER_PERFORMANCE] Warning: Only ${monthsFound.length} of 6 required months found (${monthsFound.join(', ')}). Full 6-month average will be calculated only on available months. Never borrowing from RSAR.`;
    console.warn(warnMsg);
    warnings.push({
      message: warnMsg,
      monthsFound,
      monthsExpected: 6,
      canComputeSixMonthAvg: false
    });
  }

  console.log(`[DEALER_PERFORMANCE] Complete: ${recordsInserted} records in dealer_performance_history across ${monthsFound.length} months`);
  console.log(`[DEALER_PERFORMANCE] Months: ${monthsFound.join(', ')}`);

  return {
    totalRows: rowsRead,
    recordsInserted,
    validRows: rowsRead,
    invalidRows: 0,
    monthsFound,
    warnings,
    errors
  };
}
