import XLSX from 'xlsx';
import { dbRun, dbGet } from '../config/database.js';

function normalizeDate(val) {
  if (!val) return null;
  if (!isNaN(val) && Number(val) > 20000 && Number(val) < 100000) {
    const serial = Number(val);
    const utc_days = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;
    const dateObj = new Date(utc_value * 1000);
    return dateObj.toISOString().split('T')[0];
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    return val.substring(0, 10);
  }
  if (typeof val === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(val)) {
    const parts = val.split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2].substring(0, 4);
    return `${y}-${m}-${d}`;
  }
  if (val instanceof Date && !isNaN(val)) {
    return val.toISOString().split('T')[0];
  }
  return null;
}

export async function importSfaReport(filePath, batchCode = null) {
  console.log(`[SFA_REPORT] Processing SFA Report & Master Lists from: ${filePath}`);

  // Archive previous data before wiping
  console.log(`[SFA_REPORT] Archiving previous SFA execution logs...`);
  try {
    await dbRun(`
      INSERT IGNORE INTO visit_execution_logs_archive 
      (id, visit_date, customer_code, customer_name, customer_type, route, branch, employee_code, employee_name, check_in_time, check_out_time, duration, visit_status, purpose_of_visit, remarks, batch_code, created_at)
      SELECT id, visit_date, customer_code, customer_name, customer_type, route, branch, employee_code, employee_name, check_in_time, check_out_time, duration, visit_status, purpose_of_visit, remarks, batch_code, created_at
      FROM visit_execution_logs
    `);
  } catch (err) {
    console.log(`[SFA_REPORT] Warning: Could not archive logs (maybe archive table doesn't exist yet): ${err.message}`);
  }

  console.log(`[SFA_REPORT] Wiping previous SFA execution logs...`);
  await dbRun("DELETE FROM visit_execution_logs");

  const workbook = XLSX.readFile(filePath);

  let totalVisits = 0;
  let totalEmps = 0;

  // 1. Process Employee list
  if (workbook.SheetNames.includes('Employee list')) {
    const empSheet = workbook.Sheets['Employee list'];
    const empRows = XLSX.utils.sheet_to_json(empSheet);

    for (const row of empRows) {
      const name = row['Name'] ? String(row['Name']).trim() : null;
      const desig = row['Desig'] ? String(row['Desig']).trim() : null;
      const zone = row['ZONE'] ? String(row['ZONE']).trim() : null;
      const region = row['Region'] ? String(row['Region']).trim() : null;

      if (!name) continue;

      const existing = await dbGet('SELECT id FROM master_employees WHERE emp_name = ?', [name]);
      if (!existing) {
        await dbRun(
          'INSERT INTO master_employees (emp_code, emp_name, designation, zone, region) VALUES (?, ?, ?, ?, ?)',
          ['EMP_' + (totalEmps + 1000), name, desig, zone, region]
        );
        totalEmps++;
      }
    }
  }

  // 2. Process SFA Report (Execution Logs)
  if (workbook.SheetNames.includes('SFA Report')) {
    const sfaSheet = workbook.Sheets['SFA Report'];
    const sfaRows = XLSX.utils.sheet_to_json(sfaSheet);

function normalizeTime(val) {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(val.trim())) {
    const parts = val.trim().split(':');
    const hh = parts[0].padStart(2, '0');
    const mm = parts[1].padStart(2, '0');
    const ss = (parts[2] || '00').padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  const num = parseFloat(val);
  if (!isNaN(num) && num >= 0 && num <= 1) {
    const totalSeconds = Math.round(num * 86400);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = String(hours % 24).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return String(val);
}

    for (const row of sfaRows) {
      const visitDate = normalizeDate(row['Date of Visit']);
      const customerCode = row['Customer Code'] ? String(row['Customer Code']).trim() : null;
      const customerName = row['Customer Name'] ? String(row['Customer Name']).trim() : null;
      const route = row['Route'] ? String(row['Route']).trim() : null;
      const customerType = row['Type'] ? String(row['Type']).trim() : null;
      const branch = row['Branch'] ? String(row['Branch']).trim() : null;
      const empCode = row['Employee Code'] ? String(row['Employee Code']).trim() : null;
      const empName = row['Employee Name'] ? String(row['Employee Name']).trim() : null;
      const checkIn = normalizeTime(row['Check In Time']);
      const checkOut = normalizeTime(row['Check Out Time']);
      const duration = row['Duration'] ? String(row['Duration']).trim() : null;
      const visitStatus = row['Visit Status(Productive / Non productive)'] ? String(row['Visit Status(Productive / Non productive)']).trim() : 'Completed';
      const purpose = row['Purpose Of Visit'] ? String(row['Purpose Of Visit']).trim() : null;
      const remarks = row['Remarks'] ? String(row['Remarks']).trim() : null;

      if (!customerCode || !empCode || !visitDate) continue;

      await dbRun(
        `INSERT INTO visit_execution_logs 
        (visit_date, customer_code, customer_name, customer_type, route, branch, employee_code, employee_name, check_in_time, check_out_time, duration, visit_status, purpose_of_visit, remarks, batch_code) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [visitDate, customerCode, customerName, customerType, route, branch, empCode, empName, checkIn, checkOut, duration, visitStatus, purpose, remarks, batchCode]
      );
      totalVisits++;
    }
  }

  // 3. Process Counter Level Strategy if sheet present
  if (workbook.SheetNames.includes('counter_level_startegy_Nov')) {
    const stratSheet = workbook.Sheets['counter_level_startegy_Nov'];
    const stratRows = XLSX.utils.sheet_to_json(stratSheet);

    for (const row of stratRows) {
      const code = row['NON ACTIVE in SAP'] || row['Customer Code'];
      const strategy = row['Unnamed: 14'] || row['COUNTER STRATEGY'];
      const potential = row['752329.5291147941'] || row['COUNTER POTENTIAL IN MT'];

      if (code && strategy) {
        const cleanCode = String(code).trim();
        const cleanStrat = String(strategy).trim();
        const cleanPot = parseFloat(potential) || 0;

        await dbRun(
          'UPDATE master_dealers SET counter_strategy = ?, counter_potential = ? WHERE sap_code = ? OR rssd_code = ? OR sfa_code = ?',
          [cleanStrat, cleanPot, cleanCode, cleanCode, cleanCode]
        );
      }
    }
  }

  console.log(`Successfully imported ${totalEmps} employee records and ${totalVisits} execution log visits.`);
  return { totalEmps, totalVisits };
}
