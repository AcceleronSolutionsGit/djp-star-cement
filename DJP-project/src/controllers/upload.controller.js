import path from 'path';
import fs from 'fs';
import multer from 'multer';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { importProspectDealers } from '../imports/prospect-dealer.importer.js';
import { importSalesHistory } from '../imports/sales-history.importer.js';
import { importSfaReport } from '../imports/sfa-report.importer.js';
import { importPjpTradeFile } from '../imports/pjp-trade.importer.js';
import { importSBG } from '../imports/sbg.importer.js';
import { importDealerPerformance } from '../imports/dealer-performance.importer.js';
import { dbRun, dbAll, dbGet } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../upload-files');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'file-' + uniqueSuffix + ext);
  }
});

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel (.xlsx, .xls) and CSV files are allowed.'));
    }
  }
});

/**
 * Determine the final batch status from importer results.
 */
function determineBatchStatus(totalRows, validRows, invalidRows) {
  if (validRows === 0 && totalRows === 0) return 'FAILED';
  if (validRows === 0) return 'FAILED';
  if (invalidRows > 0 && validRows > 0) return 'PARTIAL';
  return 'VALIDATED';
}

/**
 * Extract structured counts from the various importer return types.
 */
function extractCounts(result) {
  if (typeof result === 'number') {
    return { validRows: result, invalidRows: 0, duplicateRows: 0, warnings: [], errors: [], totalRows: result };
  }
  
  const validRows = result?.validRows ?? result?.matchedCount ?? result?.insertedCount ?? result?.validTargetsCount ?? result?.totalVisits ?? result?.rowsRead ?? result?.count ?? 0;
  const invalidRows = result?.invalidRows ?? result?.unmatched ?? 0;
  const duplicateRows = result?.duplicateRows ?? result?.duplicates ?? result?.skippedCount ?? 0;
  const warnings = result?.warnings ?? [];
  const errors = result?.errors ?? [];
  const totalRows = result?.totalRows ?? (validRows + invalidRows + duplicateRows);
  
  return {
    validRows,
    invalidRows,
    duplicateRows,
    warnings,
    errors,
    totalRows
  };
}

/**
 * Content-based auto-detection of Excel schemas by inspecting headers in the workbook.
 */
export function detectUploadTypeFromWorkbook(filePath) {
  try {
    const wb = XLSX.readFile(filePath, { cellDates: true, sheetRows: 25 });
    if (!wb.SheetNames || wb.SheetNames.length === 0) return null;
    
    for (const sName of wb.SheetNames) {
      const sheet = wb.Sheets[sName];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      if (!rawRows || rawRows.length === 0) continue;

      for (let i = 0; i < Math.min(15, rawRows.length); i++) {
        const row = rawRows[i];
        if (!row || !Array.isArray(row)) continue;
        const norm = row.map(c => String(c || '').trim().toLowerCase().replace(/[\r\n]+/g, ' ').replace(/[_\-]+/g, ' '));
        
        // 1. Prospect Dealers
        if (norm.some(h => h.includes('prospective dealer') || h.includes('prospect dealer') || h.includes('prospect name'))) {
          return 'PROSPECT_DEALERS';
        }

        // 2. Sales History (RSAR / ERP)
        if (norm.some(h => h.includes('sub dealer') || h.includes('linked dealer') || h.includes('rssd') || h.includes('previous sales') || h.includes('previous month'))) {
          return 'SALES_HISTORY';
        }

        // 3. Dealer Performance
        if (norm.some(h => h.includes('prev year') || h.includes('prorata') || h.includes('targeted dealer') || (norm.some(x => x.includes('tgt') || x.includes('target')) && norm.some(x => x.includes('sale') || x.includes('sales'))) || (norm.some(x => x.includes('jan')) && norm.some(x => x.includes('jun')) && norm.some(x => x.includes('26'))))) {
          return 'DEALER_PERFORMANCE';
        }

        // 4. SBG Master
        if (
          norm.some(h => h.includes('counter potential average') || h.includes('universe type') || h.includes('status in sap') || h.includes('white space') || h.includes('dealer start date')) ||
          (norm.some(h => h.includes('potential')) && norm.some(h => h.includes('current sales')) && norm.some(h => h === 'status'))
        ) {
          return 'SBG';
        }

        // 5. Dealer Mapping
        if (norm.some(h => h.includes('so/se name') || h.includes('so name') || h.includes('zonal head') || h.includes('cust type')) &&
            norm.some(h => h.includes('dealer name') || h.includes('customer name') || h.includes('customer code'))) {
          return 'DEALER_MAPPING';
        }
      }
    }
  } catch (err) {
    console.warn('Content-based type detection warning:', err.message);
  }
  return null;
}

