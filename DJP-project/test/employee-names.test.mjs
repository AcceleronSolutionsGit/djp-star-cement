/**
 * Reproduces the "id instead of the employee's name" bug and proves the fix.
 *
 * Cause: the Dealer Mapping importer wrote master_employees rows for SO and ASM only.
 * An RSM or ZH therefore had no record, and generatePlan fell back to the employee
 * CODE. RSM and ZH plans only started appearing once the rsm_code / zh_code lookup was
 * fixed, which is why the wrong name surfaced then.
 */
import assert from 'node:assert/strict';
import { db, dbGet, dbAll } from './sandbox/src/config/database.js';
import { resolveEmployeeName } from './sandbox/src/services/planRouting.service.js';

db.exec(`
CREATE TABLE master_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, emp_code TEXT UNIQUE, emp_name TEXT,
  designation TEXT, zone TEXT, region TEXT
);
CREATE TABLE master_dealer_so_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sap_code TEXT, dealer_name TEXT, area TEXT, region TEXT,
  so_name TEXT, so_emp_code TEXT, asm_name TEXT, asm_code TEXT,
  rsm_name TEXT, rsm_code TEXT, zh_name TEXT, zh_code TEXT
);
CREATE TABLE dealer_visit_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, period_month TEXT, cycle_code TEXT, sap_code TEXT,
  so_name TEXT, so_emp_code TEXT, asm_name TEXT, asm_code TEXT,
  rsm_name TEXT, rsm_code TEXT, zh_name TEXT, zh_code TEXT
);
`);

// The hierarchy knows every level — this is what the Dealer / SO Mapping upload gives us
for (let i = 0; i < 5; i++) {
  db.prepare(`INSERT INTO master_dealer_so_mapping
    (sap_code, dealer_name, area, region, so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`100000115${i}`, `DEALER ${i}`, 'ALIPURDUAR', 'NB1',
         'DEBABRATA CHAKRABORTY- FKT', '11001774', 'DEBABRATA GHOSH', '11001393',
         'RITWICK CHATTERJEE', '11001813', 'GIRIDHARI MUKHERJEE', '11002257');
}
// one stray row spelling the RSM differently — the majority spelling must win
db.prepare(`INSERT INTO master_dealer_so_mapping
  (sap_code, dealer_name, area, so_name, so_emp_code, rsm_name, rsm_code)
  VALUES (?,?,?,?,?,?,?)`)
  .run('1000009999', 'HANDOVER DEALER', 'ALIPURDUAR',
       'DEBABRATA CHAKRABORTY- FKT', '11001774', 'R. CHATTERJEE (OLD SPELLING)', '11001813');

// master_employees as the OLD importer left it: SO and ASM only
db.prepare("INSERT INTO master_employees (emp_code, emp_name, designation) VALUES (?,?,?)")
  .run('11001774', 'DEBABRATA CHAKRABORTY- FKT', 'SO/SE');
db.prepare("INSERT INTO master_employees (emp_code, emp_name, designation) VALUES (?,?,?)")
  .run('11001393', 'DEBABRATA GHOSH', 'ASM');

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

// ── the old behaviour, reproduced ────────────────────────────────────────────
const oldLookup = async code => {
  const rec = await dbGet('SELECT * FROM master_employees WHERE emp_code = ? OR emp_name = ?', [code, code]);
  return rec ? rec.emp_name : code;   // the original line
};

check('the bug reproduces — an RSM lands on the old lookup as a bare code', async () => {});
const oldRsm = await oldLookup('11001813');
const oldZh  = await oldLookup('11002257');
const oldSo  = await oldLookup('11001774');
results.pop();
check('old lookup returns the CODE for an RSM', () => assert.equal(oldRsm, '11001813'));
check('old lookup returns the CODE for a ZH',  () => assert.equal(oldZh,  '11002257'));
check('old lookup was always fine for an SO',  () => assert.equal(oldSo,  'DEBABRATA CHAKRABORTY- FKT'));

// ── the fix ──────────────────────────────────────────────────────────────────
const so  = await resolveEmployeeName('11001774', 'SO');
const asm = await resolveEmployeeName('11001393', 'ASM');
const rsm = await resolveEmployeeName('11001813', 'RSM');
const zh  = await resolveEmployeeName('11002257', 'ZH');

check('SO still resolves from master_employees', () => {
  assert.equal(so.name, 'DEBABRATA CHAKRABORTY- FKT');
  assert.equal(so.source, 'master_employees');
});
check('ASM still resolves from master_employees', () => {
  assert.equal(asm.name, 'DEBABRATA GHOSH');
});
check('RSM now resolves from the Dealer / SO Mapping', () => {
  assert.equal(rsm.name, 'RITWICK CHATTERJEE');
  assert.equal(rsm.source, 'master_dealer_so_mapping.rsm_name');
});
check('ZH now resolves from the Dealer / SO Mapping', () => {
  assert.equal(zh.name, 'GIRIDHARI MUKHERJEE');
  assert.equal(zh.source, 'master_dealer_so_mapping.zh_name');
});
check('a stray alternative spelling does not win — majority does', () => {
  assert.notEqual(rsm.name, 'R. CHATTERJEE (OLD SPELLING)');
});

// ── role hint is a hint, not a requirement ───────────────────────────────────
const noHint = await resolveEmployeeName('11002257');
check('the name resolves even when the role is unknown', () => {
  assert.equal(noHint.name, 'GIRIDHARI MUKHERJEE');
});

// ── genuinely unknown codes ──────────────────────────────────────────────────
const missing = await resolveEmployeeName('99999999', 'RSM');
check('an employee in no hierarchy row returns null, not a silent code', () => {
  assert.equal(missing.name, null);
  assert.equal(missing.source, 'none');
});

// ── fallback to dealer_visit_targets when the mapping has not been uploaded ──
db.exec('DELETE FROM master_dealer_so_mapping');
db.prepare(`INSERT INTO dealer_visit_targets
  (period_month, cycle_code, sap_code, zh_name, zh_code) VALUES (?,?,?,?,?)`)
  .run('2026-09', 'C1', '1000001153', 'GIRIDHARI MUKHERJEE', '11002257');
const viaTargets = await resolveEmployeeName('11002257', 'ZH');
check('falls back to the DJP snapshot when the mapping is absent', () => {
  assert.equal(viaTargets.name, 'GIRIDHARI MUKHERJEE');
  assert.equal(viaTargets.source, 'dealer_visit_targets.zh_name');
});

console.log('\n' + '─'.repeat(72));
let pass = 0, fail = 0;
for (const r of results) {
  if (r[0] === 'PASS') { pass++; console.log(`  ✓ ${r[1]}`); }
  else { fail++; console.log(`  ✗ ${r[1]}\n      ${r[2]}`); }
}
console.log('─'.repeat(72));
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
