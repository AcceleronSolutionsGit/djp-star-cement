/**
 * Backfill — employee names
 *
 * Repairs data created before the name fix:
 *
 *   1. master_employees only ever held SO and ASM rows, because the Dealer Mapping
 *      importer wrote those two levels only. RSMs and ZHs are inserted here from the
 *      Dealer / SO Mapping hierarchy.
 *
 *   2. sales_plans.emp_name was set to the employee CODE whenever the lookup above
 *      came up empty, which is why some plans show an id where a name belongs. Every
 *      such row is repaired from the now-complete employee master.
 *
 * Read-only where it can be: nothing is deleted, and a plan whose emp_name already
 * differs from its emp_code is left alone.
 *
 *   node src/scripts/backfill-employee-names.js            # report only
 *   node src/scripts/backfill-employee-names.js --apply    # write the fixes
 */

import { dbAll, dbGet, dbRun, pool } from '../config/database.js';
import { resolveEmployeeName } from '../services/planRouting.service.js';

const APPLY = process.argv.includes('--apply');

const LEVELS = [
  { role: 'SO',  designation: 'SO/SE', codeCol: 'so_emp_code', nameCol: 'so_name' },
  { role: 'ASM', designation: 'ASM',   codeCol: 'asm_code',    nameCol: 'asm_name' },
  { role: 'RSM', designation: 'RSM',   codeCol: 'rsm_code',    nameCol: 'rsm_name' },
  { role: 'ZH',  designation: 'ZH',    codeCol: 'zh_code',     nameCol: 'zh_name' }
];

async function tableExists(table) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]
  );
  return (row?.c || 0) > 0;
}

async function backfillEmployees() {
  const source = (await tableExists('master_dealer_so_mapping'))
    ? 'master_dealer_so_mapping'
    : 'dealer_visit_targets';

  console.log(`\n── master_employees ── (hierarchy from ${source})`);
  let created = 0, named = 0, already = 0;

  for (const lvl of LEVELS) {
    const people = await dbAll(
      `SELECT ${lvl.codeCol} AS code, ${lvl.nameCol} AS name, COUNT(*) AS n
       FROM ${source}
       WHERE ${lvl.codeCol} IS NOT NULL AND TRIM(${lvl.codeCol}) != ''
         AND ${lvl.nameCol} IS NOT NULL AND TRIM(${lvl.nameCol}) != ''
       GROUP BY ${lvl.codeCol}, ${lvl.nameCol}
       ORDER BY n DESC`
    );

    // One code can carry more than one spelling; the most frequent wins.
    const best = new Map();
    for (const p of people) {
      const code = String(p.code).trim();
      if (!best.has(code)) best.set(code, String(p.name).trim());
    }

    let lvlCreated = 0, lvlNamed = 0;
    for (const [code, name] of best) {
      const existing = await dbGet(
        'SELECT id, emp_name, designation FROM master_employees WHERE emp_code = ?', [code]
      );

      if (!existing) {
        if (APPLY) {
          await dbRun(
            'INSERT INTO master_employees (emp_code, emp_name, designation) VALUES (?, ?, ?)',
            [code, name, lvl.designation]
          );
        }
        lvlCreated++; created++;
      } else if (!existing.emp_name || existing.emp_name.trim() === '' || existing.emp_name.trim() === code) {
        if (APPLY) {
          await dbRun(
            `UPDATE master_employees
             SET emp_name = ?, designation = COALESCE(NULLIF(designation, ''), ?)
             WHERE id = ?`,
            [name, lvl.designation, existing.id]
          );
        }
        lvlNamed++; named++;
      } else {
        already++;
      }
    }
    console.log(`   ${lvl.role.padEnd(4)} ${String(best.size).padStart(5)} in hierarchy → ${lvlCreated} created, ${lvlNamed} renamed`);
  }

  console.log(`   total: ${created} created, ${named} renamed, ${already} already correct`);
  return { created, named, already };
}

