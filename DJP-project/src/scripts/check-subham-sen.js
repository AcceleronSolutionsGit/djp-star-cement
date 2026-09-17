import { dbAll } from '../config/database.js';

async function main() {
  const targets = await dbAll(`
    SELECT id, dealer_name, sap_code, so_name, so_emp_code, asm_name, so_visits, asm_visits, rsm_visits, zh_visits, total_visits, period_month, cycle_code 
    FROM dealer_visit_targets 
    WHERE so_name LIKE '%SUBHAM SEN%' OR dealer_name LIKE '%BISWAKARMA%'
  `);
  console.log('Targets for Subham Sen / Biswakarma:');
  console.table(targets);

  const plans = await dbAll(`
    SELECT sp.id as plan_id, sp.emp_code, sp.emp_name, sp.period_month, spd.id as detail_id, spd.visit_date, spd.dealer_name, spd.dealer_sap_code 
    FROM sales_plans sp 
    JOIN sales_plan_details spd ON sp.id = spd.plan_id 
    WHERE sp.emp_code LIKE '%SUBHAM%' OR sp.emp_name LIKE '%SUBHAM%'
    ORDER BY spd.visit_date ASC
  `);
  console.log('Scheduled Plan visits for Subham Sen:');
  console.table(plans);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
