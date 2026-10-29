/**
 * Consolidated Database Migration Runner
 *
 * Runs all database schema migrations, table creations, column alters,
 * rule seedings, and data healing for production deployment.
 *
 * Usage:
 *   node src/scripts/run-all-migrations.js
 *   npm run migrate-all
 */

import { runCoordinateMigrations } from './migrate-customer-coordinates.js';
import { runEmployeeMasterMigration } from './migrate-employee-master.js';
import { runZonalHeadMigration } from './migrate-zonal-heads.js';
import { runPlanEnhancementsMigration } from './migrate-plan-enhancements.js';
import { healAllMissingZonalHeads } from '../services/zonalHead.service.js';
import { syncEmployeeMasterFromApi } from '../services/employeeMaster.service.js';
import { syncCustomerCoordinatesFromApi, updateMasterDealersFromCoordinates } from '../services/customerCoordinates.service.js';
import { pool } from '../config/database.js';

async function runAllMigrations() {
  console.log('====================================================');
  console.log('  STARTING CONSOLIDATED DATABASE MIGRATION RUNNER');
  console.log('====================================================\n');

  try {
    // Increase session lock wait timeout for migration batch
    try {
      await pool.query('SET SESSION innodb_lock_wait_timeout = 120');
    } catch (e) { /* ignore */ }

    // 1. Customer Coordinates Schema & Columns
    console.log('[Step 1/6] Running Customer Coordinates Schema Migrations...');
    await runCoordinateMigrations();

    // 2. Employee Master Schema
    console.log('\n[Step 2/6] Running Employee Master Schema Migrations...');
    await runEmployeeMasterMigration();

    // 3. Zonal Head & Zone Hierarchy Mapping Schema
    console.log('\n[Step 3/6] Running Zonal Head Hierarchy Schema Migrations...');
    await runZonalHeadMigration();

    // 4. Plan Enhancements Schema (Edit Windows, Backdated Tracking, Dealer Types)
    console.log('\n[Step 4/6] Running Plan Enhancements Schema Migrations...');
    await runPlanEnhancementsMigration();

    // 5. Sync API Data Caches (Coordinates & Employees) if not already populated
    console.log('\n[Step 5/6] Verifying and Syncing API Reference Caches...');
    await syncEmployeeMasterFromApi({ force: false });
    await syncCustomerCoordinatesFromApi({ force: false });

    // 6. Healing and Cross-Table Denormalization
    console.log('\n[Step 6/6] Healing Missing Zonal Heads and Propagating Coordinates...');
    const zhHealing = await healAllMissingZonalHeads();
    console.log(`  ✓ Zonal Heads healed: ${zhHealing.dealersHealed} dealers, ${zhHealing.mappingsHealed} mappings, ${zhHealing.targetsHealed} targets`);

    const coordProp = await updateMasterDealersFromCoordinates();
    console.log(`  ✓ Coordinates & counter types propagated: ${coordProp.affectedRows} dealers updated`);

    console.log('\n====================================================');
    console.log('  ALL DATABASE MIGRATIONS COMPLETED SUCCESSFULLY');
    console.log('====================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Fatal error running database migrations:', err);
    process.exit(1);
  }
}

runAllMigrations();

