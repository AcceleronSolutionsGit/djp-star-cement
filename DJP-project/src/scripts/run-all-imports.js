import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { importProspectDealers } from '../imports/prospect-dealer.importer.js';
import { importSalesHistory } from '../imports/sales-history.importer.js';
import { importSfaReport } from '../imports/sfa-report.importer.js';
import { importPjpTradeFile } from '../imports/pjp-trade.importer.js';
import { dbAll } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runAllImports() {
  console.log('===========================================================');
  console.log('Starting Master Import Pipeline for Star Cement PJP / DJP');
  console.log('===========================================================');

  const uploadDir = path.resolve(__dirname, '../../upload-files');

  try {
    // 1. Dealer mapping & territory hierarchy
    const mappingPath = path.join(uploadDir, 'Dealer - SO Territory Hierarchy Mapping.xlsx');
    const pjpPath = path.join(uploadDir, 'PJP Process -Trade.xlsx');
    if (fs.existsSync(mappingPath)) {
      await importDealerMapping(mappingPath);
    } else {
      await importDealerMapping(pjpPath);
    }

    // 2. Canonical Visit Targets (from full-generated-visit-file.xlsx or PJP Process -Trade.xlsx)
    const genVisitPath = path.join(uploadDir, 'full-generated-visit-file.xlsx');
    await importPjpTradeFile(genVisitPath, '2026-07', 'C1');

    // 3. Prospective dealers
    const prospectPath = path.join(uploadDir, 'Prospect_Dealer_List-Jul_2026.xlsx');
    await importProspectDealers(prospectPath);

    // 4. Sales history - NE & ROE
    const salesNePath = path.join(uploadDir, 'RSAR SALE- NE-APRIL-24 TO JUNE-26.xlsx');
    await importSalesHistory(salesNePath);

    const salesRoePath = path.join(uploadDir, 'RSAR SALE- ROE-APR-24 TO JUN-26.xlsx');
    await importSalesHistory(salesRoePath);

    // 5. SFA execution logs & employees
    const sfaPath = path.join(uploadDir, 'Trade DJP Zone wise - 28-06-2026.xlsx');
    await importSfaReport(sfaPath);

    console.log('-----------------------------------------------------------');
    console.log('ALL IMPORTS COMPLETED SUCCESSFULLY!');
    
    const dealersCount = await dbAll('SELECT COUNT(*) as count FROM master_dealers');
    const mappingCount = await dbAll('SELECT COUNT(*) as count FROM master_dealer_so_mapping');
    const targetsCount = await dbAll('SELECT COUNT(*) as count FROM dealer_visit_targets');
    const salesCount = await dbAll('SELECT COUNT(*) as count FROM sales_history');
    const sfaCount = await dbAll('SELECT COUNT(*) as count FROM visit_execution_logs');

    console.log(`- Master Dealers Loaded: ${dealersCount[0].count}`);
    console.log(`- Dealer-SO Mappings: ${mappingCount[0].count}`);
    console.log(`- Dealer Visit Targets Loaded: ${targetsCount[0].count}`);
    console.log(`- Sales History Records: ${salesCount[0].count}`);
    console.log(`- Visit Execution Logs: ${sfaCount[0].count}`);
    console.log('===========================================================');
    process.exit(0);
  } catch (err) {
    console.error('Fatal error during import pipeline:', err);
    process.exit(1);
  }
}

runAllImports();
