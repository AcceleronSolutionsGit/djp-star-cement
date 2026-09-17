import XLSX from 'xlsx';
import path from 'path';
import { dbAll } from '../config/database.js';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target report month and cycle from the user prompt
const PERIOD_MONTH = '2026-06';
const CYCLE_CODE = 'C1';
const GOLDEN_REFERENCE_FILE = path.join(__dirname, '../../upload-files/file-1788283401406-85577886.xlsx'); 
// Ensure this path points to M.xlsx

async function runReconciliation() {
  console.log(`====================================================`);
  console.log(`PJP/DJP GOLDEN REFERENCE RECONCILIATION RUN`);
  console.log(`Period: ${PERIOD_MONTH} | Cycle: ${CYCLE_CODE}`);
  console.log(`====================================================\n`);

  // 1. Run the PJP Engine to ensure calculations are fresh
  console.log(`[1] Running PJP calculation...`);
  try {
    const res = await calculatePJP(PERIOD_MONTH, CYCLE_CODE, { debug: true });
    console.log(`  -> Generated ${res.totalDealerTargets} targets.\n`);
  } catch (err) {
    console.error(`  -> Failed to generate PJP:`, err);
    process.exit(1);
  }

  // 2. Fetch the newly generated 16-column data
  console.log(`[2] Fetching generated output from database...`);
  const sql = `
    SELECT 
      dvt.*,
      md.dealer_type,
      md.block
    FROM dealer_visit_targets dvt
    LEFT JOIN master_dealers md ON dvt.dealer_id = md.id
    WHERE dvt.period_month = ? AND dvt.cycle_code = ?
  `;
  const targets = await dbAll(sql, [PERIOD_MONTH, CYCLE_CODE]);
  
  // Transform to match the 16 exact columns
  const generatedMap = new Map();
  for (const t of targets) {
    let custType = t.dealer_type || 'DEALER';
    if (custType.toUpperCase() === 'NON_STAR') custType = 'NON-STAR';

    let custCode = t.sap_code;
    if (!custCode && t.sfa_code) custCode = t.sfa_code;
    
    // Normalize key for stable matching (Dealer Name + Customer Code)
    const key = `${String(t.dealer_name || '').trim().toUpperCase()}_${String(custCode || '').trim().toUpperCase()}`;

    generatedMap.set(key, {
      Zone: t.zone,
      CustType: custType,
      Area: t.area,
      Block: t.block || '',
      ZH: t.zh_name || '',
      RSM: t.rsm_name || '',
      ASM: t.asm_name || '',
      SO: t.so_name || '',
      DealerName: t.dealer_name,
      CustomerCode: custCode,
      Priority: parseInt(t.priority, 10) || 0,
      Category: t.dealer_status || t.category,
      SOVisits: parseFloat(t.so_visits) || 0,
      ASMVisits: parseFloat(t.asm_visits) || 0,
      RSMVisits: parseFloat(t.rsm_visits) || 0,
      ZHVisits: parseFloat(t.zh_visits) || 0
    });
  }
  console.log(`  -> Fetched ${generatedMap.size} unique records.\n`);

  // 3. Load M.xlsx (Golden Reference)
  console.log(`[3] Loading Golden Reference (M.xlsx)...`);
  let refRows = [];
  try {
    const workbook = XLSX.readFile(GOLDEN_REFERENCE_FILE);
    const sheetName = workbook.SheetNames[0];
    refRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, range: 3 });
  } catch (err) {
    console.error(`  -> Failed to read reference file: ${GOLDEN_REFERENCE_FILE}`);
    console.error(`  -> Error:`, err.message);
    process.exit(1);
  }
  
  // Helper to find field with fuzzy header matching
  const findVal = (row, candidates) => {
    for (const k of Object.keys(row)) {
      const cleanKey = k.replace(/[\n\r\s]+/g, ' ').trim().toLowerCase();
      for (const c of candidates) {
        if (cleanKey === c.toLowerCase() || cleanKey.includes(c.toLowerCase())) {
          return row[k];
        }
      }
    }
    return null;
  };

  // Create reference map
  const refMap = new Map();
  for (const row of refRows) {
    const dealerName = String(findVal(row, ['dealer name']) || '').trim().toUpperCase();
    const custCode = String(findVal(row, ['customer code', 'customer code', 'sap code', 'sfa code']) || '').trim().toUpperCase();
    if (!dealerName && !custCode) continue;

    const key = `${dealerName}_${custCode}`;

    const priorityVal = findVal(row, ['rank based on total score', 'priority']);
    const catVal = findVal(row, ['final category', 'category']);
    const soVisitsVal = findVal(row, ['number of visits by so/sr', 'no. of visits by so', 'so visits']);
    const asmVisitsVal = findVal(row, ['number of visits by asm', 'no. of visits by asm', 'asm visits']);
    const rsmVisitsVal = findVal(row, ['number of visits by rsm', 'rsm visits']);
    const zhVisitsVal = findVal(row, ['number of visits by zh', 'zh visits']);

    refMap.set(key, {
      Zone: findVal(row, ['zone']),
      CustType: findVal(row, ['cust type', 'customer type']),
      Area: findVal(row, ['area']),
      Block: findVal(row, ['block (taluka)', 'block', 'taluka']),
      ZH: findVal(row, ['zonal head', 'zh']),
      RSM: findVal(row, ['rsm']),
      ASM: findVal(row, ['asm']),
      SO: findVal(row, ['so/se name', 'so name']),
      DealerName: dealerName,
      CustomerCode: custCode,
      Priority: parseInt(priorityVal, 10) || 0,
      Category: catVal,
      SOVisits: parseFloat(soVisitsVal) || 0,
      ASMVisits: parseFloat(asmVisitsVal) || 0,
      RSMVisits: parseFloat(rsmVisitsVal) || 0,
      ZHVisits: parseFloat(zhVisitsVal) || 0
    });
  }
  console.log(`  -> Loaded ${refMap.size} reference records.\n`);

  // 4. Reconciliation
  console.log(`[4] Running row-by-row reconciliation...`);
  let matched = 0;
  let mismatched = 0;
  let missing = 0;
  let extra = 0;
  
  const mismatchDetails = [];

  // Check generated against reference
  for (const [key, gen] of generatedMap.entries()) {
    const ref = refMap.get(key);
    
    if (!ref) {
      extra++;
      continue;
    }

    // Compare fields
    const diffs = [];
    if (gen.Category !== ref.Category) diffs.push(`Category: Gen=${gen.Category}, Ref=${ref.Category}`);
    if (gen.Priority !== ref.Priority) diffs.push(`Priority: Gen=${gen.Priority}, Ref=${ref.Priority}`);
    if (gen.SOVisits !== ref.SOVisits) diffs.push(`SOVisits: Gen=${gen.SOVisits}, Ref=${ref.SOVisits}`);
    if (gen.ASMVisits !== ref.ASMVisits) diffs.push(`ASMVisits: Gen=${gen.ASMVisits}, Ref=${ref.ASMVisits}`);
    if (gen.RSMVisits !== ref.RSMVisits) diffs.push(`RSMVisits: Gen=${gen.RSMVisits}, Ref=${ref.RSMVisits}`);
    if (gen.ZHVisits !== ref.ZHVisits) diffs.push(`ZHVisits: Gen=${gen.ZHVisits}, Ref=${ref.ZHVisits}`);

    if (diffs.length > 0) {
      mismatched++;
      mismatchDetails.push({ key, dealerName: gen.DealerName, diffs });
    } else {
      matched++;
    }
  }

  // Check missing
  for (const key of refMap.keys()) {
    if (!generatedMap.has(key)) {
      missing++;
    }
  }

  console.log(`====================================================`);
  console.log(`RECONCILIATION RESULTS`);
  console.log(`====================================================`);
  console.log(`  Reference rows: ${refMap.size}`);
  console.log(`  Generated rows: ${generatedMap.size}`);
  console.log(`  Matched:        ${matched}`);
  console.log(`  Mismatched:     ${mismatched}`);
  console.log(`  Missing:        ${missing}`);
  console.log(`  Extra:          ${extra}\n`);

  if (mismatched > 0) {
    console.log(`--- MISMATCH DETAILS (First 20) ---`);
    mismatchDetails.slice(0, 20).forEach(m => {
      console.log(`Dealer: ${m.dealerName} (${m.key})`);
      m.diffs.forEach(d => console.log(`  - ${d}`));
    });
  }
}

runReconciliation().catch(err => {
  console.error(err);
  process.exit(1);
});
