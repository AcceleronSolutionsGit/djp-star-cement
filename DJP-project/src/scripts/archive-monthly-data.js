import { dbRun, dbExec } from '../config/database.js';

/**
 * Script to archive data from a specific month.
 * Usage: node archive-monthly-data.js 2026-05
 */

async function archiveMonthData(month) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error('Please provide a valid month in YYYY-MM format (e.g. 2026-05)');
    process.exit(1);
  }

  console.log(`Starting archiving process for month: ${month}`);

  try {
    // 1. visit_execution_logs (using visit_date LIKE 'YYYY-MM-%')
    console.log('Archiving visit_execution_logs...');
    const visitRes = await dbRun(`
      INSERT IGNORE INTO visit_execution_logs_archive (id, visit_date, customer_code, customer_name, customer_type, route, branch, employee_code, employee_name, check_in_time, check_out_time, duration, visit_status, purpose_of_visit, remarks, batch_code, created_at)
      SELECT id, visit_date, customer_code, customer_name, customer_type, route, branch, employee_code, employee_name, check_in_time, check_out_time, duration, visit_status, purpose_of_visit, remarks, batch_code, created_at
      FROM visit_execution_logs
      WHERE visit_date LIKE ?
    `, [`${month}-%`]);
    console.log(`- Archived ${visitRes.affectedRows} rows.`);
    await dbRun(`DELETE FROM visit_execution_logs WHERE visit_date LIKE ?`, [`${month}-%`]);

    // 2. sales_plans & sales_plan_details (using period_month)
    console.log('Archiving sales_plans and details...');
    const planRes = await dbRun(`
      INSERT IGNORE INTO sales_plans_archive (id, emp_code, emp_name, period_month, status, submitted_at, approved_by, approved_at, remarks, created_at)
      SELECT id, emp_code, emp_name, period_month, status, submitted_at, approved_by, approved_at, remarks, created_at
      FROM sales_plans
      WHERE period_month = ?
    `, [month]);
    console.log(`- Archived ${planRes.affectedRows} sales_plans rows.`);

    const planDetailRes = await dbRun(`
      INSERT IGNORE INTO sales_plan_details_archive (id, plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence, created_at)
      SELECT spd.id, spd.plan_id, spd.visit_date, spd.dealer_id, spd.dealer_sap_code, spd.dealer_name, spd.dealer_type, spd.purpose_of_visit, spd.sequence, spd.created_at
      FROM sales_plan_details spd
      JOIN sales_plans sp ON spd.plan_id = sp.id
      WHERE sp.period_month = ?
    `, [month]);
    console.log(`- Archived ${planDetailRes.affectedRows} sales_plan_details rows.`);

    // Delete details first, then plans (cascading normally handles this, but just to be safe)
    await dbRun(`DELETE spd FROM sales_plan_details spd JOIN sales_plans sp ON spd.plan_id = sp.id WHERE sp.period_month = ?`, [month]);
    await dbRun(`DELETE FROM sales_plans WHERE period_month = ?`, [month]);


    // 3. sales_history
    console.log('Archiving sales_history...');
    const historyRes = await dbRun(`
      INSERT IGNORE INTO sales_history_archive (id, sap_code, rssd_code, linked_dealer_code, linked_dealer_name, sub_dealer_name, zone, period_year_month, quantity_mt, batch_code, created_at)
      SELECT id, sap_code, rssd_code, linked_dealer_code, linked_dealer_name, sub_dealer_name, zone, period_year_month, quantity_mt, batch_code, created_at
      FROM sales_history
      WHERE period_year_month = ?
    `, [month]);
    console.log(`- Archived ${historyRes.affectedRows} rows.`);
    await dbRun(`DELETE FROM sales_history WHERE period_year_month = ?`, [month]);

    // 4. dealer_visit_targets
    console.log('Archiving dealer_visit_targets...');
    const targetRes = await dbRun(`
      INSERT IGNORE INTO dealer_visit_targets_archive (id, generation_run_code, period_month, cycle_code, dealer_id, dealer_name, sap_code, sfa_code, area, zone, category, dealer_status, so_name, so_emp_code, so_visits, asm_visits, rsm_visits, zh_visits, total_visits, so_visits_pct, asm_visits_pct, rsm_visits_pct, zh_visits_pct, batch_code, created_at)
      SELECT id, generation_run_code, period_month, cycle_code, dealer_id, dealer_name, sap_code, sfa_code, area, zone, category, dealer_status, so_name, so_emp_code, so_visits, asm_visits, rsm_visits, zh_visits, total_visits, so_visits_pct, asm_visits_pct, rsm_visits_pct, zh_visits_pct, batch_code, created_at
      FROM dealer_visit_targets
      WHERE period_month = ?
    `, [month]);
    console.log(`- Archived ${targetRes.affectedRows} rows.`);
    await dbRun(`DELETE FROM dealer_visit_targets WHERE period_month = ?`, [month]);

    console.log('Archiving completed successfully!');
  } catch (err) {
    console.error('Error during archiving:', err);
  }

  process.exit(0);
}

const argMonth = process.argv[2];
if (argMonth) {
  archiveMonthData(argMonth);
} else {
  console.log('Usage: node archive-monthly-data.js YYYY-MM');
  process.exit(1);
}
