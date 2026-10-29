import http from 'http';
import express from 'express';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import apiRoutes from '../routes/api.routes.js';
import { dbGet, dbAll, dbRun } from '../config/database.js';
import {
  normalizeZone,
  findZoneByArea,
  resolveZonalHead,
  healAllMissingZonalHeads,
  getAllZonalHeadMappings
} from '../services/zonalHead.service.js';
import { resolveProspectHierarchy } from '../services/hierarchyResolution.service.js';
import { importDealerMapping } from '../imports/dealer-mapping.importer.js';

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

async function runZonalHeadTests() {
  console.log('===============================================================');
  console.log('  TESTING ZONAL HEAD RESOLUTION & AREA-ZONE MAPPING FEATURE');
  console.log('===============================================================\n');

  // -------------------------------------------------------------------------
  // TEST SUITE 1: master_zone_zh_mapping Table Verification
  // -------------------------------------------------------------------------
  console.log('--- Test Suite 1: Database Mapping Table Verification ---');
  const allMappings = await getAllZonalHeadMappings();
  assert(allMappings.length >= 6, `master_zone_zh_mapping has ${allMappings.length} canonical zones (>= 6)`);
  
  const zoneCodes = allMappings.map(m => m.zone_code);
  assert(zoneCodes.includes('NE2'), `Zone NE2 is mapped`);
  assert(zoneCodes.includes('NE1'), `Zone NE1 is mapped`);
  assert(zoneCodes.includes('NB1'), `Zone NB1 is mapped`);
  assert(zoneCodes.includes('SOUTH BENGAL'), `Zone SOUTH BENGAL is mapped`);
  assert(zoneCodes.includes('BIHAR'), `Zone BIHAR is mapped`);

  for (const m of allMappings) {
    assert(m.zh_name && m.zh_code && m.emp_code, `Zone [${m.zone_code}] has Zonal Head: ${m.zh_name} (${m.zh_code} / ${m.emp_code})`);
  }

  // -------------------------------------------------------------------------
  // TEST SUITE 2: Zone Normalization & Area Inference
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 2: Zone Normalization & Area Inference ---');
  assert(normalizeZone('NE-2') === 'NE2', `normalizeZone('NE-2') -> 'NE2'`);
  assert(normalizeZone('Zone NE1') === 'NE1', `normalizeZone('Zone NE1') -> 'NE1'`);
  assert(normalizeZone('NB-1') === 'NB1', `normalizeZone('NB-1') -> 'NB1'`);
  assert(normalizeZone('BH-1') === 'BIHAR', `normalizeZone('BH-1') -> 'BIHAR'`);
  assert(normalizeZone('SB') === 'SOUTH BENGAL', `normalizeZone('SB') -> 'SOUTH BENGAL'`);

  // Area to Zone
  const zAgt = await findZoneByArea('AGARTALA');
  assert(zAgt === 'NE2', `findZoneByArea('AGARTALA') -> 'NE2'`);

  const zGhy = await findZoneByArea('GUWAHATI');
  assert(zGhy === 'NE1', `findZoneByArea('GUWAHATI') -> 'NE1'`);

  const zSlg = await findZoneByArea('SILIGURI');
  assert(zSlg === 'NB1', `findZoneByArea('SILIGURI') -> 'NB1'`);

  const zPat = await findZoneByArea('PATNA');
  assert(zPat === 'BIHAR', `findZoneByArea('PATNA') -> 'BIHAR'`);

  // -------------------------------------------------------------------------
  // TEST SUITE 3: Zonal Head Resolution by Zone & Area
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 3: Zonal Head Resolution ---');
  // 3a. Explicit zone NE2
  const zhNe2 = await resolveZonalHead({ zone: 'NE2' });
  assert(zhNe2.zh_name === 'BRIJESH SINGH', `resolveZonalHead(NE2) -> BRIJESH SINGH (Code: ${zhNe2.zh_code})`);

  // 3b. Explicit zone NE1
  const zhNe1 = await resolveZonalHead({ zone: 'NE1' });
  assert(zhNe1.zh_name === 'TARAK NATH GHOSH', `resolveZonalHead(NE1) -> TARAK NATH GHOSH (Code: ${zhNe1.zh_code})`);

  // 3c. Explicit zone NB1
  const zhNb1 = await resolveZonalHead({ zone: 'NB1' });
  assert(zhNb1.zh_name === 'DIBYAJYOTI GUHA', `resolveZonalHead(NB1) -> DIBYAJYOTI GUHA (Code: ${zhNb1.zh_code})`);

  // 3d. Inferred from Area AGARTALA (no zone passed)
  const zhAreaAgt = await resolveZonalHead({ area: 'AGARTALA' });
  assert(zhAreaAgt.zone === 'NE2' && zhAreaAgt.zh_name === 'BRIJESH SINGH', `resolveZonalHead(area: AGARTALA) -> inferred NE2 -> BRIJESH SINGH`);

  // 3e. Inferred from Area SILIGURI (no zone passed)
  const zhAreaSlg = await resolveZonalHead({ area: 'SILIGURI' });
  assert(zhAreaSlg.zone === 'NB1' && zhAreaSlg.zh_name === 'DIBYAJYOTI GUHA', `resolveZonalHead(area: SILIGURI) -> inferred NB1 -> DIBYAJYOTI GUHA`);

  // -------------------------------------------------------------------------
  // TEST SUITE 4: Hierarchy Resolution Service Integration
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 4: Hierarchy Resolution Service Integration ---');
  const hRes = await resolveProspectHierarchy({
    area: 'AGARTALA',
    soName: 'TEST SO'
  });
  console.log('resolveProspectHierarchy result:', hRes);
  assert(hRes.zh_name === 'BRIJESH SINGH', `Prospect hierarchy resolved zh_name: '${hRes.zh_name}'`);
  assert(hRes.zh_code === '11001891', `Prospect hierarchy resolved zh_code: '${hRes.zh_code}'`);

  // -------------------------------------------------------------------------
  // TEST SUITE 5: Excel Import Simulation (Missing ZH Auto-Populated)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 5: Excel Upload Simulation with Missing ZH ---');
  // Create an Excel workbook in memory with a test dealer having NO zh_name and NO zh_code
  const testBatchCode = 'TEST_ZH_IMPORT_' + Date.now();
  const testSapCode = 'TEST_SAP_ZH_001';
  const testDealerRows = [
    {
      'Dealer Sap Code': testSapCode,
      'Dealer Name': 'TEST ZH AUTO DEALER',
      'Branch Name': 'AGARTALA',
      'Region': 'NE2',
      'SO Name': 'SANDIP DEY',
      'SO E Code': '1101046',
      'ASM Name': 'BIKRAM KUMAR HALDER',
      'ASM Code': '11001772',
      'RSM Name': 'GHALIB FAHAD AYUBI',
      'RSM Code': '11001907',
      'Zonal Head': '',  // INTENTIONALLY EMPTY IN EXCEL
      'ZH Code': ''      // INTENTIONALLY EMPTY IN EXCEL
    }
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(testDealerRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Dealer_Mapping');

  const tempFilePath = path.resolve('scratch', `temp_zh_upload_${Date.now()}.xlsx`);
  XLSX.writeFile(wb, tempFilePath);

  console.log(`  Running importDealerMapping on Excel without ZH fields...`);
  const importResult = await importDealerMapping(tempFilePath, testBatchCode);
  console.log('  Import Result:', importResult);

  // Clean up temp file
  if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

  // Check database row in master_dealers
  const importedDealer = await dbGet(
    'SELECT sap_code, dealer_name, area, region, zh_name, zh_code FROM master_dealers WHERE sap_code = ?',
    [testSapCode]
  );
  console.log('  Imported Dealer in DB:', importedDealer);
  assert(importedDealer != null, `Test dealer was inserted in master_dealers`);
  assert(importedDealer.zh_name === 'BRIJESH SINGH', `ZH Name was auto-populated as '${importedDealer.zh_name}' from employee_master mapping`);
  assert(importedDealer.zh_code === '11001891', `ZH Code was auto-populated as '${importedDealer.zh_code}'`);

  // Clean up test dealer
  await dbRun('DELETE FROM master_dealers WHERE sap_code = ?', [testSapCode]);
  await dbRun('DELETE FROM master_dealer_so_mapping WHERE sap_code = ?', [testSapCode]);

  // -------------------------------------------------------------------------
  // TEST SUITE 6: Database Healing Service
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 6: Database Healing Service ---');
  // Insert a dealer with NULL zh_name and region = 'NE1'
  const healTestSap = 'TEST_HEAL_001';
  await dbRun(`
    INSERT INTO master_dealers (sap_code, dealer_name, area, region, zh_name, zh_code, dealer_type, status)
    VALUES (?, 'TEST HEAL DEALER', 'GUWAHATI', 'NE1', NULL, NULL, 'DEALER', 'ACTIVE')
  `, [healTestSap]);

  const healStats = await healAllMissingZonalHeads();
  console.log('Healing stats:', healStats);
  assert(healStats.dealersHealed >= 1, `healAllMissingZonalHeads healed >= 1 dealers (healed: ${healStats.dealersHealed})`);

  const healedRow = await dbGet('SELECT zh_name, zh_code FROM master_dealers WHERE sap_code = ?', [healTestSap]);
  assert(healedRow.zh_name === 'TARAK NATH GHOSH', `Healed dealer in NE1 assigned TARAK NATH GHOSH (has: '${healedRow.zh_name}')`);
  assert(healedRow.zh_code === '1100077', `Healed dealer in NE1 assigned code 1100077 (has: '${healedRow.zh_code}')`);

  // Clean up
  await dbRun('DELETE FROM master_dealers WHERE sap_code = ?', [healTestSap]);

  // -------------------------------------------------------------------------
  // TEST SUITE 7: Live Express HTTP Endpoints
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 7: Live Express HTTP Endpoints ---');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Ephemeral test server running at ${baseUrl}`);

  try {
    // 7a. GET /api/hierarchy/zonal-heads
    const listRes = await fetch(`${baseUrl}/api/hierarchy/zonal-heads`);
    assert(listRes.status === 200, `GET /api/hierarchy/zonal-heads returned HTTP 200`);
    const listJson = await listRes.json();
    assert(listJson.success === true && listJson.mappings?.length >= 6, `Returned ${listJson.mappings?.length} zone mappings`);

    // 7b. GET /api/hierarchy/zonal-heads/resolve?area=SILIGURI
    const resRes = await fetch(`${baseUrl}/api/hierarchy/zonal-heads/resolve?area=SILIGURI`);
    assert(resRes.status === 200, `GET /api/hierarchy/zonal-heads/resolve?area=SILIGURI returned HTTP 200`);
    const resJson = await resRes.json();
    assert(resJson.zh_name === 'DIBYAJYOTI GUHA', `Resolved SILIGURI to DIBYAJYOTI GUHA (zone: ${resJson.zone})`);

    // 7c. POST /api/hierarchy/zonal-heads/heal
    const healRes = await fetch(`${baseUrl}/api/hierarchy/zonal-heads/heal`, { method: 'POST' });
    assert(healRes.status === 200, `POST /api/hierarchy/zonal-heads/heal returned HTTP 200`);
    const healJson = await healRes.json();
    assert(healJson.success === true, `Heal endpoint returned success: true`);
  } finally {
    await new Promise((res) => server.close(res));
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`  ZONAL HEAD TEST SUITE COMPLETE: ${passedTests} / ${totalTests} ASSERTIONS PASSED (100%)`);
  console.log('===============================================================\n');

  setTimeout(() => process.exit(0), 100);
}

runZonalHeadTests().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
