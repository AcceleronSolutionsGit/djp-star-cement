import { dbAll, dbRun, dbGet } from '../config/database.js';

async function fastBackfill() {
  const startTime = Date.now();
  console.log('Starting fast in-memory employee code backfill...');

  const employees = await dbAll('SELECT emp_code, emp_name FROM master_employees WHERE emp_code IS NOT NULL AND emp_name IS NOT NULL');
  const empMap = new Map();
  for (const e of employees) {
    empMap.set(e.emp_name.trim().toUpperCase(), e.emp_code);
  }
  console.log(`Loaded ${empMap.size} employee mappings.`);

  // 1. SO names
  const soNames = await dbAll('SELECT DISTINCT so_name FROM dealer_visit_targets WHERE period_month = "2026-10" AND so_name IS NOT NULL');
  let soUpdated = 0;
  for (const { so_name } of soNames) {
    const code = empMap.get(so_name.trim().toUpperCase());
    if (code) {
      await dbRun('UPDATE dealer_visit_targets SET so_emp_code = ? WHERE period_month = "2026-10" AND so_name = ?', [code, so_name]);
      soUpdated++;
    }
  }
  console.log(`Backfilled ${soUpdated}/${soNames.length} distinct SOs.`);

  // 2. ASM names
  const asmNames = await dbAll('SELECT DISTINCT asm_name FROM dealer_visit_targets WHERE period_month = "2026-10" AND asm_name IS NOT NULL');
  let asmUpdated = 0;
  for (const { asm_name } of asmNames) {
    const code = empMap.get(asm_name.trim().toUpperCase());
    if (code) {
      await dbRun('UPDATE dealer_visit_targets SET asm_code = ? WHERE period_month = "2026-10" AND asm_name = ?', [code, asm_name]);
      asmUpdated++;
    }
  }
  console.log(`Backfilled ${asmUpdated}/${asmNames.length} distinct ASMs.`);

  // 3. RSM names
  const rsmNames = await dbAll('SELECT DISTINCT rsm_name FROM dealer_visit_targets WHERE period_month = "2026-10" AND rsm_name IS NOT NULL');
  let rsmUpdated = 0;
  for (const { rsm_name } of rsmNames) {
    const code = empMap.get(rsm_name.trim().toUpperCase());
    if (code) {
      await dbRun('UPDATE dealer_visit_targets SET rsm_code = ? WHERE period_month = "2026-10" AND rsm_name = ?', [code, rsm_name]);
      rsmUpdated++;
    }
  }
  console.log(`Backfilled ${rsmUpdated}/${rsmNames.length} distinct RSMs.`);

  // 4. ZH names
  const zhNames = await dbAll('SELECT DISTINCT zh_name FROM dealer_visit_targets WHERE period_month = "2026-10" AND zh_name IS NOT NULL');
  let zhUpdated = 0;
  for (const { zh_name } of zhNames) {
    const code = empMap.get(zh_name.trim().toUpperCase());
    if (code) {
      await dbRun('UPDATE dealer_visit_targets SET zh_code = ? WHERE period_month = "2026-10" AND zh_name = ?', [code, zh_name]);
      zhUpdated++;
    }
  }
  console.log(`Backfilled ${zhUpdated}/${zhNames.length} distinct ZHs.`);

  const stats = await dbGet(`
    SELECT 
      count(*) as total,
      sum(case when so_emp_code is not null and so_emp_code != '' then 1 else 0 end) as has_so_code,
      sum(case when asm_code is not null and asm_code != '' then 1 else 0 end) as has_asm_code,
      sum(case when rsm_code is not null and rsm_code != '' then 1 else 0 end) as has_rsm_code,
      sum(case when zh_code is not null and zh_code != '' then 1 else 0 end) as has_zh_code
    FROM dealer_visit_targets
    WHERE period_month = '2026-10'
  `);
  console.log(`Completed in ${Date.now() - startTime}ms. Stats:`, stats);

  process.exit(0);
}

fastBackfill().catch(console.error);
