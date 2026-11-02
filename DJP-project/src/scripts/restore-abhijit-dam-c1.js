#!/usr/bin/env node
/**
 * Standalone migration script to restore Abhijit Dam's ASM C1 plan in the database.
 * 
 * Usage:
 *   node src/scripts/restore-abhijit-dam-c1.js
 *   npm run restore:dam
 */

import { restoreAbhijitDamC1Plan } from '../services/restoreAbhijitDamPlan.service.js';

async function main() {
  console.log('======================================================================');
  console.log('    MIGRATION: RESTORE ABHIJIT DAM (ASM) C1 DJP PLAN IN DATABASE      ');
  console.log('======================================================================\n');

  try {
    const result = await restoreAbhijitDamC1Plan();
    console.log('\nMigration Result:');
    console.table([result]);
    console.log('\n✓ Abhijit Dam ASM C1 plan successfully verified & restored in the database!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

main();
