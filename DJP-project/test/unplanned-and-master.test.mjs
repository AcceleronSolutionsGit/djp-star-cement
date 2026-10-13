import assert from 'node:assert/strict';
import {
  getUnplannedVisits,
  getConsolidatedVisits,
  getPlannedVsUnplannedSummary,
  exportUnplannedVisitsToWorkbook
} from '../src/services/unplannedVisits.service.js';
import { buildRow } from '../src/services/masterSheet.service.js';

console.log('Testing Unplanned 3 Tabs and Master Sheet...');

// Test 1: Tab 1 Unplanned Visits returns the 16 fields
const unplanned = await getUnplannedVisits({ periodMonth: '2026-09', limit: 5 });
assert.ok(unplanned.total > 0, 'Unplanned total should be > 0');
assert.ok(unplanned.visits.length > 0, 'Unplanned visits should have items');
const firstU = unplanned.visits[0];
assert.ok('si' in firstU, 'Must have si');
assert.ok('date_of_visit' in firstU, 'Must have date_of_visit');
assert.ok('customer_code' in firstU, 'Must have customer_code');
assert.ok('customer_name' in firstU, 'Must have customer_name');
assert.ok('route' in firstU, 'Must have route');
assert.ok('type' in firstU, 'Must have type');
assert.ok('branch' in firstU, 'Must have branch');
assert.ok('employee_code' in firstU, 'Must have employee_code');
assert.ok('employee_name' in firstU, 'Must have employee_name');
assert.ok('role' in firstU, 'Must have role');
assert.ok('check_in_time' in firstU, 'Must have check_in_time');
assert.ok('check_out_time' in firstU, 'Must have check_out_time');
assert.ok('duration' in firstU, 'Must have duration');
assert.ok('visit_status' in firstU, 'Must have visit_status');
assert.ok('remarks' in firstU, 'Must have remarks');
assert.ok('purpose_of_visit' in firstU, 'Must have purpose_of_visit');
console.log('✓ Tab 1 (Unplanned) 16 fields validated successfully');

// Test 2: Tab 2 Consolidated Visits returns the 13 fields + summary
const cons = await getConsolidatedVisits({ periodMonth: '2026-09', limit: 5 });
assert.ok(cons.total > 0, 'Consolidated total should be > 0');
assert.ok(cons.rows.length > 0, 'Consolidated rows should have items');
assert.ok(cons.summary, 'Consolidated summary must exist');
const firstC = cons.rows[0];
assert.ok('month' in firstC, 'Must have month');
assert.ok('officer_name' in firstC, 'Must have officer_name');
assert.ok('role' in firstC, 'Must have role');
assert.ok('category' in firstC, 'Must have category');
assert.ok('zone' in firstC, 'Must have zone');
assert.ok('branch' in firstC, 'Must have branch');
assert.ok('customer_code' in firstC, 'Must have customer_code');
assert.ok('customer_name' in firstC, 'Must have customer_name');
assert.ok('planned_visits' in firstC, 'Must have planned_visits');
assert.ok('adhered_visits' in firstC, 'Must have adhered_visits');
assert.ok('adherence_pct' in firstC, 'Must have adherence_pct');
assert.ok('unplanned_visits' in firstC, 'Must have unplanned_visits');
assert.ok('concat' in firstC, 'Must have concat');
console.log('✓ Tab 2 (Consolidated) 13 fields and summary validated successfully');

// Test 3: Tab 3 Planned vs Unplanned Summary returns pivot and totals
const pvu = await getPlannedVsUnplannedSummary({ periodMonth: '2026-09', limit: 5 });
assert.ok(pvu.total > 0, 'Planned vs Unplanned total should be > 0');
assert.ok(pvu.rows.length > 0, 'Planned vs Unplanned rows should have items');
assert.ok(pvu.totals, 'Planned vs Unplanned totals must exist');
const firstP = pvu.rows[0];
assert.ok('officer_name' in firstP || 'officer_name_effective' in firstP, 'Must have officer_name');
assert.ok('role' in firstP || 'role_effective' in firstP, 'Must have role');
assert.ok('category' in firstP, 'Must have category');
assert.ok('planned_visits' in firstP, 'Must have planned_visits');
assert.ok('adhered_visits' in firstP, 'Must have adhered_visits');
assert.ok('adherence_pct' in firstP, 'Must have adherence_pct');
assert.ok('unplanned_visits' in firstP, 'Must have unplanned_visits');
assert.ok('total_planned_unplanned' in firstP, 'Must have total_planned_unplanned');
console.log('✓ Tab 3 (Planned vs Unplanned) 8 fields and grand totals validated successfully');

// Test 4: Excel export generates 3 worksheets
const wb = await exportUnplannedVisitsToWorkbook({ periodMonth: '2026-09' });
assert.equal(wb.worksheets.length, 3, 'Workbook must contain exactly 3 worksheets');
assert.equal(wb.worksheets[0].name, 'Unplanned', 'Sheet 1 must be Unplanned');
assert.equal(wb.worksheets[1].name, 'Consolidated', 'Sheet 2 must be Consolidated');
assert.equal(wb.worksheets[2].name, 'Planned vs Unplanned', 'Sheet 3 must be Planned vs Unplanned');
console.log('✓ 3-sheet ExcelJS workbook generated successfully');

// Test 5: Master sheet row includes ID and shows ASM for all rows (including prospects)
const mockTarget = {
  id: 42,
  dealer_name: 'TEST DEALER',
  cust_type: 'NON STAR',
  dealer_type: 'PROSPECTIVE',
  so_name: 'SO JOHN',
  asm_name: 'ASM SMITH',
  asm_visits: 2,
  so_visits: 4,
  sap_code: 'NSNE9999'
};
const row = buildRow(mockTarget, 0);
assert.equal(row.id, 42, 'Row must include id');
assert.equal(row.asm_name, 'ASM SMITH', 'Row must show ASM name without hiding for prospects');
assert.equal(row.asm_visits, 2, 'Row must show ASM visits without hiding for prospects');
console.log('✓ Master sheet buildRow correctly includes ID and displays ASMs without hiding');

console.log('ALL VERIFICATION CHECKS PASSED!');
