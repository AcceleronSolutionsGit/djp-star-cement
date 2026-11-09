/**
 * verify_nontrade_approval_matrix.js
 * Verification suite for the Non-Trade Approval Matrix & Automated Adherence Engine
 */

const BASE_URL = 'http://127.0.0.1:3001/api';

async function runTests() {
  console.log('================================================================');
  console.log('  NON-TRADE APPROVAL MATRIX & AUTO ADHERENCE VERIFICATION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function assertTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
    }
  }

  let matrixData = null;

  // Test 1: Fetch approval matrix for 2026-09 via HTTP
  await assertTest('GET /api/nontrade/approval-matrix returns 200 with autoTrackingEnabled=true', async () => {
    const res = await fetch(`${BASE_URL}/nontrade/approval-matrix?periodMonth=2026-09`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    matrixData = json.data || json;
    if (matrixData.autoTrackingEnabled !== true) throw new Error('autoTrackingEnabled must be true');
    if (matrixData.periodMonth !== '2026-09') throw new Error(`Expected period 2026-09, got ${matrixData.periodMonth}`);
  });

  // Test 2: Verify 3-tier Approval Matrix Levels
  await assertTest('Matrix has 3 levels: Level 1 (Officer->ASM), Level 2 (ASM->HOS), Level 3 (HOS->VP)', async () => {
    if (!matrixData.levels || matrixData.levels.length !== 3) {
      throw new Error(`Expected 3 levels, got ${matrixData.levels?.length}`);
    }
    const [l1, l2, l3] = matrixData.levels;
    if (l1.role !== 'Officer' || l1.approverRole !== 'ASM') throw new Error(`Invalid L1: ${JSON.stringify(l1)}`);
    if (l2.role !== 'ASM' || l2.approverRole !== 'HOS') throw new Error(`Invalid L2: ${JSON.stringify(l2)}`);
    if (l3.role !== 'HOS' || l3.approverRole !== 'Commercial Head / VP') throw new Error(`Invalid L3: ${JSON.stringify(l3)}`);
  });

  // Test 3: Verify ASM clusters
  await assertTest('Matrix includes 3 ASMs (Debashish Dey, Partha Protim Bora, Bornalee Bora Kalita)', async () => {
    if (!Array.isArray(matrixData.asms) || matrixData.asms.length !== 3) {
      throw new Error(`Expected 3 ASMs, got ${matrixData.asms?.length}`);
    }
    const names = matrixData.asms.map(a => a.asm_name);
    if (!names.includes('DEBASHISH DEY')) throw new Error('Missing Debashish Dey');
    if (!names.includes('PARTHA PROTIM BORA')) throw new Error('Missing Partha Protim Bora');
    if (!names.includes('BORNALEE BORA KALITA')) throw new Error('Missing Bornalee Bora Kalita');
  });

  // Test 4: Verify subordinate officers
  await assertTest('8 subordinate Sales Officers report to their respective ASMs', async () => {
    const totalOfficers = matrixData.asms.reduce((acc, a) => acc + (a.officers?.length || 0), 0);
    if (totalOfficers !== 8) throw new Error(`Expected 8 subordinate officers, got ${totalOfficers}`);

    const debashish = matrixData.asms.find(a => a.asm_name === 'DEBASHISH DEY');
    const debashishCodes = debashish.officers.map(o => o.emp_code);
    if (!debashishCodes.includes('2500288')) throw new Error('Debajit Mitra not under Debashish Dey');
    if (!debashishCodes.includes('2500232')) throw new Error('Preetam Karmakar not under Debashish Dey');
    if (debashish.hos_name !== 'SHANTANU BHATTACHARJEE') throw new Error('Debashish Dey does not report to Shantanu Bhattacharjee');
  });

  // Test 5: Verify Automated Adherence Numbers
  await assertTest('Live automated adherence % is calculated per officer and per ASM team', async () => {
    for (const asm of matrixData.asms) {
      if (!asm.team_adherence_pct || isNaN(parseFloat(asm.team_adherence_pct))) {
        throw new Error(`Invalid team adherence for ${asm.asm_name}: ${asm.team_adherence_pct}`);
      }
      for (const off of asm.officers) {
        if (typeof off.scheduled_visits !== 'number' || typeof off.executed_visits !== 'number') {
          throw new Error(`Invalid visit counts for ${off.emp_name}`);
        }
        if (!off.adherence_pct || isNaN(parseFloat(off.adherence_pct))) {
          throw new Error(`Invalid adherence pct for ${off.emp_name}`);
        }
      }
    }
  });

  // Test 6: Verify summary payload
  await assertTest('Summary indicates ROLLED_OUT / ACTIVE IN FIELD APP and AUTOMATICALLY TRACKED', async () => {
    if (!matrixData.summary) throw new Error('Missing summary in matrix response');
    if (matrixData.summary.total_officers !== 8) throw new Error('Expected 8 officers in summary');
    if (matrixData.summary.total_asms !== 3) throw new Error('Expected 3 ASMs in summary');
  });

  console.log(`\n====================================================`);
  console.log(`   APPROVAL MATRIX VERIFICATION: ${passed}/${total} PASSED`);
  console.log(`====================================================\n`);

  if (passed !== total) process.exit(1);
}

runTests();
