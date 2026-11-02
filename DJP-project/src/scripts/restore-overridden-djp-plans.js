#!/usr/bin/env node
/**
 * CLI Script to automatically detect and restore overridden DJP plans on the server.
 * 
 * Usage:
 *   node src/scripts/restore-overridden-djp-plans.js
 *   node src/scripts/restore-overridden-djp-plans.js --month=2026-11
 *   node src/scripts/restore-overridden-djp-plans.js --emp=1100178
 *   node src/scripts/restore-overridden-djp-plans.js --force
 */

import { restoreOverriddenPlans, restorePlanDjpVisits } from '../services/planRestoration.service.js';
import { dbAll } from '../config/database.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (const a of args) {
    if (a.startsWith('--month=')) options.periodMonth = a.split('=')[1].trim();
    if (a.startsWith('--cycle=')) options.cycleCode = a.split('=')[1].trim().toUpperCase();
    if (a.startsWith('--emp=')) options.empCode = a.split('=')[1].trim();
    if (a.startsWith('--plan=')) options.planId = parseInt(a.split('=')[1].trim(), 10);
    if (a === '--force') options.forceAll = true;
  }
  return options;
}

async function run() {
  console.log('======================================================================');
  console.log('      STAR CEMENT DJP PLAN RESTORATION & RECOVERY PIPELINE            ');
  console.log('======================================================================\n');

  const options = parseArgs();
  console.log('Options:', options);

  try {
    if (options.planId) {
      console.log(`\nRestoring single plan #${options.planId}...`);
      const res = await restorePlanDjpVisits(options.planId);
      console.log('Result:', res);
    } else {
      console.log('\nScanning for overridden plans across database...');
      const results = await restoreOverriddenPlans(options);
      console.log(`\nScan complete. Total plans examined/restored: ${results.length}`);
      if (results.length > 0) {
        console.table(results);
      } else {
        console.log('✓ No overridden plans found! All plans currently contain valid DJP visits.');
      }
    }

    console.log('\n======================================================================');
    console.log('                      RESTORE OPERATION COMPLETE                      ');
    console.log('======================================================================');
    process.exit(0);
  } catch (err) {
    console.error('Fatal error during plan restoration:', err);
    process.exit(1);
  }
}

run();
