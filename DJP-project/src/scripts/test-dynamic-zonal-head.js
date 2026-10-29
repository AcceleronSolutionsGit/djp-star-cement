import { strict as assert } from 'assert';
import { dbGet, dbRun, dbAll } from '../config/database.js';
import {
  refreshDynamicZonalHeadCache,
  resolveZonalHeadSync,
  resolveZonalHead,
  healAllMissingZonalHeads,
  getAllZonalHeadMappings,
  normalizeZone
} from '../services/zonalHead.service.js';
import {
  updateZonalHeadMapping
} from '../controllers/zonalHead.controller.js';

async function runTests() {
  console.log('--- Starting Dynamic Zonal Head Tests ---');

  // 1. Warm cache
  const cache = await refreshDynamicZonalHeadCache(true);
  console.log(`✓ Dynamic cache loaded with ${cache.size} zone entries.`);
  assert(cache.size >= 7, 'Cache should contain at least 7 zones');

  // 2. Test dynamic resolution across zones & aliases
  const testCases = [
    { input: { zone: 'BIHAR' }, expectedZone: 'BIHAR' },
    { input: { zone: 'BH' }, expectedZone: 'BIHAR' },
    { input: { zone: 'BH-2' }, expectedZone: 'BIHAR' },
    { input: { zone: 'NE2' }, expectedZone: 'NE2' },
    { input: { zone: 'NE 2' }, expectedZone: 'NE2' },
    { input: { branch: 'AGARTALA' }, expectedZone: 'NE2' },
    { input: { branch: 'KAHALGAON' }, expectedZone: 'BIHAR' },
    { input: { area: 'MANGAN' }, expectedZone: 'NB1' },
    { input: { area: 'CHANCHAL-I' }, expectedZone: 'NB2' },
    { input: { zone: 'SOUTH BENGAL' }, expectedZone: 'SOUTH BENGAL' },
    { input: { zone: 'SB' }, expectedZone: 'SOUTH BENGAL' }
  ];

  for (const tc of testCases) {
    const res = resolveZonalHeadSync(tc.input);
    assert(res.zh_name, `ZH name must be present for ${JSON.stringify(tc.input)}`);
    assert(res.zone === tc.expectedZone, `Zone for ${JSON.stringify(tc.input)} should be ${tc.expectedZone}, got ${res.zone}`);
    console.log(`✓ Resolved ${JSON.stringify(tc.input)} -> Zone: ${res.zone}, ZH: ${res.zh_name} (${res.resolvedBy})`);
  }

  // 3. Test DYNAMIC CHANGE (Simulating organizational change of a Zonal Head)
  console.log('\n--- Testing Dynamic Organizational Change (No Hardcoding) ---');
  const originalBihar = cache.get('BIHAR');
  const testNewZhName = 'DUMMY TEST ZONAL HEAD';
  const testNewZhCode = 'ZH_TEST_9999';

  // Mock req/res to call controller endpoint
  let responseData = null;
  const mockReq = {
    params: { zoneCode: 'BIHAR' },
    body: {
      zh_name: testNewZhName,
      zh_code: testNewZhCode,
      designation: 'Sr. General Manager',
      level: 'L6'
    }
  };
  const mockRes = {
    json: (data) => { responseData = data; },
    status: () => mockRes
  };

  await updateZonalHeadMapping(mockReq, mockRes);
  assert(responseData?.success, 'updateZonalHeadMapping should return success: true');

  // Verify that resolveZonalHeadSync NOW returns the NEW Zonal Head IMMEDIATELY (no server restart)
  const afterUpdate = resolveZonalHeadSync({ zone: 'BIHAR' });
  assert.equal(afterUpdate.zh_name, testNewZhName, 'Dynamic cache must return newly updated ZH name immediately');
  assert.equal(afterUpdate.zh_code, testNewZhCode, 'Dynamic cache must return newly updated ZH code immediately');

  // Verify that an alias like BH-2 also gets the newly updated ZH name
  const aliasAfterUpdate = resolveZonalHeadSync({ zone: 'BH-2' });
  assert.equal(aliasAfterUpdate.zh_name, testNewZhName, 'Alias zone BH-2 must also dynamically return new ZH name');

  // Verify that an area like KAHALGAON (in Bihar) also resolves to the new ZH
  const areaAfterUpdate = resolveZonalHeadSync({ area: 'KAHALGAON' });
  assert.equal(areaAfterUpdate.zh_name, testNewZhName, 'Area KAHALGAON must dynamically resolve to new ZH name');

  console.log('✓ Successfully verified dynamic ZH update immediately propagates across all aliases and areas without server restart!');

  // 4. Restore original Bihar ZH
  if (originalBihar) {
    const restoreReq = {
      params: { zoneCode: 'BIHAR' },
      body: {
        zh_name: originalBihar.zh_name,
        zh_code: originalBihar.zh_code,
        emp_code: originalBihar.emp_code,
        designation: originalBihar.designation,
        level: originalBihar.level
      }
    };
    await updateZonalHeadMapping(restoreReq, mockRes);
    console.log(`✓ Restored original Zonal Head (${originalBihar.zh_name}) for BIHAR.`);
  }

  // 5. Verify database has 0 missing ZHs across all 3 tables
  const missingDealers = await dbGet("SELECT COUNT(*) as cnt FROM master_dealers WHERE zh_name IS NULL OR zh_name = '' OR zh_name = '-'");
  const missingMapping = await dbGet("SELECT COUNT(*) as cnt FROM master_dealer_so_mapping WHERE zh_name IS NULL OR zh_name = '' OR zh_name = '-'");
  const missingTargets = await dbGet("SELECT COUNT(*) as cnt FROM dealer_visit_targets WHERE zh_name IS NULL OR zh_name = '' OR zh_name = '-'");

  assert.equal(missingDealers.cnt, 0, 'Zero master_dealers should have missing ZH');
  assert.equal(missingMapping.cnt, 0, 'Zero master_dealer_so_mapping should have missing ZH');
  assert.equal(missingTargets.cnt, 0, 'Zero dealer_visit_targets should have missing ZH');
  console.log('✓ Zero missing Zonal Heads across master_dealers, master_dealer_so_mapping, and dealer_visit_targets!');

  console.log('\n========================================');
  console.log('ALL DYNAMIC ZONAL HEAD TESTS PASSED! ✓');
  console.log('========================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
