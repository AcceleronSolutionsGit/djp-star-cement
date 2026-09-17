/**
 * Seed the E2E database from the test kit.
 *
 * Loads the real schema.sql, then writes the six TEST_*.xlsx files into the exact
 * tables and columns the real importers write, so every engine downstream reads
 * what it would read in production.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dbRun, dbAll } from './sandbox/src/config/database.js';

const here = dirname(fileURLToPath(import.meta.url));
const kit  = JSON.parse(readFileSync(join(here, 'testkit.json'), 'utf8'));

const MAPPING  = kit['TEST_01_Dealer_Mapping::Dealer SO Mapping'];
const PERF     = kit['TEST_02_Dealer_Performance::DLRWISE'];
const SBG      = kit['TEST_03_SBG_Master::SBG'];
const RSAR     = kit['TEST_04_Sales_History_RSAR::RSAR'];
const PROSPECT = kit['TEST_05_Prospect_Dealers::Prospect'];
const SFA      = kit['TEST_06_SFA_Report::SFA Report'];

export const KIT = { MAPPING, PERF, SBG, RSAR, PROSPECT, SFA };

/** MySQL schema.sql → SQLite. */
export function loadSchema() {
  let sql = readFileSync(join(here, '..', '..', 'src', 'models', 'schema.sql'), 'utf8');
  sql = sql
    .replace(/AUTO_INCREMENT/gi, 'AUTOINCREMENT')
    .replace(/\bENGINE\s*=\s*\w+/gi, '')
    .replace(/\bDEFAULT\s+CURRENT_TIMESTAMP\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP/gi, 'DEFAULT CURRENT_TIMESTAMP')
    .replace(/\bDECIMAL\s*\([^)]*\)/gi, 'REAL')
    .replace(/\bVARCHAR\s*\([^)]*\)/gi, 'TEXT')
    .replace(/\bINT\s*\([^)]*\)/gi, 'INTEGER')
    .replace(/\bTINYINT\b/gi, 'INTEGER')
    .replace(/\bENUM\s*\([^)]*\)/gi, 'TEXT');
  db.exec(sql);

  // generation_runs and visit_execution_logs.batch_code now come from schema.sql
  // itself (see migrate-missing-objects.js for existing databases), so nothing is
  // hand-made here any more — if either were missing, this harness would fail exactly
  // the way a fresh deploy does.

  // Columns added by migrate-phase2-calc-columns.js. The PJP engine writes all ten,
  // but schema.sql declares none of them — so a deploy that runs schema.sql alone and
  // skips this migration fails at the first Run DJP. See the report.
  for (const col of [
    'counter_share REAL DEFAULT 0', 'need_to_grow INTEGER DEFAULT 0',
    'area_potential REAL DEFAULT 0', 'area_potential_rank INTEGER DEFAULT 1',
    'area_potential_percentile REAL DEFAULT 0', 'area_volume REAL DEFAULT 0',
    'area_volume_rank INTEGER DEFAULT 1', 'area_volume_percentile REAL DEFAULT 0',
    'potential_rank INTEGER DEFAULT 1', 'doa DATE'
  ]) { try { db.exec(`ALTER TABLE dealer_visit_targets ADD COLUMN ${col}`); } catch {} }

  // App-workflow columns added by migrate-app-plan-workflow.js
  for (const col of [
    "emp_role TEXT DEFAULT 'SO'", 'required_approver_role TEXT', 'approver_emp_code TEXT',
    'l1_approver_emp_code TEXT', 'l1_approver_name TEXT', 'l1_approver_role TEXT',
    'rectification_count INTEGER DEFAULT 0', 'rectify_requested_by TEXT',
    'rectify_requested_at TEXT', 'rectify_remarks TEXT', 'resubmitted_at TEXT',
    'last_edited_by TEXT', 'last_edited_at TEXT'
  ]) { try { db.exec(`ALTER TABLE sales_plans ADD COLUMN ${col}`); } catch {} }
  for (const col of ["visit_status TEXT DEFAULT 'ACTIVE'", 'added_by TEXT', "source TEXT DEFAULT 'AUTO'"]) {
    try { db.exec(`ALTER TABLE sales_plan_details ADD COLUMN ${col}`); } catch {}
  }
  try { db.exec(`ALTER TABLE plan_approvals ADD COLUMN approver_role TEXT`); } catch {}

  // Table from models/migration_approval_matrix.sql
  db.exec(`CREATE TABLE IF NOT EXISTS approval_matrix (
    id INTEGER PRIMARY KEY AUTOINCREMENT, submitter_role TEXT UNIQUE,
    required_approver_role TEXT, is_active INTEGER DEFAULT 1);
  INSERT OR IGNORE INTO approval_matrix (submitter_role, required_approver_role) VALUES
    ('SO','ASM'), ('ASM','RSM'), ('RSM','ZH'), ('ZH','ADMIN');`);

  // Tables from migrate-c2-review.js
  db.exec(`CREATE TABLE IF NOT EXISTS c2_regenerations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, generation_code TEXT, period_month TEXT,
    adherence_as_on TEXT, adherence_planned INTEGER, adherence_adhered INTEGER,
    adherence_missed INTEGER, adherence_pct REAL, plans_before INTEGER, visits_before INTEGER,
    plans_after INTEGER, visits_after INTEGER, missed_dealer_codes TEXT, status TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME);
  CREATE TABLE IF NOT EXISTS c2_regeneration_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, regeneration_id INTEGER, phase TEXT,
    emp_code TEXT, emp_name TEXT, emp_role TEXT, visit_date TEXT,
    dealer_sap_code TEXT, dealer_name TEXT, sequence INTEGER);`);
}

