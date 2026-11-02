import { dbAll } from '../config/database.js';

async function verifyActiveOnly() {
  console.log('=== VERIFYING ACTIVE-ONLY PLANS IN DATABASE ===');

  // 1. Check for any inactive employee in sales_plans
  const inactivePlans = await dbAll(`
    SELECT sp.id, sp.emp_code, sp.emp_name, sp.emp_role, sp.period_month, sp.cycle_code,
           em.acedns, em.app_access, zh.id as is_zh
    FROM sales_plans sp
    LEFT JOIN employee_master em ON (sp.emp_code = em.emp_code OR sp.emp_code = em.dns_emp_code)
    LEFT JOIN master_zone_zh_mapping zh ON (sp.emp_code = zh.zh_code OR sp.emp_code = zh.emp_code)
    WHERE (em.acedns = 'N' OR (em.acedns IS NULL AND em.app_access = 'N'))
      AND NOT (sp.emp_role = 'ZH' AND zh.id IS NOT NULL)
  `);

  console.log('Inactive employee plans in sales_plans (should be 0):', inactivePlans.length);
  if (inactivePlans.length > 0) {
    console.error('FAILED: Found inactive employee plans:', inactivePlans);
  }

  // 2. Check for any dummy/vacant employee in sales_plans
  const dummyPlans = await dbAll(`
    SELECT sp.id, sp.emp_code, sp.emp_name, sp.emp_role, sp.period_month, sp.cycle_code
    FROM sales_plans sp
    WHERE sp.emp_code IN ('VACANT', 'NONE', 'NULL', 'NA', 'N/A', '-')
       OR UPPER(sp.emp_code) LIKE 'VACANT%'
       OR sp.emp_code REGEXP '^(SO|ASM|RSM|ZH)[0-9]+$'
       OR UPPER(sp.emp_name) LIKE 'VACANT%'
  `);

  console.log('Dummy/Vacant plans in sales_plans (should be 0):', dummyPlans.length);
  if (dummyPlans.length > 0) {
    console.error('FAILED: Found dummy employee plans:', dummyPlans);
  }

  // 3. Check for any inactive employees in master_employees
  const inactiveInMaster = await dbAll(`
    SELECT me.id, me.emp_code, me.emp_name, me.designation, em.acedns
    FROM master_employees me
    JOIN employee_master em ON (me.emp_code = em.emp_code OR me.emp_code = em.dns_emp_code)
    WHERE em.acedns = 'N' OR em.app_access = 'N'
  `);

  console.log('Inactive employees in master_employees (should be 0):', inactiveInMaster.length);
  if (inactiveInMaster.length > 0) {
    console.error('FAILED: Found inactive employees in master_employees:', inactiveInMaster);
  }

  // 4. Check for dummy employees in master_employees
  const dummyInMaster = await dbAll(`
    SELECT me.id, me.emp_code, me.emp_name
    FROM master_employees me
    WHERE me.emp_code IN ('VACANT', 'NONE', 'NULL', 'NA', 'N/A', '-')
       OR UPPER(me.emp_code) LIKE 'VACANT%'
       OR me.emp_code REGEXP '^(SO|ASM|RSM|ZH)[0-9]+$'
  `);

  console.log('Dummy employees in master_employees (should be 0):', dummyInMaster.length);
  if (dummyInMaster.length > 0) {
    console.error('FAILED: Found dummy employees in master_employees:', dummyInMaster);
  }

  // 5. Total active plans count
  const activePlansCount = await dbAll(`SELECT COUNT(*) as cnt FROM sales_plans`);
  console.log('Total verified ACTIVE plans in database:', activePlansCount[0].cnt);

  const passed = inactivePlans.length === 0 && dummyPlans.length === 0 && inactiveInMaster.length === 0 && dummyInMaster.length === 0;
  if (passed) {
    console.log('\n✅ ALL VERIFICATION CHECKS PASSED: 100% of plans and master records belong to ACTIVE entities!');
    process.exit(0);
  } else {
    console.error('\n❌ VERIFICATION CHECKS FAILED!');
    process.exit(1);
  }
}

verifyActiveOnly();

