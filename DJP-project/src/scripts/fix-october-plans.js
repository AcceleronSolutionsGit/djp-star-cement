import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { dbAll, dbRun, pool } from '../config/database.js';
import { AutoPlanGenerator } from '../engines/autoPlanGenerator.js';

export async function fixOctoberPlans() {
  const startTime = Date.now();
  console.log('================================================================');
  console.log('Star Cement DJP — High-Speed Fix for October Plans & Categories');
  console.log('================================================================\n');

  // 1. Locate Authoritative File
  const candidateFiles = [
    'New Upload/TESTING/OCT26 DJP-MAIN.xlsx',
    'New Upload/Master Excel Oct.xlsx',
    'New Upload/TESTING/Master Excel Oct.xlsx',
    'New Upload/OCT26 DJP-MAIN.xlsx'
  ];

  let masterFile = null;
  for (const f of candidateFiles) {
    if (fs.existsSync(f)) {
      masterFile = f;
      break;
    }
  }

  if (masterFile) {
    console.log(`[1] Found authoritative workbook: ${masterFile}`);
    console.time('Read Workbook');
    const wb = XLSX.readFile(masterFile);
    const sheetName = wb.SheetNames.find(s => s.trim().toLowerCase() === 'master' || s.trim().toLowerCase() === 'master ') || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    console.timeEnd('Read Workbook');
    console.log(`    Loaded ${rows.length} rows from sheet '${sheetName}'`);

    const num = v => {
      if (v === null || v === undefined || v === '' || v === '-') return 0;
      const n = parseFloat(v);
      return isNaN(n) ? 0 : n;
    };
    const str = v => (v === null || v === undefined || v === '-' || v === 'NA') ? null : String(v).trim();

    // Create temporary table
    await dbRun(`DROP TABLE IF EXISTS temp_oct_master`);
    await dbRun(`
      CREATE TABLE temp_oct_master (
        sap_code VARCHAR(50),
        sfa_code VARCHAR(50),
        dealer_name VARCHAR(255),
        cust_type VARCHAR(50),
        final_category VARCHAR(50),
        grade VARCHAR(10),
        so_visits FLOAT,
        asm_visits FLOAT,
        rsm_visits FLOAT,
        zh_visits FLOAT,
        total_visits FLOAT,
        current_sales FLOAT,
        previous_sales FLOAT,
        lysm_sales FLOAT,
        rsar_six_month_avg FLOAT,
        dp_six_month_avg FLOAT,
        potential FLOAT,
        counter_share FLOAT,
        final_volume FLOAT,
        KEY (sap_code),
        KEY (sfa_code)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    const insertRows = [];
    let dealerCount = 0, rsarCount = 0, nonStarCount = 0;

    for (let i = 4; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every(c => c === null || String(c).trim() === '')) continue;

      const sapCode = str(r[11]);
      const sfaCode = str(r[10]);
      const dealerName = str(r[12]);
      const rawCustType = str(r[0]) || '';

      let custType = 'DEALER';
      if (sapCode && sapCode.startsWith('100')) {
        custType = 'DEALER';
        dealerCount++;
      } else if (sapCode && sapCode.startsWith('150')) {
        custType = 'RSAR';
        rsarCount++;
      } else if (rawCustType.toUpperCase().includes('RSAR') || rawCustType.toUpperCase().includes('SUB')) {
        custType = 'RSAR';
        rsarCount++;
      } else if (rawCustType.toUpperCase().includes('NON') || rawCustType.toUpperCase().includes('PROSPECT') || (sapCode && sapCode.startsWith('NS')) || (sfaCode && sfaCode.startsWith('NS'))) {
        custType = 'NON STAR';
        nonStarCount++;
      } else {
        custType = 'DEALER';
        dealerCount++;
      }

      let finalCategory = str(r[20]) || 'Active';
      // Safety guard: DEALER and RSAR can NEVER be Prospective
      if ((custType === 'DEALER' || custType === 'RSAR') && finalCategory.toLowerCase() === 'prospective') {
        finalCategory = num(r[14]) > 0 ? 'Growing' : (num(r[18]) === 0 ? 'Churn' : 'Zero Lifter');
      }

      const potential = num(r[13]);
      const currentSales = num(r[14]);
      const counterShare = num(r[15]);
      const lysmSales = num(r[16]);
      const prevSales = num(r[17]);
      const avg6m = num(r[18]);
      const grade = str(r[32]) || 'A';
      const soVisits = num(r[27]);
      const asmVisits = num(r[28]);
      const rsmVisits = num(r[29]);
      const zhVisits = num(r[30]);
      const totalVisits = soVisits + asmVisits + rsmVisits + zhVisits;
      const finalVolume = num(r[31]);

      insertRows.push([
        sapCode, sfaCode, dealerName, custType, finalCategory, grade,
        soVisits, asmVisits, rsmVisits, zhVisits, totalVisits,
        currentSales, prevSales, lysmSales,
        custType === 'RSAR' ? avg6m : 0,
        custType === 'DEALER' ? avg6m : 0,
        potential, counterShare, finalVolume
      ]);
    }

    console.log(`[2] Excel Classification: DEALER=${dealerCount}, RSAR=${rsarCount}, NON STAR=${nonStarCount}`);

    // Bulk insert into temp table
    console.log(`[3] Bulk inserting ${insertRows.length} rows into temp_oct_master...`);
    const chunkSize = 500;
    const placeholders = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    for (let i = 0; i < insertRows.length; i += chunkSize) {
      const chunk = insertRows.slice(i, i + chunkSize);
      const sql = `INSERT INTO temp_oct_master VALUES ${chunk.map(() => placeholders).join(', ')}`;
      await dbRun(sql, chunk.flat());
    }

    // Update dealer_visit_targets via bulk indexed JOINs
    console.log('[4] Updating dealer_visit_targets via indexed JOINs (SAP & SFA)...');
    await dbRun(`
      UPDATE dealer_visit_targets dvt
      JOIN temp_oct_master m ON dvt.sap_code = m.sap_code
      SET 
        dvt.cust_type = m.cust_type,
        dvt.dealer_status = m.final_category,
        dvt.category = m.grade,
        dvt.grade = m.grade,
        dvt.so_visits = m.so_visits,
        dvt.asm_visits = m.asm_visits,
        dvt.rsm_visits = m.rsm_visits,
        dvt.zh_visits = m.zh_visits,
        dvt.total_visits = m.total_visits,
        dvt.current_sales = m.current_sales,
        dvt.previous_sales = m.previous_sales,
        dvt.lysm_sales = m.lysm_sales,
        dvt.rsar_six_month_avg = m.rsar_six_month_avg,
        dvt.dp_six_month_avg = m.dp_six_month_avg,
        dvt.potential = m.potential,
        dvt.counter_share = m.counter_share,
        dvt.final_volume = m.final_volume
      WHERE dvt.period_month = '2026-10' AND dvt.sap_code IS NOT NULL AND dvt.sap_code != ''
    `);

    await dbRun(`
      UPDATE dealer_visit_targets dvt
      JOIN temp_oct_master m ON dvt.sfa_code = m.sfa_code
      SET 
        dvt.cust_type = m.cust_type,
        dvt.dealer_status = m.final_category,
        dvt.category = m.grade,
        dvt.grade = m.grade,
        dvt.so_visits = m.so_visits,
        dvt.asm_visits = m.asm_visits,
        dvt.rsm_visits = m.rsm_visits,
        dvt.zh_visits = m.zh_visits,
        dvt.total_visits = m.total_visits,
        dvt.current_sales = m.current_sales,
        dvt.previous_sales = m.previous_sales,
        dvt.lysm_sales = m.lysm_sales,
        dvt.rsar_six_month_avg = m.rsar_six_month_avg,
        dvt.dp_six_month_avg = m.dp_six_month_avg,
        dvt.potential = m.potential,
        dvt.counter_share = m.counter_share,
        dvt.final_volume = m.final_volume
      WHERE dvt.period_month = '2026-10' 
        AND (dvt.sap_code IS NULL OR dvt.sap_code = '')
        AND dvt.sfa_code IS NOT NULL AND dvt.sfa_code != ''
    `);

    await dbRun(`DROP TABLE IF EXISTS temp_oct_master`);
  } else {
    console.log('[1] Authoritative Excel not found locally — applying direct database heuristic updates...');
  }

  // 5. Direct Heuristic Target Updates
  console.log('[5] Enforcing exact Customer Types & Visits on dealer_visit_targets...');
  await dbRun(`UPDATE dealer_visit_targets SET cust_type = 'DEALER' WHERE period_month = '2026-10' AND sap_code LIKE '100%'`);
  await dbRun(`UPDATE dealer_visit_targets SET cust_type = 'RSAR' WHERE period_month = '2026-10' AND sap_code LIKE '150%'`);
  await dbRun(`UPDATE dealer_visit_targets SET cust_type = 'NON STAR' WHERE period_month = '2026-10' AND (sap_code IS NULL OR (sap_code NOT LIKE '100%' AND sap_code NOT LIKE '150%'))`);

  // Ensure all RSARs have at least 2 visits target (1 in C1, 1 in C2) as per October Master
  await dbRun(`
    UPDATE dealer_visit_targets 
    SET so_visits = 2, total_visits = GREATEST(COALESCE(total_visits, 0), 2)
    WHERE period_month = '2026-10' 
      AND cust_type = 'RSAR' 
      AND (so_visits IS NULL OR so_visits = 0)
  `);

  // Backfill employee codes by matching names to employee_master in memory
  console.log('[5b] Backfilling missing employee codes on dealer_visit_targets from employee_master...');
  const emRows = await dbAll('SELECT emp_code, dns_emp_code, emp_name FROM employee_master WHERE emp_name IS NOT NULL');
  const nameToCodeMap = new Map();
  for (const e of emRows) {
    const code = e.dns_emp_code || e.emp_code;
    if (code && e.emp_name) {
      nameToCodeMap.set(e.emp_name.trim().toUpperCase(), code);
    }
  }

  const distinctSos = await dbAll('SELECT DISTINCT so_name FROM dealer_visit_targets WHERE period_month = "2026-10" AND so_name IS NOT NULL AND (so_emp_code IS NULL OR so_emp_code = "" OR so_emp_code = "VACANT")');
  for (const { so_name } of distinctSos) {
    const code = nameToCodeMap.get(so_name.trim().toUpperCase());
    if (code) {
      await dbRun('UPDATE dealer_visit_targets SET so_emp_code = ? WHERE period_month = "2026-10" AND so_name = ?', [code, so_name]);
    }
  }

  const distinctAsms = await dbAll('SELECT DISTINCT asm_name FROM dealer_visit_targets WHERE period_month = "2026-10" AND asm_name IS NOT NULL AND (asm_code IS NULL OR asm_code = "" OR asm_code = "VACANT")');
  for (const { asm_name } of distinctAsms) {
    const code = nameToCodeMap.get(asm_name.trim().toUpperCase());
    if (code) {
      await dbRun('UPDATE dealer_visit_targets SET asm_code = ? WHERE period_month = "2026-10" AND asm_name = ?', [code, asm_name]);
    }
  }

  const distinctRsms = await dbAll('SELECT DISTINCT rsm_name FROM dealer_visit_targets WHERE period_month = "2026-10" AND rsm_name IS NOT NULL AND (rsm_code IS NULL OR rsm_code = "" OR rsm_code = "VACANT")');
  for (const { rsm_name } of distinctRsms) {
    const code = nameToCodeMap.get(rsm_name.trim().toUpperCase());
    if (code) {
      await dbRun('UPDATE dealer_visit_targets SET rsm_code = ? WHERE period_month = "2026-10" AND rsm_name = ?', [code, rsm_name]);
    }
  }

  const distinctZhs = await dbAll('SELECT DISTINCT zh_name FROM dealer_visit_targets WHERE period_month = "2026-10" AND zh_name IS NOT NULL AND (zh_code IS NULL OR zh_code = "" OR zh_code = "VACANT")');
  for (const { zh_name } of distinctZhs) {
    const code = nameToCodeMap.get(zh_name.trim().toUpperCase());
    if (code) {
      await dbRun('UPDATE dealer_visit_targets SET zh_code = ? WHERE period_month = "2026-10" AND zh_name = ?', [code, zh_name]);
    }
  }

  // Ensure DEALER and RSAR never have Prospective category
  await dbRun(`
    UPDATE dealer_visit_targets 
    SET dealer_status = CASE 
      WHEN current_sales > 0 THEN 'Growing'
      WHEN (cust_type = 'DEALER' AND dp_six_month_avg = 0) OR (cust_type = 'RSAR' AND rsar_six_month_avg = 0) THEN 'Churn'
      ELSE 'Zero Lifter'
    END
    WHERE period_month = '2026-10' 
      AND cust_type IN ('DEALER', 'RSAR') 
      AND dealer_status IN ('Prospective', 'PROSPECTIVE')
  `);

  // 6. Direct Heuristic Updates on master_dealers
  console.log('[6] Enforcing exact Customer Types on master_dealers...');
  await dbRun("UPDATE master_dealers SET dealer_type = 'DEALER' WHERE sap_code LIKE '100%'");
  await dbRun("UPDATE master_dealers SET dealer_type = 'RSAR' WHERE sap_code LIKE '150%'");
  await dbRun(`
    UPDATE master_dealers 
    SET dealer_type = 'NON STAR' 
    WHERE (sap_code IS NULL OR (sap_code NOT LIKE '100%' AND sap_code NOT LIKE '150%'))
      AND (
        sap_code LIKE 'NS%' 
        OR sfa_code LIKE 'NS%' 
        OR dealer_type IN ('NON STAR', 'NON_STAR', 'NON-STAR', 'PROSPECTIVE', 'PROSPECT')
        OR (dealer_name NOT LIKE '%(RSD%' AND dealer_name NOT LIKE '%(RSAR%' AND dealer_type NOT IN ('RSAR', 'SUB-DEALER', 'SUB DEALER', 'RSSD'))
      )
  `);

  // 7. Direct Updates on sales_plan_details (Schedule Review & Calendar)
  console.log('[7] Enforcing exact Customer Types on sales_plan_details...');
  await dbRun("UPDATE sales_plan_details SET dealer_type = 'DEALER' WHERE dealer_sap_code LIKE '100%'");
  await dbRun("UPDATE sales_plan_details SET dealer_type = 'RSAR' WHERE dealer_sap_code LIKE '150%'");
  await dbRun("UPDATE sales_plan_details SET dealer_type = 'NON STAR' WHERE dealer_sap_code IS NULL OR (dealer_sap_code NOT LIKE '100%' AND dealer_sap_code NOT LIKE '150%')");

  // 8. Fix Zonal Head mapping: replace Dibyajyoti Guha with Giridhari Mukherjee
  console.log('[8] Correcting Zonal Head mapping (replacing Dibyajyoti Guha with Giridhari Mukherjee)...');
  await dbRun(`
    UPDATE master_zone_zh_mapping
    SET 
      zh_name = 'GIRIDHARI MUKHERJEE',
      zh_code = '11002257',
      emp_code = 'E2352',
      designation = 'General Manager',
      level = 'L5',
      updated_at = NOW()
    WHERE zone_code IN ('NB1', 'NB2') 
       OR zh_name LIKE '%DIBYAJYOTI GUHA%' 
       OR zh_code = '1100380' 
       OR emp_code = 'E0259'
  `);
  await dbRun(`
    UPDATE master_dealers
    SET zh_name = 'GIRIDHARI MUKHERJEE', zh_code = '11002257'
    WHERE zone IN ('NB1', 'NB2') OR zh_name LIKE '%DIBYAJYOTI%' OR zh_code = '1100380'
  `);
  await dbRun(`
    UPDATE master_dealer_so_mapping
    SET zh_name = 'GIRIDHARI MUKHERJEE', zh_code = '11002257'
    WHERE zone IN ('NB1', 'NB2') OR zh_name LIKE '%DIBYAJYOTI%' OR zh_code = '1100380'
  `);
  await dbRun(`
    UPDATE dealer_visit_targets
    SET zh_name = 'GIRIDHARI MUKHERJEE', zh_code = '11002257'
    WHERE (zone IN ('NB1', 'NB2') OR zh_name LIKE '%DIBYAJYOTI%' OR zh_code = '1100380')
      AND period_month = '2026-10'
  `);
  await dbRun(`
    UPDATE dealer_visit_targets
    SET zh_name = 'BRIJESH SINGH', zh_code = '11001891'
    WHERE zone = 'NE2' AND period_month = '2026-10'
  `);

  // 9. Remove non-sales employees from plans (vendor emp, branding, inactive)
  console.log('[9] Removing plans for non-sales personnel...');
  await dbRun(`
    DELETE spd FROM sales_plan_details spd
    JOIN sales_plans sp ON spd.plan_id = sp.id
    JOIN employee_master em ON (sp.emp_code = em.emp_code OR sp.emp_code = em.dns_emp_code)
    WHERE sp.period_month = '2026-10'
      AND (
        em.designation IN ('VENDOR EMP', 'DUMP INCHARGE', 'MIS', 'ACCOUNTS', 'Branding verification')
        OR em.sale_access != 'Primary'
        OR em.level = 'branding'
      )
  `);
  await dbRun(`
    DELETE sp FROM sales_plans sp
    JOIN employee_master em ON (sp.emp_code = em.emp_code OR sp.emp_code = em.dns_emp_code)
    WHERE sp.period_month = '2026-10'
      AND (
        em.designation IN ('VENDOR EMP', 'DUMP INCHARGE', 'MIS', 'ACCOUNTS', 'Branding verification')
        OR em.sale_access != 'Primary'
        OR em.level = 'branding'
      )
  `);

  // 10. Regenerate Kishan Das C1 and C2 plans with balanced dealer-first scheduling
  console.log('[10] Regenerating Kishan Das (1200178) plans for 2026-10 C1 & C2...');
  const autoGen = new AutoPlanGenerator();
  const c1Res = await autoGen.generatePlan('1200178', '2026-10', 'SO', 'C1', { isDjpPipeline: true, status: 'PENDING_ROLLOUT' });
  const c2Res = await autoGen.generatePlan('1200178', '2026-10', 'SO', 'C2', { isDjpPipeline: true, status: 'PENDING_ROLLOUT' });
  console.log(`     C1 Plan #${c1Res.planId}: ${c1Res.totalVisitsScheduled} visits scheduled`);
  console.log(`     C2 Plan #${c2Res.planId}: ${c2Res.totalVisitsScheduled} visits scheduled`);

  // 11. Audit and Summary
  console.log('\n[11] Summary Audit:');
  const [targetAudit] = await pool.query(`
    SELECT cust_type, COUNT(*) as count 
    FROM dealer_visit_targets 
    WHERE period_month = '2026-10' 
    GROUP BY cust_type
  `);
  console.log('dealer_visit_targets (2026-10):');
  console.table(targetAudit);

  const [planAudit] = await pool.query(`
    SELECT dealer_type, COUNT(*) as count 
    FROM sales_plan_details spd
    JOIN sales_plans sp ON spd.plan_id = sp.id
    WHERE sp.period_month = '2026-10'
    GROUP BY dealer_type
  `);
  console.log('sales_plan_details (2026-10):');
  console.table(planAudit);

  const [kishanAudit] = await pool.query(`
    SELECT sp.cycle_code, spd.dealer_type, COUNT(*) as visits, COUNT(DISTINCT spd.dealer_sap_code) as distinct_dealers
    FROM sales_plan_details spd
    JOIN sales_plans sp ON spd.plan_id = sp.id
    WHERE sp.period_month = '2026-10' AND (sp.emp_code = '1200178' OR sp.emp_name LIKE '%KISHAN DAS%')
    GROUP BY sp.cycle_code, spd.dealer_type
  `);
  console.log('Kishan Das (2026-10) Visits Breakdown:');
  console.table(kishanAudit);

  const dur = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\nFix completed successfully in ${dur}s.`);
}

if (process.argv[1]?.endsWith('fix-october-plans.js')) {
  fixOctoberPlans().then(() => process.exit(0)).catch(e => {
    console.error('Fix script failed:', e);
    process.exit(1);
  });
}

