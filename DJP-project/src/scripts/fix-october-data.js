import { dbAll, dbGet, dbRun, pool } from '../config/database.js';
import { healAllMissingZonalHeads, refreshDynamicZonalHeadCache } from '../services/zonalHead.service.js';
import { buildAdherenceWorkbook } from '../services/adherenceExport.service.js';
import { syncMasterEmployeesFromEmployeeMaster } from '../services/employeeMaster.service.js';

export async function fixOctoberData() {
  const startTime = Date.now();
  console.log('================================================================');
  console.log('Star Cement DJP — Fix Existing October 2026 Data & ZH Mappings');
  console.log('================================================================\n');

  // [1] Ensure Authoritative master_zone_zh_mapping has active Zonal Heads
  console.log('[1] Updating master_zone_zh_mapping with active Zonal Heads...');
  await dbRun(`
    UPDATE master_zone_zh_mapping
    SET 
      zh_name = 'GIRIDHARI MUKHERJEE',
      zh_code = '11002257',
      emp_code = 'E2352',
      designation = 'General Manager',
      level = 'L5',
      updated_at = NOW()
    WHERE zone_code IN ('NB1', 'NB2', 'NB 1', 'NB 2', 'NB-1', 'NB-2')
       OR zh_name LIKE '%DIBYAJYOTI GUHA%' 
       OR zh_code = '1100380' 
       OR emp_code = 'E0259'
  `);

  await dbRun(`
    UPDATE master_zone_zh_mapping
    SET 
      zh_name = 'BRIJESH SINGH',
      zh_code = '11001891',
      emp_code = 'E1720',
      designation = 'General Manager',
      level = 'L5',
      updated_at = NOW()
    WHERE zone_code IN ('NE2', 'NE 2', 'NE-2')
  `);

  await dbRun(`
    UPDATE master_zone_zh_mapping
    SET 
      zh_name = 'TARAK NATH GHOSH',
      zh_code = '1100077',
      emp_code = 'E0174',
      designation = 'General Manager',
      level = 'L5',
      updated_at = NOW()
    WHERE zone_code IN ('NE1', 'NE 1', 'NE-1')
  `);

  await dbRun(`
    UPDATE master_zone_zh_mapping
    SET 
      zh_name = 'GIRIDHARI MUKHERJEE',
      zh_code = '11002257',
      emp_code = 'E2352',
      designation = 'General Manager',
      level = 'L5',
      updated_at = NOW()
    WHERE zone_code IN ('BIHAR', 'BH', 'BH1', 'BH2', 'BH-1', 'BH-2')
       OR zh_name LIKE '%RAJESH SRIVASTAVA%'
       OR zh_code = '1100067'
       OR emp_code = 'E0003'
  `);

  // [2] Heal zone assignments in dealer_visit_targets from SFA data, branch/area
  console.log('[2] Normalizing Zones across dealer_visit_targets (2026-10)...');

  // 2a. Sync zone from SFA Customer Coordinates
  await dbRun(`
    UPDATE dealer_visit_targets t
    JOIN master_customer_coordinates c ON (t.sap_code = c.dns_customer_code OR t.sfa_code = c.dns_customer_code OR t.sfa_code = c.display_code)
    SET t.zone = c.zone
    WHERE c.zone IS NOT NULL AND c.zone != '' AND (t.zone IS NULL OR t.zone = '' OR t.zone = '-' OR (t.zone = 'NE1' AND c.zone != 'NE1'))
      AND t.period_month = '2026-10'
  `);

  // 2b. Sync zone from SFA Employee Master
  await dbRun(`
    UPDATE dealer_visit_targets t
    JOIN employee_master em ON (t.so_emp_code = em.dns_emp_code OR t.so_emp_code = em.emp_code)
    SET t.zone = em.zone
    WHERE em.zone IS NOT NULL AND em.zone != '' AND (t.zone IS NULL OR t.zone = '' OR t.zone = '-' OR (t.zone = 'NE1' AND em.zone != 'NE1'))
      AND t.period_month = '2026-10'
  `);

  await dbRun(`
    UPDATE dealer_visit_targets
    SET zone = CASE
      WHEN UPPER(TRIM(COALESCE(branch, area, dm_area, ''))) IN (
        'AGARTALA', 'UDAIPUR', 'DHARMANAGAR', 'MIZORAM', 'SILCHAR - CACHAR', 
        'SILCHAR - HAILAKANDI', 'SILCHAR - KARIMGANJ', 'SILCHAR', 'CACHAR', 
        'HAILAKANDI', 'KARIMGANJ', 'TRIPURA', 'AIZAWL', 'KAILASHAHAR', 
        'BELONIA', 'AMBASSA', 'TELIAMURA', 'BISHALGARH', 'SANTIRBAZAR', 'KHOWAI', 'MOHANPUR',
        'DUKLI', 'BAMUTIA', 'AMC (SADAR)', 'AMC', 'SADAR'
      ) THEN 'NE2'
      WHEN UPPER(TRIM(COALESCE(branch, area, dm_area, ''))) IN (
        'SILIGURI', 'JALPAIGURI', 'COOCHBEHAR', 'COOCH BEHAR', 'ALIPURDUAR', 
        'DARJEELING HILLS', 'DARJEELING PLAINS', 'SIKKIM', 'MANGAN'
      ) THEN 'NB1'
      WHEN UPPER(TRIM(COALESCE(branch, area, dm_area, ''))) IN ('MALDA', 'DAKSHIN DINAJPUR', 'UTTAR DINAJPUR', 'BALURGHAT', 'CHANCHAL', 'GAZOLE') THEN 'NB2'
      WHEN UPPER(TRIM(COALESCE(branch, area, dm_area, ''))) IN (
        'PATNA', 'MUZAFFARPUR', 'BHAGALPUR', 'PURNIA', 'KATIHAR', 'KISHANGANJ', 'SUPAUL', 'KAHALGAON',
        'WARSALIGANJ', 'WARISALIGANJ', 'WARSLIGANJ', 'NAWADA', 'CHHOTKI NAWADA', 'RAJAULI', 'RAJAULI BUS STAND',
        'HULASGANJ', 'GOBINDPUR', 'GOVINDPUR', 'GONAWA', 'HISUA', 'PAWAPURI', 'SHEIKHPURA', 'LAKHISARAI', 'JAMUI',
        'DHARAUT', 'MORGAW', 'SAHPUR MORE', 'NAI BAZAR', 'JEHANABAD TOWN', 'PAKRIWARABA', 'PAKRIWARABA BAZAR'
      ) THEN 'BIHAR'
      WHEN UPPER(TRIM(COALESCE(branch, area, dm_area, ''))) IN ('KOLKATA', 'HOWRAH', 'HOOGHLY', 'BURDWAN', 'DURGAPUR') THEN 'SOUTH BENGAL'
      ELSE COALESCE(NULLIF(zone, ''), 'NE1')
    END
    WHERE period_month = '2026-10'
  `);

  // [3] Correct Zonal Heads in dealer_visit_targets (2026-10)
  console.log('[3] Updating Zonal Head assignments in dealer_visit_targets (2026-10)...');
  // NB1 and NB2 -> Giridhari Mukherjee (replacing Dibyajyoti Guha)
  const resNb = await dbRun(`
    UPDATE dealer_visit_targets
    SET 
      zh_name = 'GIRIDHARI MUKHERJEE',
      zh_code = '11002257'
    WHERE period_month = '2026-10'
      AND (
        zone IN ('NB1', 'NB2')
        OR zh_name LIKE '%DIBYAJYOTI%'
        OR zh_code = '1100380'
      )
  `);
  console.log(`    Updated NB1/NB2 targets to Giridhari Mukherjee: ${resNb.affectedRows || resNb.changes || 0} rows`);

  // NE2 -> Brijesh Singh (correcting any Tarak Nath Ghosh assigned to NE2)
  const resNe2 = await dbRun(`
    UPDATE dealer_visit_targets
    SET 
      zh_name = 'BRIJESH SINGH',
      zh_code = '11001891'
    WHERE period_month = '2026-10'
      AND zone = 'NE2'
  `);
  console.log(`    Updated NE2 targets to Brijesh Singh: ${resNe2.affectedRows || resNe2.changes || 0} rows`);

  // NE1 -> Tarak Nath Ghosh
  const resNe1 = await dbRun(`
    UPDATE dealer_visit_targets
    SET 
      zh_name = 'TARAK NATH GHOSH',
      zh_code = '1100077'
    WHERE period_month = '2026-10'
      AND zone = 'NE1'
  `);
  console.log(`    Updated NE1 targets to Tarak Nath Ghosh: ${resNe1.affectedRows || resNe1.changes || 0} rows`);

  // BIHAR -> Giridhari Mukherjee (replacing inactive Rajesh Srivastava)
  const resBh = await dbRun(`
    UPDATE dealer_visit_targets
    SET 
      zh_name = 'GIRIDHARI MUKHERJEE',
      zh_code = '11002257'
    WHERE period_month = '2026-10'
      AND (zone = 'BIHAR' OR zh_name LIKE '%RAJESH SRIVASTAVA%' OR zh_code = '1100067')
  `);
  console.log(`    Updated BIHAR targets to Giridhari Mukherjee: ${resBh.affectedRows || resBh.changes || 0} rows`);

  // NE2 RSM -> Saurabh Kumar (replacing VACANT / 1329)
  const resRsmNe2 = await dbRun(`
    UPDATE dealer_visit_targets
    SET 
      rsm_name = 'SAURABH KUMAR',
      rsm_code = '11001892'
    WHERE period_month = '2026-10'
      AND zone = 'NE2'
      AND (rsm_name IS NULL OR rsm_name = '' OR rsm_name = 'VACANT' OR rsm_name = 'NONE' OR rsm_code = '1329' OR rsm_code = 'VACANT')
  `);
  console.log(`    Updated NE2 targets RSM to Saurabh Kumar: ${resRsmNe2.affectedRows || resRsmNe2.changes || 0} rows`);

  // [4] Run universal healing across master tables
  console.log('\n[4] Running universal healing across master_dealers, master_dealer_so_mapping, dealer_visit_targets...');
  await refreshDynamicZonalHeadCache(true);
  const healResult = await healAllMissingZonalHeads();
  console.log(`    Universal heal result:`, healResult);

  // [4b] Synchronize employee roles in master_employees from employee_master
  console.log('\n[4b] Synchronizing employee roles in master_employees...');
  await syncMasterEmployeesFromEmployeeMaster();

  // [4c] Heal sales_plans L1 Approvers for RSMs to their active L5 Sales Heads
  console.log('\n[4c] Healing sales_plans L1 Approvers for RSMs...');
  // Saurabh Kumar -> Brijesh Singh
  await dbRun(`
    UPDATE sales_plans
    SET l1_approver_emp_code = '11001891', l1_approver_name = 'BRIJESH SINGH', l1_approver_role = 'ZH'
    WHERE emp_code = '11001892'
  `);
  // Ritwick Chatterjee, Prakriti Ranjan Sikdar, Ram Raj Singh, Shashi Kant Mishra -> Giridhari Mukherjee
  await dbRun(`
    UPDATE sales_plans
    SET l1_approver_emp_code = '11002257', l1_approver_name = 'GIRIDHARI MUKHERJEE', l1_approver_role = 'ZH'
    WHERE emp_code IN ('11001813', '1101157', '11002396', '11001478')
  `);
  // Basudev Roy, Divy Pandey, Subhasish Bhowmik, Vikash Kumar -> Tarak Nath Ghosh
  await dbRun(`
    UPDATE sales_plans
    SET l1_approver_emp_code = '1100077', l1_approver_name = 'TARAK NATH GHOSH', l1_approver_role = 'ZH'
    WHERE emp_code IN ('1100126', '2500198', '11002241', '11001902')
  `);
  // Update any sales_plans for Rajesh Srivastava to Giridhari Mukherjee
  await dbRun(`
    UPDATE sales_plans
    SET emp_code = '11002257', emp_name = 'GIRIDHARI MUKHERJEE'
    WHERE emp_code = '1100067'
  `);

  // [5] Audit & Verification
  console.log('\n[5] Auditing October 2026 Data...');
  const auditRows = await dbAll(`
    SELECT cycle_code, zone, zh_name, zh_code, count(*) as count 
    FROM dealer_visit_targets 
    WHERE period_month = '2026-10'
    GROUP BY cycle_code, zone, zh_name, zh_code
    ORDER BY cycle_code, zone
  `);
  console.table(auditRows);

  const dibyaCount = await dbGet(`
    SELECT COUNT(*) as count 
    FROM dealer_visit_targets 
    WHERE period_month = '2026-10' AND zh_name LIKE '%DIBYAJYOTI%'
  `);
  console.log(`    Inactive ZH (Dibyajyoti Guha) in 2026-10 targets: ${dibyaCount?.count || 0}`);

  const tarakNe2Count = await dbGet(`
    SELECT COUNT(*) as count 
    FROM dealer_visit_targets 
    WHERE period_month = '2026-10' AND zone = 'NE2' AND zh_name LIKE '%TARAK%'
  `);
  console.log(`    Wrong ZH (Tarak Nath Ghosh in NE2) in 2026-10 targets: ${tarakNe2Count?.count || 0}`);

  // [6] Verify Adherence Export
  console.log('\n[6] Verifying Adherence Export for NaN values...');
  const adhWb = await buildAdherenceWorkbook({ periodMonth: '2026-10', cycleCode: 'C1' });
  let nanFound = 0;
  for (const sheet of ['Summary', 'SO', 'ASM', 'RSM', 'ZH']) {
    const ws = adhWb.getWorksheet(sheet);
    if (!ws) continue;
    ws.eachRow(row => {
      row.eachCell(cell => {
        if (String(cell.value ?? '').includes('NaN')) nanFound++;
      });
    });
  }
  if (nanFound === 0) {
    console.log('    ✓ Adherence Export: ZERO NaNs verified across all sheets.');
  } else {
    console.error(`    ✗ Adherence Export: Found ${nanFound} NaN values!`);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n================================================================`);
  console.log(`✓ Fix completed successfully in ${duration}s.`);
  console.log(`================================================================`);
}

if (process.argv[1]?.endsWith('fix-october-data.js')) {
  fixOctoberData().then(() => process.exit(0)).catch(e => {
    console.error('Fix script failed:', e);
    process.exit(1);
  });
}
