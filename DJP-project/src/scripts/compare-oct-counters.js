import XLSX from 'xlsx';
import { dbAll } from '../config/database.js';

async function compare() {
  const filePath = 'New Upload/Master Excel Oct.xlsx';
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['Master '];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  console.log('Comparing Master Excel Oct.xlsx with Database targets...');

  const excelMap = new Map();
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => c === null || String(c).trim() === '')) continue;
    const sap = r[11] ? String(r[11]).trim() : null;
    const sfa = r[10] ? String(r[10]).trim() : null;
    const key = sap || sfa;
    excelMap.set(key, {
      custType: r[0],
      sfa: r[10],
      sap: r[11],
      name: r[12],
      potential: parseFloat(r[13]) || 0,
      currentSales: parseFloat(r[14]) || 0,
      lysmSales: parseFloat(r[16]) || 0,
      prevSales: parseFloat(r[17]) || 0,
      avg6m: parseFloat(r[18]) || 0,
      finalCategory: r[20],
      soVisits: parseFloat(r[27]) || 0,
      asmVisits: parseFloat(r[28]) || 0,
      rsmVisits: parseFloat(r[29]) || 0,
      zhVisits: parseFloat(r[30]) || 0
    });
  }

  const dbTargets = await dbAll('SELECT sap_code, sfa_code, dealer_name, cust_type, dealer_status, potential, current_sales, lysm_sales, previous_sales, so_visits, asm_visits, rsm_visits, zh_visits, total_visits FROM dealer_visit_targets');

  const dbMap = new Map();
  for (const t of dbTargets) {
    const key = t.sap_code ? String(t.sap_code).trim() : (t.sfa_code ? String(t.sfa_code).trim() : null);
    if (key) dbMap.set(key, t);
  }

  console.log(`Excel total rows: ${excelMap.size}`);
  console.log(`DB total targets: ${dbMap.size}`);

  let missingInDb = 0;
  let potentialMismatches = 0;
  let salesMismatches = 0;
  let categoryMismatches = 0;
  let visitMismatches = 0;
  let custTypeMismatches = 0;

  const sampleMismatches = [];

  for (const [key, ex] of excelMap.entries()) {
    const db = dbMap.get(key) || (ex.sfa ? dbMap.get(ex.sfa) : null) || (ex.sap ? dbMap.get(ex.sap) : null);
    if (!db) {
      missingInDb++;
      if (sampleMismatches.length < 5) {
        sampleMismatches.push({ key, name: ex.name, reason: 'MISSING IN DB TARGETS' });
      }
      continue;
    }

    let hasDiff = false;
    const diff = { key, name: ex.name };

    if (Math.abs(ex.potential - (parseFloat(db.potential) || 0)) > 0.01) {
      potentialMismatches++;
      diff.excelPotential = ex.potential;
      diff.dbPotential = db.potential;
      hasDiff = true;
    }

    if (Math.abs(ex.currentSales - (parseFloat(db.current_sales) || 0)) > 0.01) {
      salesMismatches++;
      diff.excelCurrentSales = ex.currentSales;
      diff.dbCurrentSales = db.current_sales;
      hasDiff = true;
    }

    if (String(ex.finalCategory || '').toUpperCase() !== String(db.dealer_status || '').toUpperCase()) {
      categoryMismatches++;
      diff.excelCategory = ex.finalCategory;
      diff.dbCategory = db.dealer_status;
      hasDiff = true;
    }

    if (Math.abs(ex.soVisits - (parseFloat(db.so_visits) || 0)) > 0.01) {
      visitMismatches++;
      diff.excelSoVisits = ex.soVisits;
      diff.dbSoVisits = db.so_visits;
      hasDiff = true;
    }

    if (String(ex.custType || '').toUpperCase() !== String(db.cust_type || '').toUpperCase()) {
      custTypeMismatches++;
      diff.excelCustType = ex.custType;
      diff.dbCustType = db.cust_type;
      hasDiff = true;
    }

    if (hasDiff && sampleMismatches.length < 10) {
      sampleMismatches.push(diff);
    }
  }

  console.log('\n--- MISMATCH SUMMARY ---');
  console.log(`Dealers in Oct Excel missing in DB targets: ${missingInDb}`);
  console.log(`Potential mismatches: ${potentialMismatches}`);
  console.log(`Current Sales mismatches: ${salesMismatches}`);
  console.log(`Category mismatches: ${categoryMismatches}`);
  console.log(`SO Visits mismatches: ${visitMismatches}`);
  console.log(`Cust Type mismatches: ${custTypeMismatches}`);

  console.log('\nSample Mismatches (first 10):', JSON.stringify(sampleMismatches, null, 2));

  process.exit(0);
}

compare().catch(console.error);
