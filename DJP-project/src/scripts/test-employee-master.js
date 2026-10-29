import http from 'http';
import express from 'express';
import apiRoutes from '../routes/api.routes.js';
import { dbGet, dbAll } from '../config/database.js';
import {
  fetchEmployeeMasterFromApi,
  syncEmployeeMasterFromApi,
  getEmployeeMasterStatus,
  searchEmployeesFromMaster,
  getEmployeeByCode
} from '../services/employeeMaster.service.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runEmployeeMasterTests() {
  console.log('===============================================================');
  console.log('  TESTING EMPLOYEE MASTER FEATURE (SFA API & DATABASE TABLE)');
  console.log('===============================================================\n');

  // -------------------------------------------------------------------------
  // TEST SUITE 1: Table Schema Verification
  // -------------------------------------------------------------------------
  console.log('--- Test Suite 1: Schema Verification for employee_master ---');
  const cols = await dbAll('DESCRIBE employee_master');
  const colMap = new Map(cols.map(c => [c.Field, c]));

  const requiredApiFields = [
    'emp_code', 'dns_emp_code', 'emp_name', 'dob', 'acedns',
    'branch_code', 'doj', 'lower_leaves', 'reporting_to', 'vertical_value',
    'email', 'phone_no', 'hq', 'sale_access', 'designation',
    'district', 'state', 'zone', 'region', 'app_access',
    'functionality', 'functionality_rel_val', 'level', 'acedns_changed_date', 'download_time'
  ];

  for (const field of requiredApiFields) {
    assert(colMap.has(field), `Field '${field}' exists in employee_master table`);
  }
  assert(colMap.has('id'), `Metadata column 'id' (Primary Key) exists`);
  assert(colMap.has('created_at'), `Metadata column 'created_at' exists`);
  assert(colMap.has('updated_at'), `Metadata column 'updated_at' exists`);

  // Verify lower_leaves data type supports large hierarchy strings (> 40k chars)
  const lowerLeavesCol = colMap.get('lower_leaves');
  assert(
    lowerLeavesCol.Type.includes('longtext') || lowerLeavesCol.Type.includes('mediumtext'),
    `lower_leaves has large text type (${lowerLeavesCol.Type})`
  );

  // -------------------------------------------------------------------------
  // TEST SUITE 2: API Ingestion & Sync Verification
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 2: API Ingestion & In-DB Sync ---');
  const rawApiRecords = await fetchEmployeeMasterFromApi();
  assert(rawApiRecords.length > 2000, `Fetched ${rawApiRecords.length} records from live SFA API (> 2,000)`);

  const syncResult = await syncEmployeeMasterFromApi({ force: true });
  console.log('Sync Result:', syncResult);
  assert(syncResult.success === true, `syncEmployeeMasterFromApi succeeded`);
  assert(syncResult.upsertedCount >= rawApiRecords.length, `Upserted ${syncResult.upsertedCount} records`);

  const countRow = await dbGet('SELECT COUNT(*) as cnt FROM employee_master');
  assert(countRow.cnt >= rawApiRecords.length, `Database has ${countRow.cnt} rows matching API volume`);

  // -------------------------------------------------------------------------
  // TEST SUITE 3: Data Quality & Integrity Checks
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 3: Data Quality & Large Hierarchy Check ---');
  // Check record with long lower_leaves
  const deepHierarchyRow = await dbGet(`
    SELECT emp_code, dns_emp_code, emp_name, designation, LENGTH(lower_leaves) as leaf_len 
    FROM employee_master 
    WHERE lower_leaves IS NOT NULL AND LENGTH(lower_leaves) > 5000 
    ORDER BY LENGTH(lower_leaves) DESC 
    LIMIT 1
  `);
  console.log('Deep hierarchy record sample:', deepHierarchyRow);
  assert(deepHierarchyRow != null, `Found employee with large hierarchy (${deepHierarchyRow?.emp_name})`);
  assert(deepHierarchyRow.leaf_len > 5000, `Hierarchy length is ${deepHierarchyRow.leaf_len} characters`);

  // Check lookup by emp_code and dns_emp_code
  const empBySfa = await getEmployeeByCode('E1194');
  assert(empBySfa && empBySfa.emp_name === 'AAKASH KUMAR SAH', `Lookup by SFA emp_code ('E1194') returned ${empBySfa?.emp_name}`);

  const empByDns = await getEmployeeByCode('11001551');
  assert(empByDns && empByDns.emp_code === 'E1194', `Lookup by DNS emp_code ('11001551') returned matching record ${empByDns?.emp_code}`);

  // -------------------------------------------------------------------------
  // TEST SUITE 4: Search & Filtering Service Functions
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 4: Search & Filter Capabilities ---');
  // 4a. Search by keyword
  const searchRes = await searchEmployeesFromMaster({ search: 'AAKASH', limit: 5 });
  assert(searchRes.count > 0, `Search for 'AAKASH' returned ${searchRes.count} results (total matching: ${searchRes.total})`);

  // 4b. Filter by designation 'SO'
  const soRes = await searchEmployeesFromMaster({ designation: 'SO', limit: 5 });
  assert(soRes.total > 100, `Filter by designation 'SO' returned ${soRes.total} records (> 100)`);

  // 4c. Filter by zone 'NE2'
  const zoneRes = await searchEmployeesFromMaster({ zone: 'NE2', limit: 5 });
  assert(zoneRes.total > 50, `Filter by zone 'NE2' returned ${zoneRes.total} records (> 50)`);

  // 4d. Status overview
  const statusRes = await getEmployeeMasterStatus();
  console.log('Employee master status overview:', statusRes);
  assert(statusRes.totalEmployeesInMaster >= 2500, `Total employees: ${statusRes.totalEmployeesInMaster}`);
  assert(statusRes.distinctDesignations > 50, `Distinct designations: ${statusRes.distinctDesignations} (> 50)`);
  assert(statusRes.distinctZones > 5, `Distinct zones: ${statusRes.distinctZones} (> 5)`);
  assert(statusRes.masterEmployeesEnrichedCount > 1000, `Enriched master_employees count: ${statusRes.masterEmployeesEnrichedCount} (> 1,000)`);

  // -------------------------------------------------------------------------
  // TEST SUITE 5: Live Express HTTP Endpoints
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 5: Live Express HTTP Endpoints ---');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Ephemeral test server running at ${baseUrl}`);

  try {
    // 5a. GET /api/sync/employee-master/status
    const stHttp = await fetch(`${baseUrl}/api/sync/employee-master/status`);
    assert(stHttp.status === 200, `GET /api/sync/employee-master/status returned HTTP 200`);
    const stJson = await stHttp.json();
    assert(stJson.success === true && stJson.totalEmployeesInMaster > 2500, `Status endpoint returned valid data (${stJson.totalEmployeesInMaster} records)`);

    // 5b. GET /api/employees/master?search=AAKASH
    const listHttp = await fetch(`${baseUrl}/api/employees/master?search=AAKASH&limit=10`);
    assert(listHttp.status === 200, `GET /api/employees/master?search=AAKASH returned HTTP 200`);
    const listJson = await listHttp.json();
    assert(listJson.success === true && listJson.count > 0, `List endpoint returned ${listJson.count} matching employees`);

    // 5c. GET /api/employees/master/E1194
    const detailHttp = await fetch(`${baseUrl}/api/employees/master/E1194`);
    assert(detailHttp.status === 200, `GET /api/employees/master/E1194 returned HTTP 200`);
    const detailJson = await detailHttp.json();
    assert(detailJson.employee?.emp_code === 'E1194', `Detail endpoint returned employee ${detailJson.employee?.emp_name}`);

    // 5d. GET /api/employees/master/UNKNOWN_CODE_999 (404 check)
    const notFoundHttp = await fetch(`${baseUrl}/api/employees/master/UNKNOWN_CODE_999`);
    assert(notFoundHttp.status === 404, `GET /api/employees/master/UNKNOWN_CODE_999 properly returned HTTP 404`);
  } finally {
    server.close();
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`  EMPLOYEE MASTER TEST SUITE COMPLETE: ${passedTests} / ${totalTests} ASSERTIONS PASSED (100%)`);
  console.log('===============================================================\n');

  process.exit(0);
}

runEmployeeMasterTests().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});

