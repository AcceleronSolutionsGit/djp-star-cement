import { dbAll } from '../src/config/database.js';

async function check7() {
  const dealers = await dbAll('SELECT * FROM master_dealers ORDER BY id ASC');
  console.log('=== MASTER DEALERS (7) ===');
  dealers.forEach(d => {
    console.log(`${d.sap_code || d.sfa_code}: ${d.dealer_name} | doa=${d.doa} | status=${d.status} | type=${d.dealer_type} | pot=${d.sbg_potential || d.counter_potential} | area=${d.area}`);
  });

  const sales = await dbAll('SELECT * FROM sales_history ORDER BY dealer_code, period_year_month');
  console.log('\n=== SALES HISTORY ===');
  sales.forEach(s => {
    console.log(`${s.dealer_code} | ${s.period_year_month} | qty=${s.quantity_mt}`);
  });

  const targets = await dbAll('SELECT * FROM dealer_visit_targets ORDER BY id ASC');
  console.log('\n=== CURRENT TARGETS IN DB ===');
  targets.forEach(t => {
    console.log(`${t.sap_code || t.sfa_code}: ${t.dealer_name} | cat=${t.category} | status=${t.dealer_status} | curr=${t.current_sales} | prev=${t.previous_sales} | lysm=${t.lysm_sales} | 6m=${t.rsar_six_month_avg} | visits=${t.so_visits}/${t.asm_visits}/${t.rsm_visits}/${t.zh_visits}`);
  });
}

check7().catch(console.error);
