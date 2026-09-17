/**
 * Seed the E2E database from kit v2.
 *
 * Mirrors what the real importers write, with the same de-duplication rule
 * dealer-performance.importer.js uses (largest value wins when two columns name the
 * same month).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dbRun, dbAll } from './sandbox/src/config/database.js';
import { loadSchemaAndRules } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const KIT  = JSON.parse(readFileSync(join(here, '..', '..', 'kit-v2', 'kit.json'), 'utf8'));

const MONN = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function isoDoa(s) {
  const m = String(s || '').match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += y < 50 ? 2000 : 1900;
  return `${y}-${String(MONN[m[2].toLowerCase()]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

const ZONE = 'NB1';
const HIER = {
  ALIPURDUAR: { so: ['DEBABRATA CHAKRABORTY- FKT', '11001774'], asm: ['DEBABRATA GHOSH', '11001393'],
                rsm: ['RITWICK CHATTERJEE', '11001813'],       zh:  ['GIRIDHARI MUKHERJEE', '11002257'] },
  JALPAIGURI: { so: ['ARINDAM PAUL', '11001975'],              asm: ['DEBABRATA GHOSH', '11001393'],
                rsm: ['RITWICK CHATTERJEE', '11001813'],       zh:  ['GIRIDHARI MUKHERJEE', '11002257'] },
  KATIHAR:    { so: ['SUBHASISH KARMAKAR', '11002168'],        asm: ['SANTANU BAZAL', '11002336'],
                rsm: ['PRAKRITI RANJAN SIKDAR', '1101157'],    zh:  ['GIRIDHARI MUKHERJEE', '11002257'] }
};
const hier = a => HIER[a] || HIER.ALIPURDUAR;

export async function seedKitV2({ mappingBatch = 'BATCH-DM-V2', salesBatch = 'BATCH-SH-V2' } = {}) {
  loadSchemaAndRules();

  for (const [code, type] of [[mappingBatch, 'DEALER_MAPPING'], [salesBatch, 'SALES_HISTORY']]) {
    await dbRun(`INSERT INTO upload_batches (batch_code, file_type, file_name, status, uploaded_at)
                 VALUES (?, ?, ?, 'COMPLETED', datetime('now'))`, [code, type, `${type}.csv`]);
  }

  const emps = new Map();

  for (const d of KIT.dealers) {
    const h = hier(d.area);
    const doa = isoDoa(d.doa);
    const r = await dbRun(
      `INSERT INTO master_dealers
        (dealer_type, sap_code, sfa_code, dealer_name, zone, region, area, branch,
         dm_area, dm_sap_code, dm_sfa_code, sbg_potential, sbg_block, sbg_status,
         counter_potential, block, territory_name, status, doa,
         so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, batch_code)
       VALUES ('DEALER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SBG_MATCHED', ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.sap, d.sfa, d.name, ZONE, ZONE, d.area, d.area, d.area, d.sap, d.sfa,
       d.pot, d.block, d.pot, d.block, d.area, doa,
       h.so[0], h.so[1], h.asm[0], h.asm[1], h.rsm[0], h.rsm[1], h.zh[0], h.zh[1], mappingBatch]
    );
    const id = r.insertId || r.lastID;

    await dbRun(
      `INSERT INTO master_dealer_so_mapping
        (dealer_id, sap_code, dealer_name, area, region, so_name, so_emp_code,
         asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, block, territory_name, batch_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, d.sap, d.name, d.area, ZONE, h.so[0], h.so[1], h.asm[0], h.asm[1],
       h.rsm[0], h.rsm[1], h.zh[0], h.zh[1], d.block, d.area, mappingBatch]
    );

    for (const [name, code, desig] of [
      [h.so[0], h.so[1], 'SO'], [h.asm[0], h.asm[1], 'ASM'],
      [h.rsm[0], h.rsm[1], 'RSM'], [h.zh[0], h.zh[1], 'ZH']
    ]) if (!emps.has(code)) emps.set(code, { name, code, desig });

    // ── Dealer Performance: the dealer's OWN monthly sales ──────────────────
    // Largest-wins per period, exactly as dealer-performance.importer.js does.
    const best = new Map();
    KIT.months.forEach((pm, i) => {
      const q = d.dp[i];
      if (!best.has(pm) || q > best.get(pm)) best.set(pm, q);
    });
    best.set('2025-06', d.lys);                       // Jun-25, Q
    for (const [pm, qty] of best) {
      await dbRun(
        `INSERT INTO dealer_performance_history
           (sap_code, dealer_name, period_year_month, quantity_mt, target_mt, prorata_target_mt, batch_code)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [d.sap, d.name, pm, qty, Math.round(d.dp[5] * 1.1), Math.round(d.dp[5] * 1.1), mappingBatch]
      );
    }

    // ── RSAR: the SUB-DEALERS beneath this dealer, own codes, linked back ────
    if (d.rsar) {
      const a = d.rsar.map(v => Math.round(v * 0.6));
      const b = d.rsar.map((v, i) => v - a[i]);
      for (const [suffix, series] of [['A', a], ['B', b]]) {
        const subCode = `15${d.sap.slice(2)}${suffix}`;
        KIT.months.forEach((pm, i) => dbRun(
          `INSERT INTO sales_history
             (sap_code, rssd_code, linked_dealer_code, linked_dealer_name, sub_dealer_name,
              zone, period_year_month, quantity_mt, batch_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [subCode, subCode, d.sap, d.name, `RSSD ${d.name} ${suffix}`, ZONE, pm, series[i], salesBatch]
        ));
      }
      await new Promise(r2 => setImmediate(r2));
    }
  }

  for (const e of emps.values())
    await dbRun(`INSERT INTO master_employees (emp_code, emp_name, designation, zone, region)
                 VALUES (?, ?, ?, ?, ?)`, [e.code, e.name, e.desig, ZONE, ZONE]);

  for (const p of KIT.prospects) {
    await dbRun(
      `INSERT INTO master_dealers
        (dealer_type, sfa_code, dm_sfa_code, dealer_name, zone, region, area, dm_area,
         block, taluka, counter_potential, expected_sale, status, prospect_status,
         so_name, so_emp_code, batch_code)
       VALUES ('PROSPECTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'PROSPECT_MATCHED', ?, ?, ?)`,
      [p[1], p[1], p[0], ZONE, ZONE, p[2], p[2], p[3], p[3], p[6], p[7], p[4], p[5], mappingBatch]
    );
  }

  return {
    dealers:   (await dbAll(`SELECT COUNT(*) c FROM master_dealers WHERE dealer_type='DEALER'`))[0].c,
    prospects: (await dbAll(`SELECT COUNT(*) c FROM master_dealers WHERE dealer_type='PROSPECTIVE'`))[0].c,
    rsarRows:  (await dbAll(`SELECT COUNT(*) c FROM sales_history`))[0].c,
    dpRows:    (await dbAll(`SELECT COUNT(*) c FROM dealer_performance_history`))[0].c,
    mappingBatch, salesBatch
  };
}

/** Load the SFA feedback file — the 15th-of-month upload. */
export async function seedKitV2Sfa() {
  let n = 0;
  for (const v of KIT.visits) {
    await dbRun(
      `INSERT INTO visit_execution_logs
         (visit_date, customer_code, customer_name, customer_type, route, branch,
          employee_code, employee_name, check_in_time, check_out_time, duration,
          visit_status, purpose_of_visit, remarks)
       VALUES (?, ?, ?, 'Dealer', 'ROUTE', 'BRANCH', ?, ?, '10:05:00', '11:10:00', '31 Minute(s)', ?, 'Routine Visit,,', 'None')`,
      [v[0], v[1], v[2], v[3], v[4], v[5]]
    );
    n++;
  }
  return n;
}
