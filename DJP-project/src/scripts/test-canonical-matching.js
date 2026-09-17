import { matchAndUpsertCanonicalDealer } from '../engines/canonical-matching.engine.js';
import { dbRun, dbGet, dbAll } from '../config/database.js';
import crypto from 'crypto';

async function runTests() {
  console.log('=== CANONICAL MATCHING REGRESSION TESTS ===');

  // Clear master_dealers for testing
  await dbRun('DELETE FROM master_dealers');
  console.log('Cleared master_dealers table.');

  const batchCode = 'TEST_BATCH_01';
  let totalTests = 0;
  let passedTests = 0;

  function assertEqual(actual, expected, testName) {
    totalTests++;
    if (actual === expected) {
      console.log(`✅ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`❌ [FAIL] ${testName}: Expected "${expected}", got "${actual}"`);
    }
  }

  function assertNotNull(actual, testName) {
    totalTests++;
    if (actual !== null && actual !== undefined) {
      console.log(`✅ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`❌ [FAIL] ${testName}: Expected NOT NULL`);
    }
  }

  try {
    // 1. Star dealer with SAP (New)
    const t1 = await matchAndUpsertCanonicalDealer({
      dealerType: 'STAR', rawSapCode: 'SAP001', rawDealerName: 'Star Dealer 1', rawArea: 'Area A', zone: 'Zone A', batchCode
    });
    assertEqual(t1.matchStatus, 'NEW', 'Test 1: New Star dealer with SAP');
    assertEqual(t1.isNew, true, 'Test 1: Should be marked as new');

    // 2. Star dealer repeated in second upload (Match by SAP)
    const t2 = await matchAndUpsertCanonicalDealer({
      dealerType: 'STAR', rawSapCode: 'SAP001', rawDealerName: 'Star Dealer One (Renamed)', rawArea: 'Area A', zone: 'Zone A', batchCode
    });
    assertEqual(t2.matchStatus, 'MATCHED', 'Test 2: Repeated Star dealer (Match by SAP)');
    assertEqual(t2.matchMethod, 'SAP_CODE', 'Test 2: Method should be SAP_CODE');
    assertEqual(t2.internalId, t1.internalId, 'Test 2: Should update the same record');

    // Verify DB update
    const dbT2 = await dbGet('SELECT normalized_dealer_name FROM master_dealers WHERE id = ?', [t2.internalId]);
    assertEqual(dbT2.normalized_dealer_name, 'STAR DEALER ONE (RENAMED)', 'Test 2: Name should be updated and normalized');

    // 3. Non-Star with NULL SAP (New)
    const t3 = await matchAndUpsertCanonicalDealer({
      dealerType: 'NON_STAR', rawSapCode: null, rawDealerName: 'Non Star 1', rawArea: 'Area B', rawBlock: 'Block B', zone: 'Zone B', batchCode
    });
    assertEqual(t3.matchStatus, 'NEW', 'Test 3: New Non-Star dealer with NULL SAP');
    assertNotNull(t3.internalId, 'Test 3: Should insert record');

    // 4. Non-Star with SFA
    const t4 = await matchAndUpsertCanonicalDealer({
      dealerType: 'NON_STAR', rawSapCode: null, rawSfaCode: 'SFA001', rawDealerName: 'Non Star 2', rawArea: 'Area C', zone: 'Zone C', batchCode
    });
    assertEqual(t4.matchStatus, 'NEW', 'Test 4: New Non-Star dealer with SFA');
    
    const t4_match = await matchAndUpsertCanonicalDealer({
      dealerType: 'NON_STAR', rawSapCode: null, rawSfaCode: 'SFA001', rawDealerName: 'Non Star Two', rawArea: 'Area C', zone: 'Zone C', batchCode
    });
    assertEqual(t4_match.matchStatus, 'MATCHED', 'Test 4: Match Non-Star by SFA');
    assertEqual(t4_match.internalId, t4.internalId, 'Test 4: Should update same record');

    // 5. Non-Star composite match
    const t5_match = await matchAndUpsertCanonicalDealer({
      dealerType: 'NON_STAR', rawSapCode: null, rawDealerName: 'Non Star 1', rawArea: 'Area B', rawBlock: 'Block B', zone: 'Zone B', batchCode
    });
    assertEqual(t5_match.matchStatus, 'MATCHED', 'Test 5: Match Non-Star by Composite');
    assertEqual(t5_match.internalId, t3.internalId, 'Test 5: Should match existing Non-Star record');

    // 6. Same dealer name in different areas
    const t6 = await matchAndUpsertCanonicalDealer({
      dealerType: 'NON_STAR', rawSapCode: null, rawDealerName: 'Non Star 1', rawArea: 'Area D', rawBlock: 'Block D', zone: 'Zone B', batchCode
    });
    assertEqual(t6.matchStatus, 'NEW', 'Test 6: Same name but different area -> NEW');

    // 7. Same dealer name in same area but different block
    const t7 = await matchAndUpsertCanonicalDealer({
      dealerType: 'NON_STAR', rawSapCode: null, rawDealerName: 'Non Star 1', rawArea: 'Area B', rawBlock: 'Block X', zone: 'Zone B', batchCode
    });
    assertEqual(t7.matchStatus, 'NEW', 'Test 7: Same name and area but different block -> NEW');

    // 8. Duplicate SAP
    // Manually insert duplicate SAP
    await dbRun('INSERT INTO master_dealers (sap_code, dealer_name, status) VALUES (?, ?, ?)', ['DUP_SAP', 'Duplicate 1', 'ACTIVE']);
    await dbRun('INSERT INTO master_dealers (sap_code, dealer_name, status) VALUES (?, ?, ?)', ['DUP_SAP', 'Duplicate 2', 'ACTIVE']);
    const t8 = await matchAndUpsertCanonicalDealer({
      dealerType: 'STAR', rawSapCode: 'DUP_SAP', rawDealerName: 'New Dup', rawArea: 'Area E', zone: 'Zone E', batchCode
    });
    assertEqual(t8.matchStatus, 'AMBIGUOUS', 'Test 8: Duplicate SAP in DB -> AMBIGUOUS');

    // 9. Missing SAP (STAR)
    const t9 = await matchAndUpsertCanonicalDealer({
      dealerType: 'STAR', rawSapCode: null, rawDealerName: 'No SAP Star', rawArea: 'Area F', zone: 'Zone F', batchCode
    });
    assertEqual(t9.matchStatus, 'NEW', 'Test 9: Missing SAP for STAR -> Still creates NEW if unmatched');

    // 10. Missing SFA (NON_STAR)
    const t10 = await matchAndUpsertCanonicalDealer({
      dealerType: 'NON_STAR', rawSapCode: null, rawSfaCode: null, rawDealerName: 'No SFA Non Star', rawArea: 'Area G', zone: 'Zone G', batchCode
    });
    assertEqual(t10.matchStatus, 'NEW', 'Test 10: Missing SFA -> NEW');

    // 11. Ambiguous composite match
    await dbRun('INSERT INTO master_dealers (normalized_dealer_name, normalized_area, dealer_type) VALUES (?, ?, ?)', ['AMBIGUOUS DEALER', 'AREA AMB', 'NON_STAR']);
    await dbRun('INSERT INTO master_dealers (normalized_dealer_name, normalized_area, dealer_type) VALUES (?, ?, ?)', ['AMBIGUOUS DEALER', 'AREA AMB', 'NON_STAR']);
    const t11 = await matchAndUpsertCanonicalDealer({
      dealerType: 'NON_STAR', rawSapCode: null, rawDealerName: 'Ambiguous Dealer', rawArea: 'Area AMB', zone: 'Zone AMB', batchCode
    });
    assertEqual(t11.matchStatus, 'AMBIGUOUS', 'Test 11: Duplicate composite -> AMBIGUOUS');

    // 12. Completely unmatched dealer
    const t12 = await matchAndUpsertCanonicalDealer({
      dealerType: 'STAR', rawSapCode: 'SAP999', rawDealerName: 'Unmatched 999', rawArea: 'Area 999', zone: 'Zone 999', batchCode, sourceType: 'SALES_HISTORY'
    });
    assertEqual(t12.matchStatus, 'UNMATCHED', 'Test 12: Sales History unmatched -> UNMATCHED (Does not create)');

    // 13. The exact failing record from the prompt
    const t13 = await matchAndUpsertCanonicalDealer({
      dealerType: 'NON_STAR', rawSapCode: null, rawDealerName: 'ANUSUIYA CYCLE AND HARDWARE STORE', rawArea: 'DIBRUGARH', rawBlock: 'TENGAGHAT', zone: 'UPPER ASSAM', batchCode
    });
    assertEqual(t13.matchStatus, 'NEW', 'Test 13: Exact failing record -> NEW');
    
    const dbT13 = await dbGet('SELECT * FROM master_dealers WHERE id = ?', [t13.internalId]);
    console.log('\n--- Canonical Record Created for ANUSUIYA CYCLE AND HARDWARE STORE ---');
    console.log(JSON.stringify(dbT13, null, 2));
    
  } catch (err) {
    console.error('Test execution failed:', err);
  }

  console.log(`\nTests completed: ${passedTests}/${totalTests} passed.`);
  process.exit(passedTests === totalTests ? 0 : 1);
}

runTests();