async function backfillPlanNames() {
  console.log('\n── sales_plans.emp_name ──');

  const broken = await dbAll(
    `SELECT id, emp_code, emp_name, emp_role, period_month, cycle_code
     FROM sales_plans
     WHERE emp_name IS NULL OR TRIM(emp_name) = '' OR TRIM(emp_name) = TRIM(emp_code)
     ORDER BY id`
  );

  if (broken.length === 0) {
    console.log('   nothing to repair — every plan already carries a name');
    return { fixed: 0, unresolved: 0 };
  }

  console.log(`   ${broken.length} plan(s) showing the code instead of a name`);

  const cache = new Map();
  let fixed = 0;
  const unresolved = [];

  for (const p of broken) {
    const key = `${p.emp_code}|${p.emp_role || ''}`;
    if (!cache.has(key)) cache.set(key, await resolveEmployeeName(p.emp_code, p.emp_role));
    const { name, source } = cache.get(key);

    if (!name || name === p.emp_code) {
      unresolved.push(p);
      continue;
    }
    if (APPLY) {
      await dbRun('UPDATE sales_plans SET emp_name = ? WHERE id = ?', [name, p.id]);
    }
    if (fixed < 15) {
      console.log(`   #${String(p.id).padEnd(5)} ${p.emp_code.padEnd(14)} → ${name}   (${source})`);
    }
    fixed++;
  }
  if (fixed > 15) console.log(`   … and ${fixed - 15} more`);

  if (unresolved.length > 0) {
    console.log(`\n   ${unresolved.length} plan(s) could NOT be resolved — these employees appear`);
    console.log('   in no hierarchy row with a name. Check the Dealer / SO Mapping file:');
    for (const p of unresolved.slice(0, 10)) {
      console.log(`     ${p.emp_code} (${p.emp_role || '?'}) — ${p.period_month} ${p.cycle_code}`);
    }
  }

  return { fixed, unresolved: unresolved.length };
}

async function backfillApproverNames() {
  console.log('\n── sales_plans.l1_approver_name ──');
  let rows;
  try {
    rows = await dbAll(
      `SELECT id, l1_approver_emp_code, l1_approver_role
       FROM sales_plans
       WHERE l1_approver_emp_code IS NOT NULL AND TRIM(l1_approver_emp_code) != ''
         AND (l1_approver_name IS NULL OR TRIM(l1_approver_name) = ''
              OR TRIM(l1_approver_name) = TRIM(l1_approver_emp_code))`
    );
  } catch (e) {
    console.log('   skipped — run migrate-app-plan-workflow.js first');
    return { fixed: 0 };
  }

  if (rows.length === 0) {
    console.log('   nothing to repair');
    return { fixed: 0 };
  }

  const cache = new Map();
  let fixed = 0;
  for (const r of rows) {
    const key = `${r.l1_approver_emp_code}|${r.l1_approver_role || ''}`;
    if (!cache.has(key)) cache.set(key, await resolveEmployeeName(r.l1_approver_emp_code, r.l1_approver_role));
    const { name } = cache.get(key);
    if (!name) continue;
    if (APPLY) await dbRun('UPDATE sales_plans SET l1_approver_name = ? WHERE id = ?', [name, r.id]);
    fixed++;
  }
  console.log(`   ${fixed} of ${rows.length} approver name(s) resolved`);
  return { fixed };
}

(async () => {
  console.log(APPLY
    ? '=== BACKFILL EMPLOYEE NAMES — APPLYING CHANGES ==='
    : '=== BACKFILL EMPLOYEE NAMES — DRY RUN (add --apply to write) ===');

  try {
    await backfillEmployees();
    await backfillPlanNames();
    await backfillApproverNames();

    console.log(APPLY
      ? '\nDone. Reload the admin panel — names should now show everywhere.'
      : '\nDry run complete. Nothing was written. Re-run with --apply to commit.');
  } catch (err) {
    console.error('\n[backfill] FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
