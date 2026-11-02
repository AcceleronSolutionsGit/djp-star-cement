#!/usr/bin/env node
/**
 * Standalone CLI Script to enforce active-only DJP data preset.
 * 
 * Usage:
 *   node src/scripts/enforce-active-djp.js
 *   node src/scripts/enforce-active-djp.js --dry-run
 */

import { enforceActiveDjpPreset } from '../services/activeDjpEnforcer.service.js';

const isDryRun = process.argv.includes('--dry-run');

console.log('================================================================');
console.log('  Star Cement PJP/DJP — Active Only Data Preset Enforcer');
console.log('================================================================');

async function main() {
  try {
    const result = await enforceActiveDjpPreset({ dryRun: isDryRun });
    console.log('\nResult Summary:');
    console.log('----------------------------------------------------------------');
    console.log(`  Scanned Plans:              ${result.totalPlansScanned}`);
    console.log(`  Active Plans Retained:      ${result.activePlansRetained}`);
    console.log(`  Inactive/Dummy Plans Purged:${result.inactivePlansPurged}`);
    console.log(`  Orphan Visits Purged:       ${result.orphanVisitsPurged}`);
    console.log(`  Inactive Master Employees:  ${result.inactiveEmployeesDeactivated}`);
    console.log(`  Dummy Codes Removed:        ${result.dummyEmployeesPurgedFromMaster}`);
    console.log(`  Active Plans Healed:        ${result.healedPlansCount}`);
    console.log('----------------------------------------------------------------');
    console.log('✅ Active DJP enforcement completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Active DJP enforcement failed:', err);
    process.exit(1);
  }
}

main();
