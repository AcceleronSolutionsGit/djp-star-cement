import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { dbRun, dbGet, dbAll } from '../config/database.js';
import { regenerateC2Plans } from '../controllers/generation.controller.js';
import { reconcileUnplannedVisits } from './unplannedVisits.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../upload-files');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Global live sync state exposed via API
let currentSyncState = {
  isRunning: false,
  targetMonth: null,
  startDate: null,
  endDate: null,
  currentDate: null,
  completedDays: 0,
  totalDays: 0,
  percent: 0,
  totalVisitsFetched: 0,
  unplannedCount: 0,
  unmappedCount: 0,
  message: 'Idle',
  error: null,
  startedAt: null,
  finishedAt: null
};

export function getSfaSyncStatus() {
  return { ...currentSyncState };
}

export async function syncSfaDataFromApi(opts = {}) {
  if (currentSyncState.isRunning) {
    console.log('[SFA_SYNC] Sync already in progress.');
    return { status: 'already_running', ...currentSyncState };
  }

  console.log('[SFA_SYNC] Starting automatic SFA adherence sync...');

  const formatYMD = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const now = new Date();

  // 1. Determine target period month
  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth();

  if (opts.periodMonth && /^\d{4}-\d{2}$/.test(opts.periodMonth)) {
    const [y, m] = opts.periodMonth.split('-');
    targetYear = parseInt(y, 10);
    targetMonth = parseInt(m, 10) - 1;
  } else {
    try {
      const latestPeriodRow = await dbGet(`SELECT period_month FROM dealer_visit_targets ORDER BY period_month DESC LIMIT 1`);
      if (latestPeriodRow && latestPeriodRow.period_month) {
        const [y, m] = latestPeriodRow.period_month.split('-');
        targetYear = parseInt(y, 10);
        targetMonth = parseInt(m, 10) - 1;
      }
    } catch (err) {
      console.warn('[SFA_SYNC] Could not fetch latest period, defaulting to current calendar month:', err.message);
    }
  }

  const targetPeriodMonth = formatYMD(targetYear, targetMonth + 1, 1).slice(0, 7);

  // 2. Determine target End Date:
  // If active period is current month: fetch until T-1 (yesterday)
  // If past/inactive month: fetch until 30th/31st (month end)
  const isCurrentCalendarMonth = (targetYear === now.getFullYear() && targetMonth === now.getMonth());
  let targetEndDate;

  if (isCurrentCalendarMonth) {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    targetEndDate = formatYMD(yesterday.getFullYear(), yesterday.getMonth() + 1, yesterday.getDate());
    const monthStart = formatYMD(targetYear, targetMonth + 1, 1);
    if (targetEndDate < monthStart) targetEndDate = monthStart;
  } else {
    const lastDayObj = new Date(targetYear, targetMonth + 1, 0);
    targetEndDate = formatYMD(lastDayObj.getFullYear(), lastDayObj.getMonth() + 1, lastDayObj.getDate());
  }

  // 3. Incremental resume: Check latest date already present in visit_execution_logs
  let startDate = formatYMD(targetYear, targetMonth + 1, 1);
  try {
    const existingRow = await dbGet(
      `SELECT MAX(visit_date) as max_date, COUNT(*) as cnt 
       FROM visit_execution_logs 
       WHERE visit_date LIKE ?`,
      [`${targetPeriodMonth}%`]
    );

    if (existingRow?.max_date && existingRow.cnt > 0) {
      const lastSyncedDate = String(existingRow.max_date).slice(0, 10);
      if (lastSyncedDate >= targetEndDate) {
        console.log(`[SFA_SYNC] Month ${targetPeriodMonth} is already fully synced through ${lastSyncedDate}. Running reconciliation.`);
        const rec = await reconcileUnplannedVisits({ periodMonth: targetPeriodMonth });
        return {
          status: 'already_up_to_date',
          syncedUntil: lastSyncedDate,
          unplannedCount: rec.unplannedVisitsCount || 0,
          plannedCount: rec.plannedVisitsCount || 0
        };
      }
      // Start fetching from the day after the latest existing date
      const nextDateObj = new Date(lastSyncedDate + 'T00:00:00');
      nextDateObj.setDate(nextDateObj.getDate() + 1);
      startDate = formatYMD(nextDateObj.getFullYear(), nextDateObj.getMonth() + 1, nextDateObj.getDate());
      console.log(`[SFA_SYNC] Resuming fetch from ${startDate} up to ${targetEndDate} (already have data through ${lastSyncedDate})`);
    }
  } catch (e) {
    console.warn('[SFA_SYNC] Error checking existing max date:', e.message);
  }

  if (startDate > targetEndDate) {
    console.log(`[SFA_SYNC] Start date ${startDate} is beyond target end date ${targetEndDate}. Nothing to sync.`);
    await reconcileUnplannedVisits({ periodMonth: targetPeriodMonth });
    return { status: 'already_up_to_date', syncedUntil: targetEndDate };
  }

  // Helper for generating 1-day chunks
  const getChunks = (startYMD, endYMD) => {
    const chunks = [];
    let current = new Date(startYMD + 'T00:00:00');
    const finalEnd = new Date(endYMD + 'T00:00:00');

    while (current <= finalEnd) {
      let dStr = formatYMD(current.getFullYear(), current.getMonth() + 1, current.getDate());
      chunks.push({ start_date: dStr, end_date: dStr });
      current.setDate(current.getDate() + 1);
    }
    return chunks;
  };

  const dateChunks = getChunks(startDate, targetEndDate);

  // Initialize live sync state
  currentSyncState = {
    isRunning: true,
    targetMonth: targetPeriodMonth,
    startDate,
    endDate: targetEndDate,
    currentDate: startDate,
    completedDays: 0,
    totalDays: dateChunks.length,
    percent: 0,
    totalVisitsFetched: 0,
    unplannedCount: 0,
    unmappedCount: 0,
    message: `Fetching daywise visits from ${startDate} to ${targetEndDate} (${dateChunks.length} days)...`,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null
  };

  let allRows = [];
  let inserted = 0;
  const batchCode = `BAT-${new Date().toISOString().slice(0, 7).replace('-', '')}-SYNC-${Math.floor(100 + Math.random() * 900)}`;

  try {
    for (const chunk of dateChunks) {
      currentSyncState.currentDate = chunk.start_date;
      currentSyncState.message = `Fetching day ${currentSyncState.completedDays + 1}/${currentSyncState.totalDays}: ${chunk.start_date}`;
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
          currentSyncState.completedDays += 1;
          continue; 
        }

        const data = await res.json();
        const rows = Array.isArray(data) ? data : (data.data || []);
        
        if (rows.length > 0) {
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

          // Insert this day's rows incrementally in transaction
          await dbRun('START TRANSACTION');
          try {
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

            // IMMEDIATELY reconcile this day's visits so Unplanned & Adherence tabs update LIVE
            try {
              await reconcileUnplannedVisits({
                startDate: chunk.start_date,
                endDate: chunk.end_date,
                periodMonth: targetPeriodMonth
              });
            } catch (recErr) {
              console.warn(`[SFA_SYNC] Live reconcile warning for ${chunk.start_date}:`, recErr.message);
            }

            currentSyncState.totalVisitsFetched += formattedRows.length;
          } catch (e) {
            await dbRun('ROLLBACK');
            console.error(`[SFA_SYNC] DB error on ${chunk.start_date}:`, e.message);
          }
        }
      } catch (err) {
        console.error(`[SFA_SYNC] Network error for chunk ${chunk.start_date}: ${err.message}`);
      }

      currentSyncState.completedDays += 1;
      currentSyncState.percent = Math.min(99, Math.round((currentSyncState.completedDays / currentSyncState.totalDays) * 100));
    }
    
    // Final month-wide reconciliation to verify all counts
    console.log(`[SFA_SYNC] Performing final reconciliation for ${targetPeriodMonth}...`);
    let unplannedCount = 0;
    let plannedCount = 0;
    try {
      const reconciliation = await reconcileUnplannedVisits({
        periodMonth: targetPeriodMonth,
        batchCode
      });
      unplannedCount = reconciliation.unplannedVisitsCount || 0;
      plannedCount = reconciliation.plannedVisitsCount || 0;
      currentSyncState.unplannedCount = unplannedCount;
      currentSyncState.unmappedCount = reconciliation.unmappedVisitsCount || 0;
    } catch (recErr) {
      console.warn('[SFA_SYNC] Final reconciliation warning:', recErr.message);
    }

    // Generate Excel backup if rows were fetched
    if (allRows.length > 0) {
      const fileName = `SFA_Sync_${targetEndDate}.xlsx`;
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
    }

    // Trigger C2 Regeneration in background
    try {
      const fakeReq = { body: { periodMonth: targetPeriodMonth } };
      const fakeRes = {
        json: (data) => console.log(`[SFA_SYNC] C2 regen triggered:`, data?.message),
        status: () => ({ json: (e) => console.error(`[SFA_SYNC] C2 regen error:`, e) })
      };
      regenerateC2Plans(fakeReq, fakeRes).catch(e => console.error('[SFA_SYNC] C2 regen async error:', e.message));
    } catch (_) {}

    currentSyncState.isRunning = false;
    currentSyncState.percent = 100;
    currentSyncState.finishedAt = new Date().toISOString();
    currentSyncState.message = `Sync complete! Synced through ${targetEndDate}.`;

    console.log(`[SFA_SYNC] Finished sync successfully through ${targetEndDate}. Inserted ${inserted} visits.`);

    return {
      status: 'success',
      inserted,
      batchCode,
      syncedUntil: targetEndDate,
      unplannedCount,
      plannedCount
    };
  } catch (error) {
    currentSyncState.isRunning = false;
    currentSyncState.error = error.message;
    currentSyncState.message = `Failed: ${error.message}`;
    console.error('[SFA_SYNC] Failed:', error.message);
    return { status: 'error', error: error.message };
  }
}

export function startSfaSyncCron() {
  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => {
    syncSfaDataFromApi().catch(err => console.error('[SFA_SYNC_CRON] Error:', err));
  }, ONE_HOUR);
  console.log('[SFA_SYNC_CRON] Started SFA adherence sync cron job (interval: 1 hour)');
}
