import XLSX from 'xlsx';
import { dbRun, dbAll, dbGet } from '../config/database.js';

export async function deduplicateAndFixPjpMapping(periodMonth = '2026-07', cycleCode = 'C1') {
  console.log('================================================================');
  console.log('Deduplicating & Synchronizing PJP Targets with Official Territory Hierarchy');
  console.log('================================================================');

  // 1. Load official hierarchy mapping from Dealer - SO Territory Hierarchy Mapping.xlsx
  const wbH = XLSX.readFile('upload-files/Dealer - SO Territory Hierarchy Mapping.xlsx');
  const hSheet = wbH.Sheets['Sheet1'] || wbH.Sheets[wbH.SheetNames[0]];
  const hRows = XLSX.utils.sheet_to_json(hSheet);

  console.log(`Loaded ${hRows.length} official hierarchy rows.`);

  const sapHierarchyMap = new Map();
  const nameHierarchyMap = new Map();

  for (const row of hRows) {
    const sapCode = row['Dealer SAP Code'] ? String(row['Dealer SAP Code']).trim() : null;
    const dealerName = row['Dealer Name'] ? String(row['Dealer Name']).trim() : null;
    const area = row['Area'] ? String(row['Area']).trim() : null;
    const region = row['Region'] ? String(row['Region']).trim() : null;
    const soName = row['SO Name'] ? String(row['SO Name']).trim() : null;
    let soEmpCode = (row['SO E Code'] || row['SO Emp Code'] || row['SO Employee Code'])
      ? String(row['SO E Code'] || row['SO Emp Code'] || row['SO Employee Code']).trim()
      : null;

    if (!dealerName && !sapCode) continue;
    if (!soName) continue;

    if (!soEmpCode) {
      soEmpCode = 'SO_' + soName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
    }

    const info = { sapCode, dealerName, area, region, soName, soEmpCode };
    if (sapCode) sapHierarchyMap.set(sapCode.toUpperCase(), info);
    if (dealerName) nameHierarchyMap.set(`${dealerName}_${area || ''}`.toUpperCase(), info);
  }

  // 2. Load SFA CODE -> SAP CODE lookup from Master tab of PJP Process -Trade.xlsx
  const wbPjp = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');
  const masterSheet = wbPjp.Sheets['Master '];
  const masterRows = XLSX.utils.sheet_to_json(masterSheet, { header: 1 });

  const sfaToSapMap = new Map();
  for (let r = 4; r < masterRows.length; r++) {
    const row = masterRows[r];
    if (!row || !row[12]) continue;

    const sfaCode = row[10] ? String(row[10]).trim() : null;
    const sapCode = row[11] ? String(row[11]).trim() : null;
    const dealerName = row[12] ? String(row[12]).trim() : null;
    const area = row[6] ? String(row[6]).trim() : null;

    if (sfaCode && sapCode && sapCode !== '-') {
      sfaToSapMap.set(sfaCode.toUpperCase(), sapCode.toUpperCase());
    }
  }

  console.log(`Loaded ${sfaToSapMap.size} SFA -> SAP Code cross-references.`);

  // 3. Load Visits tab (from full-generated-visit-file.xlsx or PJP Process -Trade.xlsx)
  const genVisitPath = 'upload-files/full-generated-visit-file.xlsx';
  const wbGen = XLSX.readFile(genVisitPath);
  const genSheet = wbGen.Sheets['Sheet1'] || wbGen.Sheets[wbGen.SheetNames[0]];
  const genRows = XLSX.utils.sheet_to_json(genSheet, { header: 1 });

  let headerRowIdx = 1;
  for (let i = 0; i < Math.min(10, genRows.length); i++) {
    const r = genRows[i];
    if (r && (r.includes('DEALER NAME') || r.includes('SO/SE  NAME') || r.includes('SFA CODE'))) {
      headerRowIdx = i;
      break;
    }
  }

  // Clear existing dealer_visit_targets and master_dealer_so_mapping to eliminate all stale duplicates
  await dbRun('DELETE FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ?', [periodMonth, cycleCode]);
  await dbRun('DELETE FROM master_dealer_so_mapping');

  // Insert fresh official mappings from Dealer - SO Territory Hierarchy Mapping.xlsx
  for (const info of sapHierarchyMap.values()) {
    let dealer = null;
    if (info.sapCode) {
      dealer = await dbGet('SELECT id FROM master_dealers WHERE sap_code = ?', [info.sapCode]);
    }
    if (!dealer && info.dealerName) {
      dealer = await dbGet('SELECT id FROM master_dealers WHERE dealer_name = ?', [info.dealerName]);
    }

    let dealerId = dealer ? dealer.id : null;
    if (!dealer) {
      const res = await dbRun(
        'INSERT INTO master_dealers (dealer_type, sap_code, dealer_name, region, area) VALUES (?, ?, ?, ?, ?)',
        ['DEALER', info.sapCode, info.dealerName, info.region, info.area]
      );
      dealerId = res.lastID;
    }

    await dbRun(
      'INSERT INTO master_dealer_so_mapping (dealer_id, sap_code, dealer_name, area, region, so_name, so_emp_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [dealerId, info.sapCode, info.dealerName, info.area, info.region, info.soName, info.soEmpCode]
    );

    const emp = await dbGet('SELECT id FROM master_employees WHERE emp_code = ? OR emp_name = ?', [info.soEmpCode, info.soName]);
    if (!emp) {
      await dbRun(
        'INSERT INTO master_employees (emp_code, emp_name, designation, region) VALUES (?, ?, ?, ?)',
        [info.soEmpCode, info.soName, 'SO/SE', info.region]
      );
    }
  }

  console.log(`Re-populated master_dealer_so_mapping with ${sapHierarchyMap.size} official hierarchy records.`);

  // 4. Ingest visit targets strictly mapped to governing hierarchy
  const processedTargetKeys = new Set();
  let validTargetsCount = 0;

  for (let i = headerRowIdx + 1; i < genRows.length; i++) {
    const r = genRows[i];
    if (!r || r.length < 6) continue;

    // Layout: [1]: Area, [2]: Block, [3]: ASM, [4]: SO/SE Name, [5]: Dealer Name, [6]: SFA Code, [7]: Priority, [8]: Category, [9]: SO Visits, [10]: ASM Visits, [11]: RSM Visits, [12]: ZH Visits
    const area = r[1] ? String(r[1]).trim() : null;
    const block = r[2] ? String(r[2]).trim() : null;
    const asmName = r[3] ? String(r[3]).trim() : null;
    const fileSoName = r[4] ? String(r[4]).trim() : null;
    const dealerName = r[5] ? String(r[5]).trim() : null;
    let sfaCode = r[6] ? String(r[6]).trim() : null;
    const categoryStatus = r[8] ? String(r[8]).trim() : 'Active';
    const soVisits = r[9] !== undefined && r[9] !== null ? Number(r[9]) : 0;
    const asmVisits = r[10] !== undefined && r[10] !== null ? Number(r[10]) : 0;
    const rsmVisits = r[11] !== undefined && r[11] !== null ? Number(r[11]) : 0;
    const zhVisits = r[12] !== undefined && r[12] !== null ? Number(r[12]) : 0;

    if (!dealerName && (!sfaCode || sfaCode === '-')) continue;

    // Resolve official SAP Code
    const cleanSfa = (sfaCode && sfaCode !== '-') ? sfaCode.toUpperCase() : null;
    let sapCode = cleanSfa ? sfaToSapMap.get(cleanSfa) : null;

    // Find official hierarchy info
    let officialInfo = null;
    if (sapCode) officialInfo = sapHierarchyMap.get(sapCode.toUpperCase());
    if (!officialInfo && dealerName) {
      officialInfo = nameHierarchyMap.get(`${dealerName}_${area || ''}`.toUpperCase()) || nameHierarchyMap.get(dealerName.toUpperCase());
    }

    // Override with official hierarchy mapping
    const finalSapCode = officialInfo?.sapCode || sapCode || cleanSfa || (dealerName ? `${dealerName}_${area}`.toUpperCase().replace(/\s+/g, '_') : `DLR_${i}`);
    const finalSoName = officialInfo?.soName || fileSoName || 'SO_UNKNOWN';
    const finalSoEmpCode = officialInfo?.soEmpCode || ('SO_' + finalSoName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase());
    const finalArea = officialInfo?.area || area;
    const finalRegion = officialInfo?.region || 'NE 1';

    // Deduplicate by targetKey: (periodMonth, cycleCode, finalSapCode)
    const targetKey = `${periodMonth}_${cycleCode}_${finalSapCode}`;
    if (processedTargetKeys.has(targetKey)) continue;
    processedTargetKeys.add(targetKey);

    const totalVisits = soVisits + asmVisits + rsmVisits + zhVisits;
    const soVisitsPct = totalVisits > 0 ? Math.round((soVisits / totalVisits) * 10000) / 100 : 0;
    const asmVisitsPct = totalVisits > 0 ? Math.round((asmVisits / totalVisits) * 10000) / 100 : 0;
    const rsmVisitsPct = totalVisits > 0 ? Math.round((rsmVisits / totalVisits) * 10000) / 100 : 0;
    const zhVisitsPct = totalVisits > 0 ? Math.round((zhVisits / totalVisits) * 10000) / 100 : 0;

    let dealer = await dbGet('SELECT id FROM master_dealers WHERE sap_code = ? OR sfa_code = ?', [finalSapCode, cleanSfa]);
    if (!dealer && dealerName) {
      dealer = await dbGet('SELECT id FROM master_dealers WHERE dealer_name = ?', [dealerName]);
    }

    let dealerId = dealer ? dealer.id : null;

    await dbRun(
      `INSERT INTO dealer_visit_targets 
      (period_month, cycle_code, dealer_id, dealer_name, sap_code, sfa_code, area, zone, category, dealer_status, so_name, so_emp_code, so_visits, asm_visits, rsm_visits, zh_visits, total_visits, so_visits_pct, asm_visits_pct, rsm_visits_pct, zh_visits_pct) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        periodMonth,
        cycleCode,
        dealerId,
        dealerName,
        finalSapCode,
        cleanSfa || finalSapCode,
        finalArea,
        finalRegion,
        categoryStatus,
        categoryStatus,
        finalSoName,
        finalSoEmpCode,
        soVisits,
        asmVisits,
        rsmVisits,
        zhVisits,
        totalVisits,
        soVisitsPct,
        asmVisitsPct,
        rsmVisitsPct,
        zhVisitsPct
      ]
    );

    validTargetsCount++;
  }

  console.log(`================================================================`);
  console.log(`DEDUPLICATION COMPLETED!`);
  console.log(`- Total Unique Canonical Dealer Targets Saved: ${validTargetsCount}`);
  console.log(`================================================================\n`);
}

async function main() {
  await deduplicateAndFixPjpMapping();

  // Verify ALOM ENTERPRISE
  const alomTargets = await dbAll('SELECT * FROM dealer_visit_targets WHERE dealer_name LIKE "%ALOM ENTERPRISE%"');
  console.log('\n--- Verification: ALOM ENTERPRISE targets in database.sqlite ---');
  console.dir(alomTargets, { depth: null });
}

main().catch(console.error);
