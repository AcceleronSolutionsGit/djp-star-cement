import XLSX from 'xlsx';
import path from 'path';
import crypto from 'crypto';
import { dbAll, dbRun, dbGet } from '../config/database.js';
import { normalizeString, normalizeCode, normalizeBranch, normalizeRegion, parseDOA } from '../engines/normalization.engine.js';
import { resolveZonalHead, refreshDynamicZonalHeadCache } from '../services/zonalHead.service.js';

export async function importMasterOct(filePath = 'New Upload/Master Excel Oct.xlsx') {
  const startTime = Date.now();
  console.log(`\n======================================================`);
  console.log(`INGESTING MASTER EXCEL OCT INTO DATABASE`);
  console.log(`File: ${filePath}`);
  console.log(`======================================================\n`);

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames.find(s => s.trim().toLowerCase() === 'master') || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  console.log(`[1] Loaded sheet '${sheetName}' with ${rawRows.length} rows in ${Date.now() - startTime}ms`);

  // Detect anchor from B2
  const b2Val = sheet['B2']?.v;
  let periodMonth = '2026-10';
  if (b2Val) {
    const d = new Date(Math.round((b2Val - 25569) * 86400 * 1000));
    periodMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  console.log(`[2] Planning Period Month from B2: ${periodMonth}`);

  const headerRowIdx = 3;
  const headers = rawRows[headerRowIdx];
  console.log(`[3] Found ${headers.length} headers on row ${headerRowIdx + 1}`);

  await refreshDynamicZonalHeadCache(false);

  // Preload existing master_dealers to link dealer_id
  const existingDealers = await dbAll('SELECT id, dealer_id, sap_code, sfa_code, dealer_name, normalized_dealer_name FROM master_dealers');
  const dealerBySap = new Map();
  const dealerBySfa = new Map();
  for (const d of existingDealers) {
    if (d.sap_code) dealerBySap.set(normalizeCode(d.sap_code), d);
    if (d.sfa_code) dealerBySfa.set(normalizeCode(d.sfa_code), d);
  }
  console.log(`[4] Preloaded ${existingDealers.length} existing master dealers into memory`);

  const targetsToInsert = [];
  const dealersToInsert = [];
  const dealersToUpdate = [];
  const mappingsToInsert = [];
  const employeesToUpsert = new Map();

  const num = v => {
    if (v === null || v === undefined || v === '' || v === '-') return 0;
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };

  const str = v => (v === null || v === undefined || v === '-' || v === 'NA') ? null : String(v).trim();

  let dealersCount = 0;
  let rsarCount = 0;
  let nonStarCount = 0;

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    if (!r || r.every(c => c === null || String(c).trim() === '')) continue;

    const rawCustType = str(r[0]) || 'DEALER';
    let custType = 'DEALER';
    if (rawCustType.toUpperCase().includes('RSAR') || rawCustType.toUpperCase().includes('SUB')) {
      custType = 'RSAR';
      rsarCount++;
    } else if (rawCustType.toUpperCase().includes('NON') || rawCustType.toUpperCase().includes('PROSPECT')) {
      custType = 'NON STAR';
      nonStarCount++;
    } else {
      dealersCount++;
    }

    const zone = str(r[2]);
    let zhName = str(r[3]);
    const rsmName = str(r[4]);
    const asmName = str(r[5]);
    const area = str(r[6]);
    const soName = str(r[8]);
    const block = str(r[9]);
    const sfaCode = normalizeCode(r[10]);
    const sapCode = normalizeCode(r[11]);
    const dealerName = str(r[12]);

    const potential = num(r[13]);
    const currentSales = num(r[14]); // Sep'26 Sales
    const counterShare = num(r[15]);
    const lysmSales = num(r[16]);   // Sep'25 Sales
    const prevSales = num(r[17]);   // Aug'26 Sales
    const avg6m = num(r[18]);       // Last 6 months avg
    const rawDoa = r[19];
    const doa = (rawDoa === 'NEW' || String(rawDoa).toUpperCase() === 'NEW') ? null : parseDOA(rawDoa);
    const finalCategory = str(r[20]) || 'Active';
    const potRank = num(r[21]) || 1;
    const scoreA = num(r[22]);
    const scoreB = num(r[23]);
    const scoreC = num(r[24]);
    const totalScore = num(r[25]);
    const priorityRank = num(r[26]) || 1;
    const soVisits = num(r[27]);
    const asmVisits = num(r[28]);
    const rsmVisits = num(r[29]);
    const zhVisits = num(r[30]);
    const totalVisits = soVisits + asmVisits + rsmVisits + zhVisits;

    const finalVolume = num(r[31]);
    const grade = str(r[32]) || 'A';
    const areaVolume = num(r[33]);
    const areaRank = num(r[34]) || 1;
    const areaVolPct = num(r[35]);
    const isNeedToGrow = (str(r[36]) || '').toLowerCase() === 'yes' ? 1 : 0;
    const areaPotential = num(r[37]);
    const areaPotRank = num(r[38]) || 1;
    const areaPotPct = num(r[39]);

    // Check existing dealer
    let matchedDealer = (sapCode && dealerBySap.get(sapCode)) || (sfaCode && dealerBySfa.get(sfaCode)) || null;

    if (!matchedDealer) {
      const newUuid = crypto.randomUUID();
      const newDlr = {
        dealer_id: newUuid,
        dealer_type: custType,
        sap_code: sapCode,
        sfa_code: sfaCode,
        dealer_name: dealerName,
        normalized_dealer_name: normalizeString(dealerName),
        area: area,
        dm_area: area,
        zone: zone,
        region: zone,
        block: block,
        so_name: soName,
        asm_name: asmName,
        rsm_name: rsmName,
        zh_name: zhName,
        counter_potential: potential,
        doa: doa,
        status: 'ACTIVE'
      };
      dealersToInsert.push(newDlr);
      if (sapCode) dealerBySap.set(sapCode, newDlr);
      if (sfaCode) dealerBySfa.set(sfaCode, newDlr);
    } else {
      dealersToUpdate.push({
        id: matchedDealer.id,
        dealer_type: custType,
        sap_code: sapCode || matchedDealer.sap_code,
        sfa_code: sfaCode || matchedDealer.sfa_code,
        area: area,
        counter_potential: potential,
        current_sales: currentSales,
        doa: doa
      });
    }

    // Build target record
    targetsToInsert.push([
      `RUN-${periodMonth}`, periodMonth, 'C1', matchedDealer?.id || null, dealerName,
      sapCode, sfaCode, area, zone, grade, finalCategory,
      soName, null, soVisits, asmVisits, rsmVisits, zhVisits, totalVisits,
      totalVisits > 0 ? (soVisits / totalVisits) * 100 : 0,
      totalVisits > 0 ? (asmVisits / totalVisits) * 100 : 0,
      totalVisits > 0 ? (rsmVisits / totalVisits) * 100 : 0,
      totalVisits > 0 ? (zhVisits / totalVisits) * 100 : 0,
      `BAT-${periodMonth}`, priorityRank, asmName, null, rsmName, zhName,
      area, zone, null, null, null, null, null,
      potential, prevSales, currentSales, finalVolume, scoreA, scoreB, scoreC, totalScore,
      grade, grade, block, custType, area, block, potential,
      avg6m, avg6m, lysmSales, 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE',
      null, counterShare, isNeedToGrow, areaPotential, areaPotRank, areaPotPct,
      areaVolume, areaRank, areaVolPct, potRank, doa
    ]);
  }

  console.log(`[5] Parsed ${targetsToInsert.length} targets:`);
  console.log(`    Dealers: ${dealersCount}, RSARs: ${rsarCount}, Non-Star: ${nonStarCount}`);
  console.log(`    New Dealers to Insert in master_dealers: ${dealersToInsert.length}`);
  console.log(`    Existing Dealers to Update in master_dealers: ${dealersToUpdate.length}`);

  // 1. Batch Insert New Dealers into master_dealers
  if (dealersToInsert.length > 0) {
    const chunkSz = 250;
    const DLR_COLS = ['dealer_id', 'dealer_type', 'sap_code', 'sfa_code', 'dealer_name', 'normalized_dealer_name', 'area', 'dm_area', 'zone', 'region', 'block', 'so_name', 'asm_name', 'rsm_name', 'zh_name', 'counter_potential', 'doa', 'status'];
    const placeholders = `(${DLR_COLS.map(() => '?').join(', ')})`;
    const colList = DLR_COLS.map(c => `\`${c}\``).join(', ');

    for (let i = 0; i < dealersToInsert.length; i += chunkSz) {
      const chunk = dealersToInsert.slice(i, i + chunkSz);
      const sql = `INSERT INTO master_dealers (${colList}) VALUES ${chunk.map(() => placeholders).join(', ')}`;
      const params = chunk.flatMap(d => [
        d.dealer_id, d.dealer_type, d.sap_code, d.sfa_code, d.dealer_name, d.normalized_dealer_name,
        d.area, d.dm_area, d.zone, d.region, d.block, d.so_name, d.asm_name, d.rsm_name, d.zh_name,
        d.counter_potential, d.doa, d.status
      ]);
      await dbRun(sql, params);
    }
    console.log(`[6] Successfully inserted ${dealersToInsert.length} new dealers into master_dealers.`);

    // Refresh memory map with newly inserted IDs
    const newDealers = await dbAll('SELECT id, dealer_id, sap_code, sfa_code FROM master_dealers');
    for (const d of newDealers) {
      if (d.sap_code) dealerBySap.set(normalizeCode(d.sap_code), d);
      if (d.sfa_code) dealerBySfa.set(normalizeCode(d.sfa_code), d);
    }
  }

  // 2. Link dealer_id on target records
  for (const t of targetsToInsert) {
    const sap = t[5];
    const sfa = t[6];
    const d = (sap && dealerBySap.get(sap)) || (sfa && dealerBySfa.get(sfa));
    if (d) t[3] = d.id;
  }

  // 3. Clear existing targets for period_month to ensure clean slate
  await dbRun('DELETE FROM dealer_visit_targets WHERE period_month = ?', [periodMonth]);
  console.log(`[7] Purged any existing targets for period ${periodMonth}`);

  // 4. Batch Insert Targets into dealer_visit_targets
  const TARGET_COLS = [
    'generation_run_code', 'period_month', 'cycle_code', 'dealer_id', 'dealer_name',
    'sap_code', 'sfa_code', 'area', 'zone', 'category', 'dealer_status',
    'so_name', 'so_emp_code', 'so_visits', 'asm_visits', 'rsm_visits', 'zh_visits', 'total_visits',
    'so_visits_pct', 'asm_visits_pct', 'rsm_visits_pct', 'zh_visits_pct',
    'batch_code', 'priority', 'asm_name', 'asm_code', 'rsm_name', 'zh_name',
    'branch', 'region', 'territory_code', 'territory_name', 'so_code', 'rsm_code', 'zh_code',
    'potential', 'previous_sales', 'current_sales', 'final_volume', 'score_a', 'score_b', 'score_c', 'total_score',
    'priority_label', 'grade', 'block', 'cust_type', 'dm_area', 'sbg_block', 'sbg_potential',
    'rsar_six_month_avg', 'dp_six_month_avg', 'lysm_sales', 'sbg_status', 'rsar_status', 'dp_status', 'prospect_status',
    'linked_dealer_code', 'counter_share', 'need_to_grow', 'area_potential', 'area_potential_rank', 'area_potential_percentile',
    'area_volume', 'area_volume_rank', 'area_volume_percentile', 'potential_rank', 'doa'
  ];

  const targetPlaceholder = `(${TARGET_COLS.map(() => '?').join(', ')})`;
  const targetColList = TARGET_COLS.map(c => `\`${c}\``).join(', ');

  const chunkSz = 250;
  for (let i = 0; i < targetsToInsert.length; i += chunkSz) {
    const chunk = targetsToInsert.slice(i, i + chunkSz);
    const sql = `INSERT INTO dealer_visit_targets (${targetColList}) VALUES ${chunk.map(() => targetPlaceholder).join(', ')}`;
    const params = chunk.flat();
    await dbRun(sql, params);
  }
  console.log(`[8] Successfully inserted ${targetsToInsert.length} target records into dealer_visit_targets for ${periodMonth}.`);

  // 5. Update/Ensure master_dealer_so_mapping entries exist
  console.log('[9] Synchronizing master_dealer_so_mapping...');
  await dbRun(`
    INSERT INTO master_dealer_so_mapping 
      (dealer_id, sap_code, dealer_name, area, branch, zone, region, block, so_name, asm_name, rsm_name, zh_name, batch_code)
    SELECT 
      t.dealer_id, t.sap_code, t.dealer_name, t.area, t.area, t.zone, t.zone, t.block, t.so_name, t.asm_name, t.rsm_name, t.zh_name, t.batch_code
    FROM dealer_visit_targets t
    LEFT JOIN master_dealer_so_mapping m ON (t.dealer_id = m.dealer_id OR (t.sap_code IS NOT NULL AND t.sap_code = m.sap_code))
    WHERE t.period_month = ? AND m.id IS NULL
  `, [periodMonth]);

  const dur = Date.now() - startTime;
  console.log(`\n======================================================`);
  console.log(`OCTOBER MASTER INGESTION COMPLETE IN: ${dur}ms (${(dur / 1000).toFixed(2)}s)!`);
  console.log(`Total Targets for ${periodMonth}: ${targetsToInsert.length}`);
  console.log(`======================================================\n`);
  return { success: true, count: targetsToInsert.length, periodMonth, durationMs: dur };
}

// If run directly from CLI
if (process.argv[1]?.endsWith('import-master-oct.js')) {
  importMasterOct().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
