/**
 * Seed the E2E database from the AGARTALA kit, exactly as the real importers would.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbRun, dbAll } from './sandbox/src/config/database.js';
import { loadSchemaAndRules } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const KIT = JSON.parse(readFileSync(join(here, '..', '..', 'kit-agartala', 'kit.json'), 'utf8'));

export async function seedAgartala({ mappingBatch = 'BATCH-DM-AGT', salesBatch = 'BATCH-SH-AGT' } = {}) {
  loadSchemaAndRules();

  for (const [c, t] of [[mappingBatch, 'DEALER_MAPPING'], [salesBatch, 'SALES_HISTORY']]) {
    await dbRun(`INSERT INTO upload_batches (batch_code, file_type, file_name, status, uploaded_at)
                 VALUES (?, ?, ?, 'COMPLETED', datetime('now'))`, [c, t, `${t}.xlsx`]);
  }

  const emps = new Map();
  const add = (code, name, desig) => { if (code && name && !emps.has(code)) emps.set(code, { code, name, desig }); };

  for (const d of KIT.dealers) {
    const [soName, soCode] = KIT.soByBlock[d.block] || ['SUBRATA DEB', '11003101'];

    const r = await dbRun(
      `INSERT INTO master_dealers
        (dealer_type, sap_code, sfa_code, dealer_name, zone, region, area, branch,
         dm_area, dm_sap_code, dm_sfa_code, sbg_potential, sbg_block, sbg_status,
         counter_potential, block, territory_name, status, doa,
         so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, batch_code)
       VALUES ('DEALER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SBG_MATCHED', ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.sap, d.sfa, d.name, d.zone, d.zone, d.area, d.area, d.area, d.sap, d.sfa,
       d.potential, d.block, d.potential, d.block, d.area, d.doa,
       soName, soCode, d.asm, KIT.asmCode, d.rsm, KIT.rsmCode, d.zh, KIT.zhCode, mappingBatch]
    );
    const id = r.insertId || r.lastID;

    await dbRun(
      `INSERT INTO master_dealer_so_mapping
        (dealer_id, sap_code, dealer_name, area, region, so_name, so_emp_code,
         asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, block, territory_name, batch_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, d.sap, d.name, d.area, d.zone, soName, soCode, d.asm, KIT.asmCode,
       d.rsm, KIT.rsmCode, d.zh, KIT.zhCode, d.block, d.area, mappingBatch]
    );

    add(soCode, soName, 'SO');
    add(KIT.asmCode, d.asm, 'ASM');
    add(KIT.rsmCode, d.rsm, 'RSM');
    add(KIT.zhCode,  d.zh,  'ZH');

    // Dealer Performance — the DEALER's own monthly sales, plus Q.
    for (let i = 0; i < KIT.months.length; i++) {
      await dbRun(
        `INSERT INTO dealer_performance_history
           (sap_code, dealer_name, period_year_month, quantity_mt, target_mt, prorata_target_mt, batch_code)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [d.sap, d.name, KIT.months[i], d.series[i], Math.round(d.O * 1.1), Math.round(d.O * 1.1), mappingBatch]
      );
    }
    await dbRun(
      `INSERT INTO dealer_performance_history
         (sap_code, dealer_name, period_year_month, quantity_mt, target_mt, prorata_target_mt, batch_code)
       VALUES (?, ?, ?, ?, 0, 0, ?)`,
      [d.sap, d.name, KIT.lysm, d.Q, mappingBatch]
    );
  }

  // RSAR — sub-dealer sales, linked back to the parent dealer.
  for (const s of KIT.subDealers) {
    for (const m of KIT.months) {
      await dbRun(
        `INSERT INTO sales_history
           (sap_code, rssd_code, linked_dealer_code, linked_dealer_name, sub_dealer_name,
            zone, period_year_month, quantity_mt, batch_code)
         VALUES (?, ?, ?, ?, ?, 'NE2', ?, ?, ?)`,
        [s.sap, s.rssd, s.parent, '', s.name, m, s.sales[m] || 0, salesBatch]
      );
    }
  }

  for (const e of emps.values())
    await dbRun(`INSERT INTO master_employees (emp_code, emp_name, designation, zone, region)
                 VALUES (?, ?, ?, 'NE2', 'NE2')`, [e.code, e.name, e.desig]);

  for (const [name, sfa, block, pot, exp] of KIT.prospects) {
    const [soName, soCode] = KIT.soByBlock[block] || ['SUBRATA DEB', '11003101'];
    await dbRun(
      `INSERT INTO master_dealers
        (dealer_type, sfa_code, dm_sfa_code, dealer_name, zone, region, area, dm_area,
         block, taluka, counter_potential, expected_sale, status, prospect_status,
         so_name, so_emp_code, batch_code)
       VALUES ('PROSPECTIVE', ?, ?, ?, 'NE2', 'NE2', 'AGARTALA', 'AGARTALA', ?, ?, ?, ?, 'ACTIVE', 'PROSPECT_MATCHED', ?, ?, ?)`,
      [sfa, sfa, name, block, block, pot, exp, soName, soCode, mappingBatch]
    );
  }

  return {
    dealers:   (await dbAll(`SELECT COUNT(*) c FROM master_dealers WHERE dealer_type='DEALER'`))[0].c,
    prospects: (await dbAll(`SELECT COUNT(*) c FROM master_dealers WHERE dealer_type='PROSPECTIVE'`))[0].c,
    employees: (await dbAll(`SELECT COUNT(*) c FROM master_employees`))[0].c,
    rsarRows:  (await dbAll(`SELECT COUNT(*) c FROM sales_history`))[0].c,
    dpRows:    (await dbAll(`SELECT COUNT(*) c FROM dealer_performance_history`))[0].c,
    mappingBatch, salesBatch
  };
}

export async function seedAgartalaSfa() {
  let n = 0;
  for (const v of KIT.visits) {
    await dbRun(
      `INSERT INTO visit_execution_logs
         (visit_date, customer_code, customer_name, customer_type, route, branch,
          employee_code, employee_name, check_in_time, check_out_time, duration,
          visit_status, purpose_of_visit, remarks)
       VALUES (?, ?, ?, 'Dealer', 'AGARTALA-RT', 'AGARTALA', ?, ?, '10:05:00', '11:12:00', '34 Minute(s)', ?, 'Routine Visit,,', 'None')`,
      [v[0], v[1], v[2], v[4], v[3], v[5]]
    );
    n++;
  }
  return n;
}
