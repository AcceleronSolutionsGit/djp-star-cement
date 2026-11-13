import XLSX from 'xlsx';
import { dbAll, dbGet } from '../config/database.js';

async function analyze() {
  console.log('=== ANALYZING MASTER EXCEL OCT VS DATABASE ===\n');

  // 1. Read Master Excel Oct.xlsx
  const filePath = 'New Upload/Master Excel Oct.xlsx';
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['Master '];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  console.log(`[Excel File] Total rows in 'Master ': ${rows.length}`);
  const b2 = ws['B2']?.v;
  console.log(`[Excel File] B2 anchor raw value: ${b2}`);
  if (b2) {
    const excelDate = new Date(Math.round((b2 - 25569) * 86400 * 1000));
    console.log(`[Excel File] B2 anchor date: ${excelDate.toISOString().slice(0, 10)}`);
  }

  const excelHeaders = rows[3];
  console.log('[Excel File] Row 3 Headers sample:', excelHeaders.slice(0, 15));

  // Count Cust Types in Excel
  const excelCustTypes = {};
  const excelDealers = new Map(); // key -> row
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => c === null || String(c).trim() === '')) continue;
    const cType = String(r[0] || '').trim();
    excelCustTypes[cType] = (excelCustTypes[cType] || 0) + 1;

    const sfa = r[10] ? String(r[10]).trim() : null;
    const sap = r[11] ? String(r[11]).trim() : null;
    const name = r[12] ? String(r[12]).trim() : null;
    const key = sap || sfa || name;
    excelDealers.set(key, {
      rowIdx: i + 1,
      custType: cType,
      zone: r[2],
      zh: r[3],
      rsm: r[4],
      asm: r[5],
      area: r[6],
      soName: r[8],
      block: r[9],
      sfaCode: sfa,
      sapCode: sap,
      dealerName: name,
      potential: r[13],
      currentSales: r[14], // Sep'26 Sales
      counterShare: r[15],
      lysmSales: r[16],
      previousSales: r[17],
      avg6m: r[18],
      doa: r[19],
      finalCategory: r[20],
      soVisits: r[27],
      asmVisits: r[28],
      rsmVisits: r[29],
      zhVisits: r[30]
    });
  }

  console.log('\n[Excel File] Cust Type Breakdown:', excelCustTypes);
  console.log(`[Excel File] Total Unique Dealers: ${excelDealers.size}`);

  // 2. Database state for dealer_visit_targets
  const dbPeriods = await dbAll('SELECT period_month, cust_type, count(*) as count, sum(potential) as total_pot, sum(current_sales) as total_sales, sum(so_visits) as total_so_visits FROM dealer_visit_targets GROUP BY period_month, cust_type');
  console.log('\n[Database] dealer_visit_targets summary by period & cust_type:');
  console.table(dbPeriods);

  // 3. Check master_dealers
  const dbMasterDealers = await dbAll('SELECT dealer_type, count(*) as count FROM master_dealers GROUP BY dealer_type');
  console.log('\n[Database] master_dealers summary by dealer_type:');
  console.table(dbMasterDealers);

  // 4. Check sales_plans for 2026-10
  const octPlans = await dbAll("SELECT count(*) as count, count(DISTINCT emp_code) as officers FROM sales_plans WHERE period_month = '2026-10'");
  console.log('\n[Database] sales_plans for 2026-10:', octPlans[0]);

  const octPlanVisits = await dbAll(`
    SELECT spd.dealer_type, count(*) as visit_count 
    FROM sales_plan_details spd
    JOIN sales_plans sp ON spd.plan_id = sp.id
    WHERE sp.period_month = '2026-10'
    GROUP BY spd.dealer_type
  `);
  console.log('[Database] sales_plan_details visits for 2026-10 by dealer_type:');
  console.table(octPlanVisits);

  process.exit(0);
}

analyze().catch(err => {
  console.error(err);
  process.exit(1);
});