/**
 * Handle Excel upload and processing from browser form.
 */
export async function uploadFile(req, res) {
  const batchCode = `BAT-${new Date().toISOString().slice(0, 7).replace('-', '')}-${Math.floor(100 + Math.random() * 900)}`;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const originalName = req.file.originalname;
    const savedFilePath = req.file.path;
    let uploadType = (req.body.uploadType || req.query.uploadType || '').trim().toUpperCase();

    // 1. Content-based schema inspection (works regardless of file name)
    const detectedFromContent = detectUploadTypeFromWorkbook(savedFilePath);
    if (!uploadType && detectedFromContent) {
      uploadType = detectedFromContent;
    }

    // 2. Fallback: auto-detect from original filename if not provided
    if (!uploadType) {
      const fn = originalName.toLowerCase();
      if (fn.includes('sbg')) uploadType = 'SBG';
      else if (fn.includes('performance')) uploadType = 'DEALER_PERFORMANCE';
      else if (fn.includes('mapping') || fn.includes('hierarchy') || fn.includes('dealer_map')) uploadType = 'DEALER_MAPPING';
      else if (fn.includes('prospect')) uploadType = 'PROSPECT_DEALERS';
      else if (fn.includes('rsar') || fn.includes('sale') || fn.includes('history')) uploadType = 'SALES_HISTORY';
      else if (fn.includes('visit') || fn.includes('pjp') || fn.includes('trade')) uploadType = 'PJP_TRADE';
      else if (fn.includes('sfa')) uploadType = 'SFA_REPORT';
    }

    if (!uploadType) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        error: 'uploadType could not be identified. Please select the data type dropdown before uploading.',
        hint: 'Valid types: SBG, DEALER_PERFORMANCE, DEALER_MAPPING, SALES_HISTORY, PROSPECT_DEALERS, SFA_REPORT, PJP_TRADE'
      });
    }

    const validTypes = ['DEALER_MAPPING', 'SALES_HISTORY', 'PROSPECT_DEALERS', 'SBG', 'DEALER_PERFORMANCE', 'RSAR_SALES', 'SFA_REPORT', 'PJP_TRADE'];
    if (!validTypes.includes(uploadType)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        error: `Unknown upload type: ${uploadType}. Valid types are: ${validTypes.join(', ')}`
      });
    }

    const periodMonth = req.body.periodMonth || req.query.periodMonth || null;

    if (uploadType === 'PJP_TRADE') {
      if (!periodMonth) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Period Month is required for PJP_TRADE uploads. Select the PJP reporting month before uploading.' });
      }
      if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Invalid periodMonth format. Expected YYYY-MM.' });
      }
    }

    // Save batch record as PROCESSING
    await dbRun(
      `INSERT INTO upload_batches (batch_code, file_type, file_name, file_path, period_month, status, total_rows, valid_rows, invalid_rows, duplicate_rows) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [batchCode, uploadType, originalName, savedFilePath, periodMonth, 'PROCESSING', 0, 0, 0, 0]
    );

    let result = null;

    const executeImport = async (type) => {
      if (type === 'DEALER_MAPPING') {
        return await importDealerMapping(savedFilePath, batchCode);
      } else if (type === 'PROSPECT_DEALERS') {
        return await importProspectDealers(savedFilePath, batchCode);
      } else if (type === 'SALES_HISTORY' || type === 'RSAR_SALES') {
        return await importSalesHistory(savedFilePath, batchCode);
      } else if (type === 'SBG') {
        return await importSBG(savedFilePath, batchCode);
      } else if (type === 'DEALER_PERFORMANCE') {
        return await importDealerPerformance(savedFilePath, batchCode);
      } else if (type === 'PJP_TRADE') {
        const uploadCycle = req.body.cycleCode || 'C1';
        return await importPjpTradeFile(savedFilePath, periodMonth, uploadCycle, batchCode);
      } else if (type === 'SFA_REPORT') {
        return await importSfaReport(savedFilePath, batchCode);
      }
      throw new Error(`Unknown type: ${type}`);
    };

    try {
      result = await executeImport(uploadType);
    } catch (primaryErr) {
      // Auto-recovery: if primary type failed and content detection found an alternate matching schema
      if (detectedFromContent && detectedFromContent !== uploadType) {
        console.log(`[Upload Auto-Recovery] Primary type ${uploadType} failed. Trying detected schema ${detectedFromContent}...`);
        uploadType = detectedFromContent;
        await dbRun('UPDATE upload_batches SET file_type = ? WHERE batch_code = ?', [uploadType, batchCode]);
        result = await executeImport(uploadType);
      } else {
        throw primaryErr;
      }
    }

    const counts = extractCounts(result);
    const batchStatus = determineBatchStatus(counts.totalRows, counts.validRows, counts.invalidRows);

    const errorSummary = counts.errors.length > 0
      ? counts.errors.slice(0, 20).map(e => `Row ${e.row}: ${e.errors?.join('; ') || e.message || JSON.stringify(e)}`).join('\n')
      : null;
    const warningSummary = counts.warnings.length > 0
      ? counts.warnings.slice(0, 20).join('\n')
      : null;

    // Update batch status with real counts
    await dbRun(
      `UPDATE upload_batches SET 
       status = ?, total_rows = ?, valid_rows = ?, invalid_rows = ?, duplicate_rows = ?,
       error_summary = ?, warning_summary = ?
       WHERE batch_code = ?`,
      [batchStatus, counts.totalRows, counts.validRows, counts.invalidRows, counts.duplicateRows,
       errorSummary, warningSummary, batchCode]
    );

    if (batchStatus === 'FAILED') {
      return res.status(422).json({
        error: `File processing failed — 0 valid rows. Check the file format matches the ${uploadType} template.`,
        batchCode,
        fileName: originalName,
        uploadType,
        batchStatus,
        counts,
        errors: counts.errors.slice(0, 10),
        warnings: counts.warnings.slice(0, 10)
      });
    }

    // Include monthsFound in response for SALES_HISTORY
    const extraInfo = {};
    if (uploadType === 'SALES_HISTORY' && result?.monthsFound) {
      extraInfo.monthsFound = result.monthsFound;
    }

    // ── SFA_REPORT Post-Upload: auto-trigger C2 regeneration ──────────────────
    // When SFA feedback is uploaded, C2 plans are regenerated using actual
    // adherence data. This runs asynchronously so the upload response is fast.
    let sfaFeedbackTriggered = false;
    if (uploadType === 'SFA_REPORT' && batchStatus !== 'FAILED') {
      // Determine plan period from existing C1 plans or latest dealer_visit_targets
      const latestPeriod = await dbGet(
        `SELECT period_month FROM dealer_visit_targets ORDER BY period_month DESC LIMIT 1`
      );
      if (latestPeriod?.period_month) {
        const periodForRegen = latestPeriod.period_month;
        sfaFeedbackTriggered = true;
        extraInfo.sfaFeedbackTriggered = true;
        extraInfo.c2RegenerationPeriod  = periodForRegen;

        // Async C2 regeneration — don't await so upload response is immediate
        import('../controllers/generation.controller.js').then(({ regenerateC2Plans }) => {
          const fakeReq = { body: { periodMonth: periodForRegen } };
          const fakeRes = {
            json: (data) => console.log(`[SFA_UPLOAD] C2 regen triggered for ${periodForRegen}:`, data?.message),
            status: (code) => ({ json: (e) => console.error(`[SFA_UPLOAD] C2 regen error (${code}):`, e) })
          };
          regenerateC2Plans(fakeReq, fakeRes).catch(e => console.error('[SFA_UPLOAD] C2 regen async error:', e.message));
        }).catch(e => console.error('[SFA_UPLOAD] Failed to import generation controller:', e.message));
      }
    }

    res.json({
      message: batchStatus === 'PARTIAL'
        ? `File partially ingested. ${counts.validRows} rows valid, ${counts.invalidRows} rows invalid.${
            sfaFeedbackTriggered ? ' C2 plans are being regenerated based on SFA adherence.' : ''
          }`
        : `File ingested successfully.${
            sfaFeedbackTriggered ? ' C2 plans are being regenerated based on SFA adherence data.' : ''
          }`,
      batchCode,
      fileName: originalName,
      uploadType,
      batchStatus,
      rowsProcessed: counts.validRows,
      counts,
      warnings: counts.warnings.slice(0, 10),
      errors: counts.errors.slice(0, 10),
      ...extraInfo
    });
  } catch (error) {
    console.error('[uploadFile] Error:', error);
    // Mark batch as failed
    try {
      await dbRun('UPDATE upload_batches SET status = ?, error_summary = ? WHERE batch_code = ?', [
        'FAILED', error.message, batchCode
      ]);
    } catch (_) { /* ignore */ }
    res.status(500).json({ error: error.message || 'File processing failed' });
  }
}

/**
 * Legacy API for programmatically processing file by path.
 */
export async function processUpload(req, res) {
  try {
    const { uploadType, filePath } = req.body;

    if (!filePath || !uploadType) {
      return res.status(400).json({ error: 'filePath and uploadType are required' });
    }

    const validTypes = ['DEALER_MAPPING', 'SALES_HISTORY', 'PROSPECT_DEALERS', 'SBG', 'DEALER_PERFORMANCE', 'RSAR_SALES', 'SFA_REPORT', 'PJP_TRADE'];
    if (!validTypes.includes(uploadType)) {
      return res.status(400).json({ error: `Unknown upload type: ${uploadType}` });
    }

    const batchCode = `BAT-${Date.now()}`;
    await dbRun(
      'INSERT INTO upload_batches (batch_code, file_type, file_name, file_path, status) VALUES (?, ?, ?, ?, ?)',
      [batchCode, uploadType, path.basename(filePath), filePath, 'PROCESSING']
    );

    let result = null;

    if (uploadType === 'DEALER_MAPPING') {
      result = await importDealerMapping(filePath, batchCode);
    } else if (uploadType === 'PJP_TRADE') {
      const uploadPeriod = req.body.periodMonth;
      const uploadCycle = req.body.cycleCode || 'C1';
      if (!uploadPeriod) return res.status(400).json({ error: 'periodMonth required for PJP_TRADE' });
      result = await importPjpTradeFile(filePath, uploadPeriod, uploadCycle, batchCode);
    } else if (uploadType === 'PROSPECT_DEALERS') {
      result = await importProspectDealers(filePath, batchCode);
    } else if (uploadType === 'SALES_HISTORY' || uploadType === 'RSAR_SALES') {
      result = await importSalesHistory(filePath, batchCode);
    } else if (uploadType === 'SBG') {
      result = await importSBG(filePath, batchCode);
    } else if (uploadType === 'DEALER_PERFORMANCE') {
      result = await importDealerPerformance(filePath, batchCode);
    } else if (uploadType === 'SFA_REPORT') {
      result = await importSfaReport(filePath, batchCode);
    }

    const counts = extractCounts(result);
    const batchStatus = determineBatchStatus(counts.totalRows, counts.validRows, counts.invalidRows);

    await dbRun('UPDATE upload_batches SET status = ?, total_rows = ?, valid_rows = ?, invalid_rows = ?, duplicate_rows = ? WHERE batch_code = ?', [
      batchStatus, counts.totalRows, counts.validRows, counts.invalidRows, counts.duplicateRows, batchCode
    ]);

    res.json({ message: 'Upload processed', batchCode, batchStatus, counts, result });
  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get ingestion history batch logs.
 */
export async function getUploadBatches(req, res) {
  try {
    const batches = await dbAll('SELECT * FROM upload_batches ORDER BY uploaded_at DESC LIMIT 100');
    res.json({ batches });
  } catch (err) {
    console.error('Error fetching upload batches:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Delete a specific upload batch log (and its associated data).
 */
export async function deleteUploadBatch(req, res) {
  try {
    const { batchCode } = req.params;
    if (!batchCode) {
      return res.status(400).json({ error: 'Batch code is required' });
    }

    const batch = await dbGet('SELECT file_type FROM upload_batches WHERE batch_code = ?', [batchCode]);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const fileType = batch.file_type;

    if (fileType === 'DEALER_MAPPING') {
      await dbRun('DELETE FROM master_dealer_so_mapping WHERE batch_code = ?', [batchCode]);
      await dbRun("DELETE FROM master_dealers WHERE batch_code = ? AND dealer_type != 'PROSPECTIVE'", [batchCode]);
    } else if (fileType === 'PROSPECT_DEALERS') {
      await dbRun('DELETE FROM master_dealer_so_mapping WHERE batch_code = ?', [batchCode]);
      await dbRun("DELETE FROM master_dealers WHERE batch_code = ? AND (dealer_type = 'PROSPECTIVE' OR counter_strategy = 'PROSPECT')", [batchCode]);
    } else if (fileType === 'PJP_TRADE') {
      await dbRun('DELETE FROM dealer_visit_targets WHERE batch_code = ?', [batchCode]);
    } else if (fileType === 'SALES_HISTORY') {
      await dbRun('DELETE FROM sales_history WHERE batch_code = ?', [batchCode]);
    } else if (fileType === 'SFA_REPORT') {
      await dbRun('DELETE FROM visit_execution_logs WHERE batch_code = ?', [batchCode]);
    }

    await dbRun('DELETE FROM upload_batches WHERE batch_code = ?', [batchCode]);
    res.json({ success: true, message: `Batch ${batchCode} data purged and removed from logs.` });
  } catch (err) {
    console.error('Error deleting batch log:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * List all available template Excel files.
 */
export async function listTemplates(req, res) {
  try {
    const templatesDir = path.resolve(__dirname, '../../templates');
    if (!fs.existsSync(templatesDir)) {
      return res.json({ templates: [] });
    }
    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.csv'));
    res.json({
      templates: files.map(f => ({
        fileName: f,
        fileType: f.endsWith('.csv') ? 'CSV' : 'EXCEL',
        downloadUrl: `/api/templates/${encodeURIComponent(f)}`
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Download a standard template Excel file.
 */
export async function downloadTemplate(req, res) {
  try {
    const { name } = req.params;
    const templatesDir = path.resolve(__dirname, '../../templates');
    const safeName = path.basename(name);
    const filePath = path.join(templatesDir, safeName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Template not found: ${safeName}` });
    }

    res.download(filePath, safeName);
  } catch (err) {
    console.error('Error downloading template:', err);
    res.status(500).json({ error: err.message });
  }
}

