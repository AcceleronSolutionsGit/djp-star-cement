/**
 * Diagnose (and fix) plans that have no L1 approver.
 *
 *   node src/scripts/fix-routing.js            # every month, report only
 *   node src/scripts/fix-routing.js 2026-06    # one month, report only
 *   node src/scripts/fix-routing.js 2026-06 --fix
 *
 * WHY A PLAN ENDS UP UNROUTED
 * ---------------------------
 * Generation stamps each plan with its owner's role and the ONE person who
 * approves it (stampPlanRoutingForPeriod). That call sits inside a try/catch in
 * generation.controller.js — if it throws, the run still reports plans and
 * visits, records a ROUTING error and finishes PARTIAL. Nothing on screen says
 * the plans cannot be approved; you only find out when every officer in the app
 * shows "no approver" and no inbox ever fills.
 *
 * The three things that cause it, in the order this script checks them:
 *
 *   1. sales_plans has no routing columns at all.
 *      migrate-app-plan-workflow.js adds emp_role, l1_approver_emp_code and the
 *      rest. On a database where it was never run, the UPDATE inside the stamp
 *      fails with "Unknown column 'emp_role' in 'field list'" — so EVERY plan is
 *      unrouted, including SOs whose ASM plainly exists.
 *
 *   2. The columns exist but were never filled — plans generated before the
 *      workflow migration, or a run whose routing step threw for another reason.
 *      Re-stamping fixes these without regenerating anything.
 *
 *   3. The hierarchy itself cannot answer who the approver is. An SO's approver
 *      is the asm_code on his rows in master_dealer_so_mapping (falling back to
 *      dealer_visit_targets). If those rows carry no asm_code, no amount of
 *      re-stamping will help — the Dealer / SO Mapping file has to be re-uploaded
 *      with the hierarchy columns filled in.
 *
 * A ZH legitimately has no superior: his approver role is ADMIN and a blank
 * l1_approver_emp_code is correct, not a fault. This script counts him separately.
 */

import { dbAll, dbGet, pool } from '../config/database.js';
import { stampPlanRoutingForPeriod, resolveL1Approver, resolveEmployeeRole }
  from '../services/planRouting.service.js';

const ROUTING_COLUMNS = [
  'emp_role', 'required_approver_role',
  'l1_approver_emp_code', 'l1_approver_name', 'l1_approver_role',
  'rectification_count'
];

const OWN_COL = { SO: 'so_emp_code', ASM: 'asm_code', RSM: 'rsm_code', ZH: 'zh_code' };
const SUP_COL = { SO: 'asm_code',    ASM: 'rsm_code', RSM: 'zh_code',  ZH: null };

