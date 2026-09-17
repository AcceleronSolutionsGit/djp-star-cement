import XLSX from 'xlsx';
import { dbRun, dbGet, dbAll } from '../config/database.js';

export async function importDealerMappingFile(filePath) {
  console.log(`Processing Dealer SO Mapping from: ${filePath}`);
  const workbook = XLSX.readFile(filePath);

  let sheetName = 'Dealer SO Mapping';
  if (!workbook.SheetNames.includes(sheetName)) {
    if (workbook.SheetNames.includes('Sheet1')) {
      sheetName = 'Sheet1';
    } else {
      sheetName = workbook.SheetNames[0];
    }
  }

  console.log(`Using sheet '${sheetName}' for Dealer SO Territory Mapping.`);

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);

  let insertedCount = 0;
  let targetsUpdatedCount = 0;

  for (const row of rows) {
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

    // 1. Ensure dealer exists in master_dealers
    let dealer = null;
    if (sapCode) {
      dealer = await dbGet('SELECT id FROM master_dealers WHERE sap_code = ? OR sfa_code = ?', [sapCode, sapCode]);
    }
    if (!dealer && dealerName) {
      dealer = await dbGet('SELECT id FROM master_dealers WHERE dealer_name = ?', [dealerName]);
    }

    if (!dealer) {
      const res = await dbRun(
        'INSERT INTO master_dealers (dealer_type, sap_code, dealer_name, region, area) VALUES (?, ?, ?, ?, ?)',
        ['DEALER', sapCode, dealerName, region, area]
      );
      dealer = { id: res.lastID };
    } else {
      await dbRun(
        'UPDATE master_dealers SET area = COALESCE(?, area), region = COALESCE(?, region) WHERE id = ?',
        [area, region, dealer.id]
      );
    }

    // 2. Upsert in master_dealer_so_mapping
    const existingMapping = await dbGet(
      'SELECT id FROM master_dealer_so_mapping WHERE sap_code = ? OR dealer_id = ?',
      [sapCode, dealer.id]
    );

    if (!existingMapping) {
      await dbRun(
        'INSERT INTO master_dealer_so_mapping (dealer_id, sap_code, dealer_name, area, region, so_name, so_emp_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [dealer.id, sapCode, dealerName, area, region, soName, soEmpCode]
      );
    } else {
      await dbRun(
        'UPDATE master_dealer_so_mapping SET area = ?, region = ?, so_name = ?, so_emp_code = ? WHERE id = ?',
        [area, region, soName, soEmpCode, existingMapping.id]
      );
    }

    // 3. Sync to master_employees
    const emp = await dbGet('SELECT id FROM master_employees WHERE emp_code = ? OR emp_name = ?', [soEmpCode, soName]);
    if (!emp) {
      await dbRun(
        'INSERT INTO master_employees (emp_code, emp_name, designation, region) VALUES (?, ?, ?, ?)',
        [soEmpCode, soName, 'SO/SE', region]
      );
    }

    // 4. Update dealer_visit_targets matching sapCode or dealerName
    if (sapCode) {
      const targetRes = await dbRun(
        'UPDATE dealer_visit_targets SET so_name = ?, so_emp_code = ?, area = COALESCE(?, area) WHERE sap_code = ? OR sfa_code = ?',
        [soName, soEmpCode, area, sapCode, sapCode]
      );
      if (targetRes.changes > 0) targetsUpdatedCount += targetRes.changes;
    }
    if (dealerName) {
      const targetRes = await dbRun(
        'UPDATE dealer_visit_targets SET so_name = ?, so_emp_code = ?, area = COALESCE(?, area) WHERE dealer_name = ? AND (so_name IS NULL OR so_emp_code LIKE "SO_%")',
        [soName, soEmpCode, area, dealerName]
      );
      if (targetRes.changes > 0) targetsUpdatedCount += targetRes.changes;
    }

    insertedCount++;
  }

  console.log(`Successfully mapped ${insertedCount} dealer-SO records from ${filePath}. Updated ${targetsUpdatedCount} visit target mappings.`);
  return { insertedCount, targetsUpdatedCount };
}

async function main() {
  const filePath = 'upload-files/Dealer - SO Territory Hierarchy Mapping.xlsx';
  const result = await importDealerMappingFile(filePath);

  const mappings = await dbAll('SELECT COUNT(*) as count FROM master_dealer_so_mapping');
  const sos = await dbAll('SELECT COUNT(DISTINCT so_emp_code) as count FROM master_dealer_so_mapping');
  const dealers = await dbAll('SELECT COUNT(*) as count FROM master_dealers');

  console.log('\n==================================================');
  console.log(`- Total Mapped Dealer-SO Records: ${mappings[0].count}`);
  console.log(`- Total Unique Sales Officers:    ${sos[0].count}`);
  console.log(`- Total Master Dealers:           ${dealers[0].count}`);
  console.log('==================================================');
}

main().catch(console.error);