const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const txt = v => (v === null || v === undefined || v === 'None' || v === '') ? null : String(v).trim();

/** '03-Feb-21' → '2021-02-03' */
function doa(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null;
  const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const mo = MON[m[2].toLowerCase()]; if (!mo) return null;
  let y = parseInt(m[3], 10); if (y < 100) y += y < 50 ? 2000 : 1900;
  return `${y}-${String(mo).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
}

/** "Jun-26" / "Jun'26 SALE" → "2026-06" */
function monthKey(header) {
  const m = String(header).match(/([A-Za-z]{3})[-'](\d{2})/);
  if (!m) return null;
  const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const mo = MON[m[1].toLowerCase()]; if (!mo) return null;
  return `20${m[2]}-${String(mo).padStart(2,'0')}`;
}

/**
 * Schema + business rules — shared by every kit, so a kit can never drift from the
 * rule set the engine was tuned against.
 */
export function loadSchemaAndRules() {
  loadSchema();
  for (const [k, n, v] of RULES) {
    db.prepare(`INSERT OR REPLACE INTO business_rules (rule_key, rule_name, rule_value, data_type)
                VALUES (?, ?, ?, 'NUMBER')`).run(k, n, v);
  }
}

// ── business rules (what init-db seeds) ──────────────────────────────────────
const RULES = [
    ['daily_visit_capacity', 'SO daily capacity', '8'],
    ['daily_visit_capacity_asm', 'ASM daily capacity', '6'],
    ['daily_visit_capacity_rsm', 'RSM daily capacity', '4'],
    ['monthly_visit_capacity_zh', 'ZH monthly capacity', '20'],
    ['c1_start_day', 'C1 start', '1'], ['c1_end_day', 'C1 end', '15'],
    ['c2_start_day', 'C2 start', '16'], ['c2_end_day', 'C2 end', '31'],
    ['hol_2nd_sat', '2nd Saturday off', 'true'], ['hol_4th_sat', '4th Saturday off', 'true'],
    ['churn_months', 'Churn window (months)', '6'],
    ['need_to_grow_potential_pct', 'Need-to-grow potential threshold', '60'],
    ['need_to_grow_share_pct', 'Need-to-grow share threshold', '20']
];

export async function seed({ mappingBatch = 'BATCH-DM-E2E', salesBatch = 'BATCH-SH-E2E' } = {}) {
  loadSchemaAndRules();

  // ── upload batches ─────────────────────────────────────────────────────────
  for (const [code, type] of [[mappingBatch, 'DEALER_MAPPING'], [salesBatch, 'SALES_HISTORY']]) {
    await dbRun(`INSERT INTO upload_batches (batch_code, file_type, file_name, status, uploaded_at)
                 VALUES (?, ?, ?, 'COMPLETED', datetime('now'))`, [code, type, `${type}.xlsx`]);
  }

  // ── SBG lookup (authoritative potential + block) ───────────────────────────
  const sbgBy = new Map();
  for (const s of SBG) sbgBy.set(txt(s['Customer Code']), s);

  // ── master_dealers + master_dealer_so_mapping, from Dealer Mapping ─────────
  const dealerIdBySap = new Map();
  for (const m of MAPPING) {
    const sap = txt(m['SAP Code']);
    const sbg = sbgBy.get(sap);
    const r = await dbRun(
      `INSERT INTO master_dealers
        (dealer_type, sap_code, sfa_code, dealer_name, zone, region, area, branch,
         dm_area, dm_sap_code, dm_sfa_code,
         sbg_potential, sbg_block, sbg_status,
         counter_potential, block, territory_code, territory_name, status, doa,
         so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, batch_code)
       VALUES ('DEALER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sap, txt(m['SFA Code']), txt(m['Dealer Name']), txt(m['Zone']), txt(m['Zone']),
        txt(m['Area']), txt(m['Area']),
        txt(m['Area']), sap, txt(m['SFA Code']),
        sbg ? num(sbg['Counter Potential Average (MT)']) : null,
        sbg ? txt(sbg['Block (Taluka)']) : null,
        sbg ? 'SBG_MATCHED' : 'SBG_NOT_FOUND',
        num(m['Counter Potential']), txt(m['Block']),
        sbg ? txt(sbg['Territory Code']) : null, txt(m['Area']),
        doa(m['DOA']),
        txt(m['SO Name']), txt(m['SO Emp Code']), txt(m['ASM Name']), txt(m['ASM Code']),
        txt(m['RSM Name']), txt(m['RSM Code']), txt(m['ZH Name']), txt(m['ZH Code']), mappingBatch
      ]
    );
    const id = r.insertId || r.lastID;
    dealerIdBySap.set(sap, id);

    await dbRun(
      `INSERT INTO master_dealer_so_mapping
        (dealer_id, sap_code, dealer_name, area, region, so_name, so_emp_code,
         asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, block,
         territory_name, batch_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, sap, txt(m['Dealer Name']), txt(m['Area']), txt(m['Zone']),
        txt(m['SO Name']), txt(m['SO Emp Code']),
        txt(m['ASM Name']), txt(m['ASM Code']), txt(m['RSM Name']), txt(m['RSM Code']),
        txt(m['ZH Name']), txt(m['ZH Code']), txt(m['Block']), txt(m['Area']), mappingBatch
      ]
    );
  }

  // ── master_employees — all four roles, as the fixed importer now does ──────
  const emps = new Map();
  for (const m of MAPPING) {
    for (const [codeK, nameK, desig] of [
      ['SO Emp Code', 'SO Name', 'SO'], ['ASM Code', 'ASM Name', 'ASM'],
      ['RSM Code', 'RSM Name', 'RSM'], ['ZH Code', 'ZH Name', 'ZH']
    ]) {
      const c = txt(m[codeK]), n = txt(m[nameK]);
      if (c && n && !emps.has(c)) emps.set(c, { c, n, desig, region: txt(m['Zone']) });
    }
  }
  for (const e of emps.values()) {
    await dbRun(`INSERT INTO master_employees (emp_code, emp_name, designation, zone, region)
                 VALUES (?, ?, ?, ?, ?)`, [e.c, e.n, e.desig, e.region, e.region]);
  }

  // ── prospects ──────────────────────────────────────────────────────────────
  for (const p of PROSPECT) {
    await dbRun(
      `INSERT INTO master_dealers
        (dealer_type, sfa_code, dm_sfa_code, dealer_name, zone, region, area, dm_area,
         block, taluka, counter_potential, expected_sale, status, prospect_status,
         so_name, so_emp_code, batch_code)
       VALUES ('PROSPECTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'PROSPECT_MATCHED', ?, ?, ?)`,
      [
        txt(p['SFA Code']), txt(p['SFA Code']), txt(p['Prospective Dealer Name']),
        txt(p['Zone']), txt(p['Zone']), txt(p['Area']), txt(p['Area']),
        txt(p['Taluka']), txt(p['Taluka']),
        num(p['Potential']), num(p['Expected Sale']),
        txt(p['Name of SO']), txt(p['SO Emp Code']), mappingBatch
      ]
    );
  }

  // ── sales_history (RSAR ONLY) ──────────────────────────────────────────────
  const rsarMonths = Object.keys(RSAR[0]).filter(h => monthKey(h));
  for (const r of RSAR) {
    for (const h of rsarMonths) {
      const pm = monthKey(h);
      await dbRun(
        `INSERT INTO sales_history
           (sap_code, rssd_code, linked_dealer_code, linked_dealer_name, sub_dealer_name,
            zone, period_year_month, quantity_mt, batch_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          txt(r['SAP Code']), txt(r['SAP Code']), txt(r['LinkedDealerCode']),
          txt(r['Linked Dealer Name']), txt(r['Sub Dealer Name']),
          txt(r['Zone']), pm, num(r[h]), salesBatch
        ]
      );
    }
  }

  // ── dealer_performance_history (DP ONLY — never mixed with RSAR) ───────────
  //
  // The DLRWISE export names some months twice — "Jun'26 SALE" (headline) and
  // "Jun-26 SALE" (last cell of the monthly series); likewise May. Both parse to the
  // same period, and loadDealerPerformanceHistory() does SUM(...) GROUP BY period, so
  // writing both would double that month.
  //
  // dealer-performance.importer.js handles this with a per-row `seenInRow` map that
  // keeps the LARGEST value for a period. Mirrored exactly here — if the harness
  // de-duplicated differently from the importer, the kit would stop predicting
  // production.
  const dpMonths = Object.keys(PERF[0]).filter(h => /SALE/i.test(h) && monthKey(h));
  const dpRowPeriods = (row) => {
    const best = new Map();
    for (const h of dpMonths) {
      const pm = monthKey(h);
      const q = num(row[h]);
      if (!Number.isFinite(q)) continue;
      if (!best.has(pm) || q > best.get(pm)) best.set(pm, q);
    }
    return best;
  };
  const tgtKey = Object.keys(PERF[0]).find(h => /\btgt\b/i.test(h) && !/prorata/i.test(h));
  for (const p of PERF) {
    for (const [pm, qty] of dpRowPeriods(p)) {
      await dbRun(
        `INSERT INTO dealer_performance_history
           (sap_code, dealer_name, period_year_month, quantity_mt, target_mt, prorata_target_mt, batch_code)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          txt(p['SAP']), txt(p['DEALERS NAME']), pm, qty,
          tgtKey ? num(p[tgtKey]) : 0, num(p['Prorata Tgt']), mappingBatch
        ]
      );
    }
  }

  return {
    dealers:   (await dbAll(`SELECT COUNT(*) c FROM master_dealers`))[0].c,
    mapping:   (await dbAll(`SELECT COUNT(*) c FROM master_dealer_so_mapping`))[0].c,
    employees: (await dbAll(`SELECT COUNT(*) c FROM master_employees`))[0].c,
    rsarRows:  (await dbAll(`SELECT COUNT(*) c FROM sales_history`))[0].c,
    dpRows:    (await dbAll(`SELECT COUNT(*) c FROM dealer_performance_history`))[0].c,
    mappingBatch, salesBatch
  };
}

/** Load the SFA feedback file — this is the "15th of the month" upload. */
export async function seedSfaFeedback(periodMonth) {
  let n = 0;
  for (const v of SFA) {
    const d = txt(v['Date of Visit']);
    if (!d) continue;
    await dbRun(
      `INSERT INTO visit_execution_logs
         (visit_date, customer_code, customer_name, customer_type, route, branch,
          employee_code, employee_name, check_in_time, check_out_time, duration,
          visit_status, purpose_of_visit, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.slice(0, 10), txt(v['Customer Code']), txt(v['Customer Name']), txt(v['Type']),
        txt(v['Route']), txt(v['Branch']), txt(v['Employee Code']), txt(v['Employee Name']),
        txt(v['Check In Time']), txt(v['Check Out Time']), txt(v['Duration']),
        txt(v['Visit Status(Productive / Non productive)']), txt(v['Purpose Of Visit']), txt(v['Remarks'])
      ]
    );
    n++;
  }
  return n;
}
