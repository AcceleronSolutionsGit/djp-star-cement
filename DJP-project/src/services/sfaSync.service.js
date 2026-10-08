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
    // 1. Determine dates (e.g., current active period month)
    let targetYear = new Date().getFullYear();
    let targetMonth = new Date().getMonth();
    
    const formatYMD = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let endDate = formatYMD(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());

    try {
      const latestPeriodRow = await dbGet(`SELECT period_month FROM dealer_visit_targets ORDER BY period_month DESC LIMIT 1`);
      if (latestPeriodRow && latestPeriodRow.period_month) {
        const [y, m] = latestPeriodRow.period_month.split('-');
        targetYear = parseInt(y, 10);
        targetMonth = parseInt(m, 10) - 1;
        
        // If the active period is a past month, fetch until the last day of that month
        if (targetYear < new Date().getFullYear() || (targetYear === new Date().getFullYear() && targetMonth < new Date().getMonth())) {
          const lastDayObj = new Date(targetYear, targetMonth + 1, 0);
          endDate = formatYMD(lastDayObj.getFullYear(), lastDayObj.getMonth() + 1, lastDayObj.getDate());
        }
      }
    } catch (err) {
      console.warn('[SFA_SYNC] Could not fetch latest period, defaulting to current calendar month:', err.message);
    }

    const startDate = formatYMD(targetYear, targetMonth + 1, 1);
    
    const payload = {
      employee: 'all',
      start_date: startDate,
      end_date: endDate
    };

    // 2. Fetch from API in 7-day chunks to prevent 504 Gateway Timeout on PHP side
    console.log(`[SFA_SYNC] Fetching from API for dates ${startDate} to ${endDate} in chunks`);
    
    const getChunks = (startYMD, endYMD, daysPerChunk) => {
      const chunks = [];
      let current = new Date(startYMD + 'T00:00:00');
      const finalEnd = new Date(endYMD + 'T00:00:00');

      while (current <= finalEnd) {
        let chunkStart = formatYMD(current.getFullYear(), current.getMonth() + 1, current.getDate());
        
        let endOfChunk = new Date(current);
        endOfChunk.setDate(endOfChunk.getDate() + daysPerChunk - 1);
        if (endOfChunk > finalEnd) endOfChunk = new Date(finalEnd);
        
        let chunkEnd = formatYMD(endOfChunk.getFullYear(), endOfChunk.getMonth() + 1, endOfChunk.getDate());
        chunks.push({ start_date: chunkStart, end_date: chunkEnd });
        
        current = new Date(endOfChunk);
        current.setDate(current.getDate() + 1);
      }
      return chunks;
    };

    const dateChunks = getChunks(startDate, endDate, 1); 
    let allRows = [];
    let inserted = 0;
    const batchCode = `BAT-${new Date().toISOString().slice(0, 7).replace('-', '')}-SYNC-${Math.floor(100 + Math.random() * 900)}`;

    // Archive old logs just in case
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

    for (const chunk of dateChunks) {
      console.log(`[SFA_SYNC] Fetching chunk ${chunk.start_date}...`);
      const chunkPayload = { employee: 'all', start_date: chunk.start_date, end_date: chunk.end_date };
      
      try {
        const res = await fetch('http://52.66.31.108/star-one-sfa/misreport/api_star_customer_visit_report_daywise.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'STAR_SFA_DJP_SECURE_TOKEN_2026_98F7A1B2'
          },
          body: JSON.stringify(chunkPayload)
        });

        if (!res.ok) {
          console.error(`[SFA_SYNC] API responded with status: ${res.status} for chunk ${chunk.start_date}`);
          continue; 
        }

        const data = await res.json();
        const rows = Array.isArray(data) ? data : (data.data || []);
        
        if (rows.length > 0) {
          // Format rows for this day
          const formattedRows = rows.map(row => ({
            'Date of Visit': row.visit_date || row.date_of_visit || null,
            'Customer Code': row.dns_customer_code || row.customer_code || null,
            'Customer Name': row.customer_name || null,
            'Route': row.route_name || row.route || null,
            'Type': row.cust_type || row.type || null,
            'Branch': row.branch_name || row.branch || null,
            'Employee Code': row.emp_code || row.employee_code || null,
            'Employee Name': row.emp_name || row.employee_name || null,
            'Check In Time': row.check_in_time || null,
            'Check Out Time': row.check_out_time || null,
            'Duration': row.time_duration || row.duration || null,
            'Visit Status(Productive / Non productive)': row.visit_status || 'Completed',
            'Purpose Of Visit': row.purpose_of_visit || null,
            'Remarks': row.remarks || null
          }));

          allRows = allRows.concat(formattedRows);

          // Insert this day's rows incrementally
          await dbRun('START TRANSACTION');
          try {
            // Delete ONLY this day's data before re-inserting, to prevent wiping the whole month if later days fail
            await dbRun("DELETE FROM visit_execution_logs WHERE visit_date = ?", [chunk.start_date]);
            
            for (const row of formattedRows) {
              let visitDate = row['Date of Visit'];
              if (visitDate && visitDate.length === 8) { 
                visitDate = `${visitDate.slice(0,4)}-${visitDate.slice(4,6)}-${visitDate.slice(6,8)}`;
              } else if (visitDate && visitDate.includes('-') && visitDate.split('-')[0].length === 2) { 
                const [d, m, y] = visitDate.split('-');
                visitDate = `${y}-${m}-${d}`;
              }
              const customerCode = row['Customer Code'];
              const empCode = row['Employee Code'];
              
              if (!customerCode || !empCode || !visitDate) continue;

              await dbRun(
                `INSERT INTO visit_execution_logs 
                (visit_date, customer_code, customer_name, customer_type, route, branch, employee_code, employee_name, check_in_time, check_out_time, duration, visit_status, purpose_of_visit, remarks, batch_code) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [visitDate.slice(0, 10), customerCode, row['Customer Name'], row['Type'], row['Route'], row['Branch'], empCode, row['Employee Name'], row['Check In Time'], row['Check Out Time'], row['Duration'], row['Visit Status(Productive / Non productive)'], row['Purpose Of Visit'], row['Remarks'], batchCode]
              );
              inserted++;
            }
            await dbRun('COMMIT');
            console.log(`[SFA_SYNC] Successfully inserted ${formattedRows.length} visits for ${chunk.start_date}`);
          } catch (e) {
            await dbRun('ROLLBACK');
            console.error(`[SFA_SYNC] DB error on ${chunk.start_date}:`, e.message);
          }
        }
      } catch (err) {
        console.error(`[SFA_SYNC] Network error for chunk ${chunk.start_date}: ${err.message}`);
        continue; 
      }
    }
    
    if (allRows.length === 0) {
      console.log('[SFA_SYNC] No data successfully fetched. Skipping Excel generation.');
      return { status: 'skipped', message: 'No data fetched.' };
    }

    // Generate Excel backup of everything we successfully fetched
    const fileName = `SFA_Sync_${endDate}.xlsx`;
    const filePath = path.join(uploadDir, fileName);
    
    const worksheet = XLSX.utils.json_to_sheet(allRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'SFA Report');
    XLSX.writeFile(workbook, filePath);

    await dbRun(
      `INSERT INTO upload_batches (batch_code, file_type, file_name, file_path, status, total_rows, valid_rows, invalid_rows, duplicate_rows) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [batchCode, 'SFA_REPORT', fileName, filePath, 'VALIDATED', allRows.length, allRows.length, 0, 0]
    );

    console.log(`[SFA_SYNC] Finished sync. Inserted ${inserted} total visits from API.`);

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
