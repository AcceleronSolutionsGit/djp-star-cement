import XLSX from 'xlsx';
import { dbRun, dbGet } from '../config/database.js';

export async function importVisitTargetsOverride(filePath, batchCode) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  let validRows = 0;
  let invalidRows = 0;
  let errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const customerCode = row['Customer Code'] || row['SAP Code'] || row['SFA Code'];
    
    if (!customerCode) {
      invalidRows++;
      continue;
    }

    const soVisits = parseInt(row['SO Visits']) || 0;
    const asmVisits = parseInt(row['ASM Visits']) || 0;
    const rsmVisits = parseInt(row['RSM Visits']) || 0;
    const zhVisits = parseInt(row['ZH Visits']) || 0;
    const totalVisits = soVisits + asmVisits + rsmVisits + zhVisits;

    try {
      // Find the most recent target row for this customer code
      const targetRow = await dbGet(`SELECT id FROM dealer_visit_targets WHERE sap_code = ? OR sfa_code = ? ORDER BY id DESC LIMIT 1`, [String(customerCode).trim(), String(customerCode).trim()]);
      
      if (targetRow) {
        await dbRun(
          `UPDATE dealer_visit_targets 
           SET so_visits = ?, asm_visits = ?, rsm_visits = ?, zh_visits = ?, total_visits = ?
           WHERE id = ?`,
          [soVisits, asmVisits, rsmVisits, zhVisits, totalVisits, targetRow.id]
        );
        validRows++;
      } else {
        invalidRows++;
        errors.push({ row: i + 2, message: `No generated targets found for customer code ${customerCode}` });
      }
    } catch (e) {
      invalidRows++;
      errors.push({ row: i + 2, message: e.message });
    }
  }

  return { totalRows: rows.length, validRows, invalidRows, errors, warnings: [] };
}