const h  = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 64 - t.length))}`);
const kv = (k, v) => console.log(`   ${String(k).padEnd(44, '.')} ${v}`);

async function columnExists(table, column) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return (row?.c || 0) > 0;
}

async function tableExists(table) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]
  );
  return (row?.c || 0) > 0;
}

async function main() {
  const args  = process.argv.slice(2);
  const fix   = args.includes('--fix');
  const month = args.find(a => /^\d{4}-\d{2}$/.test(a)) || null;

  console.log('\n' + '='.repeat(70));
  console.log('  PLAN ROUTING — why nobody has an approver');
  console.log('='.repeat(70));

  // ── 1. do the routing columns even exist? ─────────────────────────────────
  h('1. the routing columns on sales_plans');
  const missing = [];
  for (const c of ROUTING_COLUMNS) {
    const ok = await columnExists('sales_plans', c);
    kv(c, ok ? 'present' : 'MISSING');
    if (!ok) missing.push(c);
  }

  if (missing.length) {
    console.log(`\n   ${missing.length} routing column(s) are missing, so every stamp fails and`);
    console.log('   every plan reads as unrouted. This is almost certainly your cause.');
    if (!fix) {
      console.log('\n   FIX:  node src/scripts/migrate-app-plan-workflow.js');
      console.log('         node src/scripts/fix-routing.js ' + (month || '<YYYY-MM>') + ' --fix\n');
      return;
    }
    console.log('\n   --fix given: adding them now.');
    const { migrateAppPlanWorkflow } = await import('./migrate-app-plan-workflow.js');
    const done = await migrateAppPlanWorkflow();
    (done || []).forEach(d => console.log(`   ${d}`));
  }

  // ── 2. what the hierarchy can answer ──────────────────────────────────────
  h('2. can the hierarchy name an approver at all?');
  for (const table of ['master_dealer_so_mapping', 'dealer_visit_targets']) {
    if (!(await tableExists(table))) { kv(table, 'table not present'); continue; }
    const total = await dbGet(`SELECT COUNT(*) AS c FROM ${table}`);
    kv(`${table} rows`, total.c);
    if (!total.c) continue;
    for (const role of ['SO', 'ASM', 'RSM']) {
      const own = OWN_COL[role], sup = SUP_COL[role];
      if (!(await columnExists(table, own)) || !(await columnExists(table, sup))) {
        kv(`  ${role} → ${sup}`, 'column not present');
        continue;
      }
      const row = await dbGet(
        `SELECT COUNT(DISTINCT ${own}) AS people,
                COUNT(DISTINCT CASE WHEN ${sup} IS NOT NULL AND TRIM(${sup}) <> ''
                                    THEN ${own} END) AS with_superior
           FROM ${table} WHERE ${own} IS NOT NULL AND TRIM(${own}) <> ''`
      );
      kv(`  ${role} with a ${sup}`, `${row.with_superior} of ${row.people}`);
    }
  }

  // ── 3. the plans themselves ───────────────────────────────────────────────
  h('3. plans, by month, that can reach an inbox');
  const where = month ? 'WHERE period_month = ?' : '';
  const params = month ? [month] : [];
  const byMonth = await dbAll(
    `SELECT period_month, cycle_code, COUNT(*) AS plans,
            SUM(CASE WHEN l1_approver_emp_code IS NOT NULL
                      AND TRIM(l1_approver_emp_code) <> '' THEN 1 ELSE 0 END) AS routed,
            SUM(CASE WHEN emp_role = 'ZH' THEN 1 ELSE 0 END) AS zh
       FROM sales_plans ${where}
      GROUP BY period_month, cycle_code
      ORDER BY period_month DESC, cycle_code`, params
  );
  if (!byMonth.length) { console.log('   No plans found.'); return; }
  for (const r of byMonth) {
    const unrouted = r.plans - r.routed - r.zh;
    kv(`${r.period_month} ${r.cycle_code}`,
       `${r.plans} plans · ${r.routed} routed · ${r.zh} ZH (no superior by design)` +
       (unrouted > 0 ? ` · ${unrouted} UNROUTED` : ''));
  }

  // ── 4. person by person — what WOULD be stamped right now ─────────────────
  h('4. what each officer would be stamped with');
  const people = await dbAll(
    `SELECT DISTINCT emp_code, emp_name, emp_role FROM sales_plans ${where} ORDER BY emp_code`,
    params
  );
  const blocked = [];
  for (const p of people) {
    const role = await resolveEmployeeRole(p.emp_code, p.emp_role);
    const l1   = await resolveL1Approver(p.emp_code, role);
    const verdict = l1.empCode
      ? `${l1.name || l1.empCode} (${l1.role}) — from ${l1.source}`
      : (l1.role === 'ADMIN' ? 'ADMIN — correct, a ZH has no superior' : 'NOBODY');
    console.log(`   ${String(p.emp_code).padEnd(11)} ${String(p.emp_name).slice(0, 24).padEnd(25)} ` +
                `${String(role).padEnd(4)} → ${verdict}`);
    if (!l1.empCode && l1.role !== 'ADMIN') blocked.push({ ...p, role });
  }

  // ── 5. fix, or say what to run ────────────────────────────────────────────
  h('5. what to do');
  if (blocked.length === people.length) {
    console.log('   The hierarchy cannot name an approver for ANYONE. Re-stamping will not');
    console.log('   help — re-upload the Dealer / SO Mapping file with the ASM / RSM / ZH');
    console.log('   code columns filled in, then run this again with --fix.');
  } else if (fix) {
    const months = month ? [month] : [...new Set(byMonth.map(r => r.period_month))];
    for (const m of months) {
      const r = await stampPlanRoutingForPeriod(m, null);
      kv(`re-stamped ${m}`, `${r.stamped} plan(s), ${r.unrouted.length} still unrouted`);
    }
    console.log('\n   Done. Reload the simulator — the officers should now show their L1.');
  } else {
    console.log('   The hierarchy CAN name approvers; the plans just were not stamped.');
    console.log(`\n   FIX:  node src/scripts/fix-routing.js ${month || '<YYYY-MM>'} --fix`);
    console.log('   (or POST /api/app/routing/restamp with { periodMonth, cycleCode })\n');
  }
}

main()
  .catch(e => { console.error('\n[fix-routing] Failed:', e.message); process.exitCode = 1; })
  .finally(async () => { await pool?.end?.(); process.exit(process.exitCode || 0); });
