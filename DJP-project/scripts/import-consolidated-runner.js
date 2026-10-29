import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dbRun, dbGet, dbAll } from '../src/config/database.js';
import { importDealerMapping } from '../src/imports/dealer-mapping.importer.js';
import { importSBG } from '../src/imports/sbg.importer.js';
import { importDealerPerformance } from '../src/imports/dealer-performance.importer.js';
import { importSalesHistory } from '../src/imports/sales-history.importer.js';
import { importProspectDealers } from '../src/imports/prospect-dealer.importer.js';
import { importSfaReport } from '../src/imports/sfa-report.importer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const scratchDir = path.join(projectRoot, 'scratch');

if (!fs.existsSync(scratchDir)) {
  fs.mkdirSync(scratchDir, { recursive: true });
}

export async function runConsolidatedImport(consolidatedFilePath) {
  console.log(`\n======================================================`);
  console.log(`STARTING CONSOLIDATED ALL-IN-ONE DATA IMPORT`);
  console.log(`Source File: ${consolidatedFilePath}`);
  console.log(`======================================================\n`);

  if (!fs.existsSync(consolidatedFilePath)) {
    throw new Error(`Consolidated file not found at: ${consolidatedFilePath}`);
  }

  const wb = XLSX.readFile(consolidatedFilePath, { cellDates: true });
  console.log('Available Sheets in Workbook:', wb.SheetNames);

  const importPipeline = [
    {
      domain: 'DEALER_MAPPING',
      preferredSheet: 'Dealer_Mapping',
      handler: importDealerMapping,
      description: 'Step 1: Canonical Dealers, Hierarchy (SO, ASM, RSM, ZH) & Mapping'
    },
    {
      domain: 'SBG',
      preferredSheet: 'SBG_Master',
      handler: importSBG,
      description: 'Step 2: Micro-Market Potential, Territory & SAP Status'
    },
    {
      domain: 'DEALER_PERFORMANCE',
      preferredSheet: 'Dealer_Performance',
      handler: importDealerPerformance,
      description: 'Step 3: Monthly Targets, Prorata Targets & DOA Tiers'
    },
    {
      domain: 'SALES_HISTORY',
      preferredSheet: 'Sales_History',
      handler: importSalesHistory,
      description: 'Step 4: RSAR Sub-Dealer 6-Month Historical Sales Trends'
    },
    {
      domain: 'PROSPECT_DEALERS',
      preferredSheet: 'Prospect_Dealers',
      handler: importProspectDealers,
      description: 'Step 5: Prospective Customer Pool & Expansion Pipeline'
    },
    {
      domain: 'SFA_REPORT',
      preferredSheet: 'SFA_Report',
      handler: importSfaReport,
      description: 'Step 6: SFA Field Visits Execution, Check-in Times & Productive Outcomes'
    }
  ];

  const results = [];

  for (const step of importPipeline) {
    console.log(`\n>>> Executing ${step.description}...`);

    // Find the sheet in the workbook
    const actualSheetName = wb.SheetNames.find(
      s => s.toLowerCase().replace(/[\s_-]+/g, '') === step.preferredSheet.toLowerCase().replace(/[\s_-]+/g, '')
    );

    if (!actualSheetName) {
      console.warn(`[WARNING] Sheet for ${step.domain} not found in workbook. Skipping.`);
      results.push({ domain: step.domain, status: 'SKIPPED', error: 'Sheet not found' });
      continue;
    }

    // Extract this sheet into a clean standalone temporary workbook
    const tempWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(tempWb, wb.Sheets[actualSheetName], actualSheetName);
    const tempFilePath = path.join(scratchDir, `temp_${step.domain}.xlsx`);
    XLSX.writeFile(tempWb, tempFilePath);

    const batchCode = `BAT-${step.domain.slice(0, 4)}-${Date.now().toString().slice(-6)}`;

    // Create batch record
    await dbRun(
      `INSERT INTO upload_batches (batch_code, file_type, file_name, file_path, status, total_rows, valid_rows, invalid_rows, duplicate_rows)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0)`,
      [batchCode, step.domain, path.basename(consolidatedFilePath) + `::${actualSheetName}`, tempFilePath, 'PROCESSING']
    );

    try {
      const res = await step.handler(tempFilePath, batchCode);
      const validRows = res?.validRows ?? res?.matchedCount ?? res?.insertedCount ?? res?.totalVisits ?? res?.count ?? 0;
      const invalidRows = res?.invalidRows ?? res?.unmatched ?? 0;
      const duplicateRows = res?.duplicateRows ?? res?.duplicates ?? 0;
      const totalRows = res?.totalRows ?? (validRows + invalidRows + duplicateRows);

      await dbRun(
        `UPDATE upload_batches SET status = 'VALIDATED', total_rows = ?, valid_rows = ?, invalid_rows = ?, duplicate_rows = ? WHERE batch_code = ?`,
        [totalRows, validRows, invalidRows, duplicateRows, batchCode]
      );

      console.log(`[SUCCESS] ${step.domain}: Processed ${totalRows} rows (${validRows} valid, ${invalidRows} invalid, ${duplicateRows} duplicates). Batch: ${batchCode}`);
      results.push({ domain: step.domain, batchCode, status: 'VALIDATED', totalRows, validRows, invalidRows });
    } catch (err) {
      console.error(`[ERROR] ${step.domain} failed:`, err.message);
      await dbRun(
        `UPDATE upload_batches SET status = 'FAILED', error_summary = ? WHERE batch_code = ?`,
        [err.message, batchCode]
      );
      results.push({ domain: step.domain, batchCode, status: 'FAILED', error: err.message });
    } finally {
      // Clean up temporary slice
      try { fs.unlinkSync(tempFilePath); } catch (_) {}
    }
  }

  console.log(`\n======================================================`);
  console.log(`CONSOLIDATED IMPORT PIPELINE COMPLETE`);
  console.log(`======================================================\n`);
  return results;
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const targetFile = process.argv[2] || path.join(projectRoot, 'Consolidated_Master_Import.xlsx');
  runConsolidatedImport(targetFile)
    .then(summary => {
      console.log('Final Summary Report:');
      console.table(summary);
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal execution error:', err);
      process.exit(1);
    });
}
