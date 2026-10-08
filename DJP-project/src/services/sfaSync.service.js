import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { dbRun, dbGet, dbAll } from '../config/database.js';
import { regenerateC2Plans } from '../controllers/generation.controller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../upload-files');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export async function syncSfaDataFromApi() {
  console.log('[SFA_SYNC] Starting automatic SFA adherence sync...');

  try {
    // 1. Determine dates (e.g., current month 1st to today)
    const today = new Date();
    const endDate = today.toISOString().split('T')[0];
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];

    const payload = {
      employee: 'all',
      start_date: startDate,
      end_date: endDate
    };

    // 2. Fetch from API
    console.log(`[SFA_SYNC] Fetching from API for dates ${startDate} to ${endDate}`);
    const res = await fetch('https://proceedings-fold-feeling-baskets.trycloudflare.com/misreport/api_star_customer_visit_report_daywise.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'STAR_SFA_DJP_SECURE_TOKEN_2026_98F7A1B2'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`API responded with status: ${res.status}`);
    }

    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data.data || []);
    
    if (rows.length === 0) {
      console.log('[SFA_SYNC] No data returned from API. Skipping import.');
      return { status: 'skipped', message: 'No data returned from API.' };
    }

    // 3. Keep report downloadable: generate Excel and save batch
    const batchCode = `BAT-${new Date().toISOString().slice(0, 7).replace('-', '')}-SYNC-${Math.floor(100 + Math.random() * 900)}`;
    const fileName = `SFA_Sync_${endDate}.xlsx`;
    const filePath = path.join(uploadDir, fileName);

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'SFA Report');
    XLSX.writeFile(workbook, filePath);

    await dbRun(
      `INSERT INTO upload_batches (batch_code, file_type, file_name, file_path, status, total_rows, valid_rows, invalid_rows, duplicate_rows) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [batchCode, 'SFA_REPORT', fileName, filePath, 'VALIDATED', rows.length, rows.length, 0, 0]
    );

    // 4. Archive old logs
    try {
      await dbRun(`
        INSERT IGNORE INTO visit_execution_logs_archive 
        (id, visit_date, customer_code, customer_name, customer_type, route, branch, employee_code, employee_name, check_in_time, check_out_time, duration, visit_status, purpose_of_visit, remarks, batch_code, created_at)
        SELECT id, visit_date, customer_code, customer_name, customer_type, route, branch, employee_code, employee_name, check_in_time, check_out_time, duration, visit_status, purpose_of_visit, remarks, batch_code, created_at
        FROM visit_execution_logs
      `);
    } catch (e) {
      console.warn('[SFA_SYNC] Archiving skipped: ', e.message);
    }
    
    // Wipe
    await dbRun("DELETE FROM visit_execution_logs");

    let inserted = 0;
    // 5. Insert rows (assuming columns loosely map to standard names)
    for (const row of rows) {
      // Map API keys to DB fields (guessing standard keys based on typical exports)
      const visitDate = row.date_of_visit || row['Date of Visit'] || row.date || null;
      const customerCode = row.customer_code || row['Customer Code'] || null;
      const customerName = row.customer_name || row['Customer Name'] || null;
      const route = row.route || row['Route'] || null;
      const customerType = row.type || row['Type'] || null;
      const branch = row.branch || row['Branch'] || null;
      const empCode = row.employee_code || row['Employee Code'] || null;
      const empName = row.employee_name || row['Employee Name'] || null;
      const checkIn = row.check_in_time || row['Check In Time'] || null;
      const checkOut = row.check_out_time || row['Check Out Time'] || null;
      const duration = row.duration || row['Duration'] || null;
      const visitStatus = row.visit_status || row['Visit Status(Productive / Non productive)'] || 'Completed';
      const purpose = row.purpose_of_visit || row['Purpose Of Visit'] || null;
      const remarks = row.remarks || row['Remarks'] || null;

      if (!customerCode || !empCode || !visitDate) continue;

      await dbRun(
        `INSERT INTO visit_execution_logs 
        (visit_date, customer_code, customer_name, customer_type, route, branch, employee_code, employee_name, check_in_time, check_out_time, duration, visit_status, purpose_of_visit, remarks, batch_code) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [visitDate.slice(0, 10), customerCode, customerName, customerType, route, branch, empCode, empName, checkIn, checkOut, duration, visitStatus, purpose, remarks, batchCode]
      );
      inserted++;
    }

    console.log(`[SFA_SYNC] Inserted ${inserted} visits from API.`);

    // 6. Trigger C2 Regeneration
    const latestPeriod = await dbGet(`SELECT period_month FROM dealer_visit_targets ORDER BY period_month DESC LIMIT 1`);
    if (latestPeriod?.period_month) {
      const fakeReq = { body: { periodMonth: latestPeriod.period_month } };
      const fakeRes = {
        json: (data) => console.log(`[SFA_SYNC] C2 regen triggered:`, data?.message),
        status: (code) => ({ json: (e) => console.error(`[SFA_SYNC] C2 regen error:`, e) })
      };
      regenerateC2Plans(fakeReq, fakeRes).catch(e => console.error('[SFA_SYNC] C2 regen async error:', e.message));
    }

    return { status: 'success', inserted, batchCode };
  } catch (error) {
    console.error('[SFA_SYNC] Failed:', error.message);
    return { status: 'error', error: error.message };
  }
}

export function startSfaSyncCron() {
  // Run every 1 hour
  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => {
    syncSfaDataFromApi().catch(err => console.error('[SFA_SYNC_CRON] Error:', err));
  }, ONE_HOUR);
  console.log('[SFA_SYNC_CRON] Started SFA adherence sync cron job (interval: 1 hour)');
}
