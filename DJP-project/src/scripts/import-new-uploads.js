/**
 * Batch Importer for the 5 Production Excel Uploads in "New Upload/"
 *
 * Usage:
 *   node src/scripts/import-new-uploads.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { importProspectDealers } from '../imports/prospect-dealer.importer.js';
import { importSalesHistory } from '../imports/sales-history.importer.js';
import { importSBG } from '../imports/sbg.importer.js';
import { importDealerPerformance } from '../imports/dealer-performance.importer.js';
import { healAllMissingZonalHeads } from '../services/zonalHead.service.js';
import { updateMasterDealersFromCoordinates } from '../services/customerCoordinates.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../New Upload');

async function runBatchImport() {
  console.log('========================================================');
  console.log('  STARTING BATCH IMPORT FOR NEW EXCEL UPLOADS');
  console.log('========================================================\n');

  if (!fs.existsSync(uploadDir)) {
    console.error(`❌ Upload directory not found: ${uploadDir}`);
    process.exit(1);
  }

  const batchCode = `PROD-BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

  // 1. Dealer / SO / ASM / RSM Tagging
  const taggingFile = path.join(uploadDir, 'SO ASM TAGGING_NE - AS ON 06-10-2026.xlsx');
  if (fs.existsSync(taggingFile)) {
    console.log('[1/5] Importing Dealer / SO / ASM / RSM Tagging...');
    const res = await importDealerMapping(taggingFile, batchCode);
    console.log(`  ✓ Dealers created: ${res.dealersCreated}, updated: ${res.dealersUpdated}, mappings: ${res.mappingsCreated + res.mappingsUpdated}`);
  } else {
    console.warn('  ⚠ Tagging file not found, skipping');
  }

  // 2. Prospective Dealers
  const prospectFile = path.join(uploadDir, 'prospect cust.xlsx');
  if (fs.existsSync(prospectFile)) {
    console.log('\n[2/5] Importing Prospective Dealers...');
    const res = await importProspectDealers(prospectFile, batchCode);
    console.log(`  ✓ Prospects processed: ${res.validRows} valid`);
  } else {
    console.warn('  ⚠ Prospect file not found, skipping');
  }

  // 3. RSAR Sales History
  const rsarFile = path.join(uploadDir, 'RSAR_SALE_merged.xlsx');
  if (fs.existsSync(rsarFile)) {
    console.log('\n[3/5] Importing RSAR Sub-Dealer Sales History...');
    const res = await importSalesHistory(rsarFile, batchCode);
    console.log(`  ✓ RSAR records processed: ${res.validRows || res.totalRows || 0}`);
  } else {
    console.warn('  ⚠ RSAR file not found, skipping');
  }

  // 4. SBG Master Universe & Counter Potential
  const sbgFile = path.join(uploadDir, 'SBG_merged.xlsx');
  if (fs.existsSync(sbgFile)) {
    console.log('\n[4/5] Importing SBG Master Universe & Potentials...');
    const res = await importSBG(sbgFile, batchCode);
    console.log(`  ✓ SBG records processed: ${res.validRows || res.totalRows || 0}`);
  } else {
    console.warn('  ⚠ SBG file not found, skipping');
  }

  // 5. Dealer Performance Sales History
  const dpFile = path.join(uploadDir, 'DEALER PERFORMANCE -PINTU - after adding Avg last month.xlsx');
  if (fs.existsSync(dpFile)) {
    console.log('\n[5/5] Importing Dealer Performance History...');
    const res = await importDealerPerformance(dpFile, batchCode);
    console.log(`  ✓ Dealer performance processed: ${res.validRows || res.totalRows || 0}`);
  } else {
    console.warn('  ⚠ Dealer performance file not found, skipping');
  }

  // 6. Healing Hierarchy and Coordinates
  console.log('\n[Post-Import] Healing Zonal Heads and Propagating Coordinates...');
  const zhHeal = await healAllMissingZonalHeads();
  console.log(`  ✓ Zonal Heads healed: ${zhHeal.dealersHealed} dealers, ${zhHeal.mappingsHealed} mappings, ${zhHeal.targetsHealed} targets`);

  const coordProp = await updateMasterDealersFromCoordinates();
  console.log(`  ✓ Coordinates & Dealer Types propagated: ${coordProp.affectedRows} dealers`);

  console.log('\n========================================================');
  console.log('  BATCH IMPORT COMPLETED SUCCESSFULLY');
  console.log('========================================================\n');
}

runBatchImport().catch(err => {
  console.error('\n❌ Fatal error in batch import:', err);
  process.exit(1);
});

