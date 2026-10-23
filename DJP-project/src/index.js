import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.routes.js';
import { dbAll, dbRun } from './config/database.js';
import { startSfaSyncCron } from './services/sfaSync.service.js';

dotenv.config();

/**
 * Run idempotent DB migrations at startup.
 * Each migration checks before applying — safe to run multiple times.
 */
async function runStartupMigrations() {
  try {
    // Migration 1: add cycle_code to sales_plans (Phase 1 dual-cycle support)
    const cols = await dbAll("SHOW COLUMNS FROM sales_plans");
    const hasCycleCode = cols.some(c => c.Field === 'cycle_code');
    if (!hasCycleCode) {
      await dbRun("ALTER TABLE sales_plans ADD COLUMN cycle_code VARCHAR(5) NOT NULL DEFAULT 'C1'");
      console.log('[Migration] ✓ Added cycle_code to sales_plans');
    }
  } catch (err) {
    console.warn('[Migration] Warning during startup migration (sales_plans):', err.message);
  }

  try {
    // Migration 2: ensure matching_audit table exists
    await dbRun(`CREATE TABLE IF NOT EXISTS matching_audit (
      id INT AUTO_INCREMENT PRIMARY KEY,
      batch_code VARCHAR(100) NOT NULL,
      source_file VARCHAR(255),
      source_sheet VARCHAR(255),
      source_row INT,
      source_type VARCHAR(100),
      dealer_id VARCHAR(36),
      sap_code VARCHAR(100),
      sfa_code VARCHAR(100),
      dealer_name VARCHAR(255),
      match_method VARCHAR(50),
      match_confidence DOUBLE,
      match_status VARCHAR(50),
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_batch (batch_code),
      INDEX idx_audit_dealer (dealer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    console.log('[Migration] ✓ Verified matching_audit table exists');
  } catch (err) {
    console.warn('[Migration] Warning during startup migration (matching_audit):', err.message);
  }

  try {
    // Migration 3: Clean dummy '-' placeholders from master_dealers and backfill from master_dealer_so_mapping
    await dbRun(`UPDATE master_dealers SET so_name = NULL WHERE so_name IN ('-', 'NA', 'N/A')`);
    await dbRun(`UPDATE master_dealers SET so_emp_code = NULL WHERE so_emp_code IN ('-', 'NA', 'N/A')`);
    await dbRun(`UPDATE master_dealers SET asm_name = NULL WHERE asm_name IN ('-', 'NA', 'N/A')`);
    await dbRun(`UPDATE master_dealers SET asm_code = NULL WHERE asm_code IN ('-', 'NA', 'N/A')`);
    await dbRun(`UPDATE master_dealers SET rsm_name = NULL WHERE rsm_name IN ('-', 'NA', 'N/A')`);
    await dbRun(`UPDATE master_dealers SET rsm_code = NULL WHERE rsm_code IN ('-', 'NA', 'N/A')`);
    await dbRun(`UPDATE master_dealers SET zh_name = NULL WHERE zh_name IN ('-', 'NA', 'N/A')`);
    await dbRun(`UPDATE master_dealers SET zh_code = NULL WHERE zh_code IN ('-', 'NA', 'N/A')`);

    // Backfill master_dealers from master_dealer_so_mapping where hierarchy is missing
    await dbRun(`
      UPDATE master_dealers d
      JOIN master_dealer_so_mapping m ON (d.id = m.dealer_id OR (d.sap_code IS NOT NULL AND d.sap_code = m.sap_code))
      SET
        d.dm_area = COALESCE(d.dm_area, m.area),
        d.area = COALESCE(d.area, m.area),
        d.so_name = COALESCE(d.so_name, NULLIF(NULLIF(m.so_name, '-'), 'NA')),
        d.so_emp_code = COALESCE(d.so_emp_code, NULLIF(NULLIF(m.so_emp_code, '-'), 'NA')),
        d.asm_name = COALESCE(d.asm_name, NULLIF(NULLIF(m.asm_name, '-'), 'NA')),
        d.asm_code = COALESCE(d.asm_code, NULLIF(NULLIF(m.asm_code, '-'), 'NA')),
        d.rsm_name = COALESCE(d.rsm_name, NULLIF(NULLIF(m.rsm_name, '-'), 'NA')),
        d.rsm_code = COALESCE(d.rsm_code, NULLIF(NULLIF(m.rsm_code, '-'), 'NA')),
        d.zh_name = COALESCE(d.zh_name, NULLIF(NULLIF(m.zh_name, '-'), 'NA')),
        d.zh_code = COALESCE(d.zh_code, NULLIF(NULLIF(m.zh_code, '-'), 'NA'))
      WHERE d.so_emp_code IS NULL OR d.asm_code IS NULL OR d.dm_area IS NULL
    `);
    console.log('[Migration] ✓ Healed dealer hierarchy from master_dealer_so_mapping');
  } catch (err) {
    console.warn('[Migration] Warning during startup hierarchy healing:', err.message);
  }

  try {
    // Migration 4: Normalize any 'Active in SAP' or mixed-case status values to canonical 'ACTIVE'
    await dbRun(`
      UPDATE master_dealers
      SET status = 'ACTIVE'
      WHERE UPPER(TRIM(status)) IN ('ACTIVE IN SAP', 'ACTIVE IN SFA', 'ACTIVE', 'VALIDATED')
         OR (status IS NULL AND (dealer_type != 'PROSPECTIVE' OR dealer_type IS NULL))
    `);
    await dbRun(`
      UPDATE master_dealers
      SET status = 'INACTIVE'
      WHERE UPPER(TRIM(status)) IN ('INACTIVE', 'INACTIVE IN SAP', 'IN-ACTIVE')
    `);
    console.log('[Migration] ✓ Normalized dealer status values to canonical ACTIVE/INACTIVE');
  } catch (err) {
    console.warn('[Migration] Warning during status normalization:', err.message);
  }

  try {
    // Migration 5: Heal missing ASM on prospective dealers in master_dealers and master_dealer_so_mapping
    // 5a. Match ASM from other dealers with same so_emp_code or so_name
    await dbRun(`
      UPDATE master_dealers p
      JOIN (
        SELECT 
          so_name, so_emp_code,
          MAX(asm_name) as ref_asm_name, MAX(asm_code) as ref_asm_code,
          MAX(rsm_name) as ref_rsm_name, MAX(rsm_code) as ref_rsm_code,
          MAX(zh_name) as ref_zh_name, MAX(zh_code) as ref_zh_code
        FROM master_dealers
        WHERE asm_name IS NOT NULL AND asm_name != '' AND asm_name != '-'
        GROUP BY so_name, so_emp_code
      ) ref ON (
        (p.so_emp_code IS NOT NULL AND p.so_emp_code != '' AND p.so_emp_code = ref.so_emp_code)
        OR (p.so_name IS NOT NULL AND p.so_name != '' AND LOWER(TRIM(p.so_name)) = LOWER(TRIM(ref.so_name)))
      )
      SET
        p.asm_name = COALESCE(p.asm_name, ref.ref_asm_name),
        p.asm_code = COALESCE(p.asm_code, ref.ref_asm_code),
        p.rsm_name = COALESCE(p.rsm_name, ref.ref_rsm_name),
        p.rsm_code = COALESCE(p.rsm_code, ref.ref_rsm_code),
        p.zh_name = COALESCE(p.zh_name, ref.ref_zh_name),
        p.zh_code = COALESCE(p.zh_code, ref.ref_zh_code)
      WHERE p.dealer_type = 'PROSPECTIVE' AND (p.asm_name IS NULL OR p.asm_name = '' OR p.asm_name = '-')
    `);

    // 5b. Match ASM from other dealers in the same area
    await dbRun(`
      UPDATE master_dealers p
      JOIN (
        SELECT 
          area,
          MAX(asm_name) as ref_asm_name, MAX(asm_code) as ref_asm_code,
          MAX(rsm_name) as ref_rsm_name, MAX(rsm_code) as ref_rsm_code,
          MAX(zh_name) as ref_zh_name, MAX(zh_code) as ref_zh_code
        FROM master_dealers
        WHERE asm_name IS NOT NULL AND asm_name != '' AND asm_name != '-' AND area IS NOT NULL AND area != ''
        GROUP BY area
      ) ref ON (LOWER(TRIM(p.area)) = LOWER(TRIM(ref.area)) OR LOWER(TRIM(p.dm_area)) = LOWER(TRIM(ref.area)))
      SET
        p.asm_name = COALESCE(p.asm_name, ref.ref_asm_name),
        p.asm_code = COALESCE(p.asm_code, ref.ref_asm_code),
        p.rsm_name = COALESCE(p.rsm_name, ref.ref_rsm_name),
        p.rsm_code = COALESCE(p.rsm_code, ref.ref_rsm_code),
        p.zh_name = COALESCE(p.zh_name, ref.ref_zh_name),
        p.zh_code = COALESCE(p.zh_code, ref.ref_zh_code)
      WHERE p.dealer_type = 'PROSPECTIVE' AND (p.asm_name IS NULL OR p.asm_name = '' OR p.asm_name = '-')
    `);

    // 5c. Mirror prospect hierarchy into master_dealer_so_mapping where missing
    await dbRun(`
      INSERT INTO master_dealer_so_mapping 
        (dealer_id, sap_code, dealer_name, area, branch, region, block,
         so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, batch_code)
      SELECT 
        d.id, d.sfa_code, d.dealer_name, COALESCE(d.dm_area, d.area), COALESCE(d.dm_area, d.area),
        COALESCE(d.zone, d.region), COALESCE(d.sbg_block, d.block),
        d.so_name, d.so_emp_code, d.asm_name, d.asm_code, d.rsm_name, d.rsm_code, d.zh_name, d.zh_code, d.batch_code
      FROM master_dealers d
      LEFT JOIN master_dealer_so_mapping m ON d.id = m.dealer_id
      WHERE d.dealer_type = 'PROSPECTIVE' AND m.id IS NULL
    `);

    // 5d. Sync healed ASM from master_dealers to master_dealer_so_mapping
    await dbRun(`
      UPDATE master_dealer_so_mapping m
      JOIN master_dealers d ON m.dealer_id = d.id
      SET
        m.asm_name = COALESCE(m.asm_name, d.asm_name),
        m.asm_code = COALESCE(m.asm_code, d.asm_code),
        m.rsm_name = COALESCE(m.rsm_name, d.rsm_name),
        m.rsm_code = COALESCE(m.rsm_code, d.rsm_code),
        m.zh_name = COALESCE(m.zh_name, d.zh_name),
        m.zh_code = COALESCE(m.zh_code, d.zh_code)
      WHERE (m.asm_name IS NULL OR m.asm_name = '' OR m.asm_name = '-') AND d.asm_name IS NOT NULL
    `);

    // 5e. Propagate healed ASM to dealer_visit_targets where missing
    await dbRun(`
      UPDATE dealer_visit_targets t
      JOIN master_dealers d ON t.dealer_id = d.id
      SET
        t.asm_name = COALESCE(t.asm_name, d.asm_name),
        t.asm_code = COALESCE(t.asm_code, d.asm_code),
        t.rsm_name = COALESCE(t.rsm_name, d.rsm_name),
        t.rsm_code = COALESCE(t.rsm_code, d.rsm_code),
        t.zh_name = COALESCE(t.zh_name, d.zh_name),
        t.zh_code = COALESCE(t.zh_code, d.zh_code)
      WHERE (t.asm_name IS NULL OR t.asm_name = '' OR t.asm_name = '-') AND d.asm_name IS NOT NULL
    `);

    console.log('[Migration] ✓ Healed missing ASM and upper hierarchy for prospective dealers');
  } catch (err) {
    console.warn('[Migration] Warning during prospect ASM healing:', err.message);
  }

  try {
    // Migration 6: Heal prospect visit frequencies in dealer_visit_targets (ASM visits restored from approved matrix)
    await dbRun(`
      UPDATE dealer_visit_targets
      SET asm_visits = CASE 
        WHEN UPPER(TRIM(category)) = 'A' OR UPPER(TRIM(grade)) = 'A' THEN 3
        WHEN UPPER(TRIM(category)) = 'B' OR UPPER(TRIM(grade)) = 'B' THEN 2
        WHEN UPPER(TRIM(category)) = 'C' OR UPPER(TRIM(grade)) = 'C' THEN 1
        ELSE 0.5
      END
      WHERE (dealer_status = 'Prospective' OR cust_type = 'NON STAR' OR sap_code IS NULL)
        AND (asm_visits = 0 OR asm_visits IS NULL)
        AND (dealer_status != 'Churn')
    `);

    // Recalculate total_visits and percentage allocations for healed records
    await dbRun(`
      UPDATE dealer_visit_targets
      SET 
        total_visits = (COALESCE(so_visits, 0) + COALESCE(asm_visits, 0) + COALESCE(rsm_visits, 0) + COALESCE(zh_visits, 0)),
        so_visits_pct = CASE WHEN (COALESCE(so_visits, 0) + COALESCE(asm_visits, 0) + COALESCE(rsm_visits, 0) + COALESCE(zh_visits, 0)) > 0
          THEN ROUND((COALESCE(so_visits, 0) / (COALESCE(so_visits, 0) + COALESCE(asm_visits, 0) + COALESCE(rsm_visits, 0) + COALESCE(zh_visits, 0))) * 100, 2) ELSE 0 END,
        asm_visits_pct = CASE WHEN (COALESCE(so_visits, 0) + COALESCE(asm_visits, 0) + COALESCE(rsm_visits, 0) + COALESCE(zh_visits, 0)) > 0
          THEN ROUND((COALESCE(asm_visits, 0) / (COALESCE(so_visits, 0) + COALESCE(asm_visits, 0) + COALESCE(rsm_visits, 0) + COALESCE(zh_visits, 0))) * 100, 2) ELSE 0 END,
        rsm_visits_pct = CASE WHEN (COALESCE(so_visits, 0) + COALESCE(asm_visits, 0) + COALESCE(rsm_visits, 0) + COALESCE(zh_visits, 0)) > 0
          THEN ROUND((COALESCE(rsm_visits, 0) / (COALESCE(so_visits, 0) + COALESCE(asm_visits, 0) + COALESCE(rsm_visits, 0) + COALESCE(zh_visits, 0))) * 100, 2) ELSE 0 END,
        zh_visits_pct = CASE WHEN (COALESCE(so_visits, 0) + COALESCE(asm_visits, 0) + COALESCE(rsm_visits, 0) + COALESCE(zh_visits, 0)) > 0
          THEN ROUND((COALESCE(zh_visits, 0) / (COALESCE(so_visits, 0) + COALESCE(asm_visits, 0) + COALESCE(rsm_visits, 0) + COALESCE(zh_visits, 0))) * 100, 2) ELSE 0 END
      WHERE (dealer_status = 'Prospective' OR cust_type = 'NON STAR' OR sap_code IS NULL)
    `);

    // Heal missing so_emp_code in master_dealers and dealer_visit_targets where so_name is known
    await dbRun(`
      UPDATE master_dealers d
      JOIN master_employees e ON LOWER(TRIM(d.so_name)) = LOWER(TRIM(e.emp_name))
      SET d.so_emp_code = e.emp_code
      WHERE (d.so_emp_code IS NULL OR d.so_emp_code = '' OR d.so_emp_code = '-') AND d.so_name IS NOT NULL AND d.so_name != '' AND d.so_name != '-'
    `);

    await dbRun(`
      UPDATE dealer_visit_targets t
      JOIN master_employees e ON LOWER(TRIM(t.so_name)) = LOWER(TRIM(e.emp_name))
      SET t.so_emp_code = e.emp_code, t.so_code = e.emp_code
      WHERE (t.so_emp_code IS NULL OR t.so_emp_code = '' OR t.so_emp_code = '-') AND t.so_name IS NOT NULL AND t.so_name != '' AND t.so_name != '-'
    `);

    console.log('[Migration] ✓ Healed prospect visit targets and missing employee codes');
  } catch (err) {
    console.warn('[Migration] Warning during visit target healing:', err.message);
  }

  try {
    // Migration 7: Ensure zone column exists in master_dealer_so_mapping and master_employees
    const mappingCols = await dbAll("SHOW COLUMNS FROM master_dealer_so_mapping");
    const hasZoneMapping = mappingCols.some(c => c.Field === 'zone');
    if (!hasZoneMapping) {
      await dbRun("ALTER TABLE master_dealer_so_mapping ADD COLUMN zone VARCHAR(100) NULL AFTER region");
      await dbRun("UPDATE master_dealer_so_mapping SET zone = region WHERE zone IS NULL");
      console.log('[Migration] ✓ Added zone column to master_dealer_so_mapping and synced from region');
    }

    const empCols = await dbAll("SHOW COLUMNS FROM master_employees");
    const hasZoneEmp = empCols.some(c => c.Field === 'zone');
    if (!hasZoneEmp) {
      await dbRun("ALTER TABLE master_employees ADD COLUMN zone VARCHAR(100) NULL AFTER region");
      await dbRun("UPDATE master_employees SET zone = region WHERE zone IS NULL");
      console.log('[Migration] ✓ Added zone column to master_employees and synced from region');
    }
  } catch (err) {
    console.warn('[Migration] Warning during startup column check (zone):', err.message);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const rawBasePath = process.env.BASE_PATH || process.env.APP_BASE_PATH || '';
const basePath = rawBasePath ? (rawBasePath.startsWith('/') ? rawBasePath : `/${rawBasePath}`).replace(/\/$/, '') : '';

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Serve static admin panel UI
const adminPath = path.resolve(__dirname, '../admin-panel');
app.use(express.static(adminPath));
app.use('/admin', express.static(adminPath));

// Field App Simulator — the officer's phone and his manager's, side by side.
// The field app itself is API-only (no tokens, employee code in the path), so there is
// nothing to show in a demo without this. It calls the same /api/app/... endpoints the
// real app will, so whatever happens in it is real: the admin panel reflects it
// immediately. Mounted before the API routes so /simulator never hits the router.
const simulatorPath = path.resolve(__dirname, '../public');
app.use('/simulator', express.static(simulatorPath, { index: 'simulator.html' }));
app.get('/simulator', (req, res) => res.sendFile(path.join(simulatorPath, 'simulator.html')));

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'UP', message: 'Star Cement PJP / DJP Engine API Platform running.' });
});

// API Routes
app.use('/api', apiRoutes);

// Subpath deployment support: if BASE_PATH is defined (e.g. /djp or /star-cement), mount endpoints under it as well
if (basePath) {
  app.use(basePath, express.static(adminPath));
  app.use(`${basePath}/admin`, express.static(adminPath));
  app.use(`${basePath}/simulator`, express.static(simulatorPath, { index: 'simulator.html' }));
  app.get(`${basePath}/simulator`, (req, res) => res.sendFile(path.join(simulatorPath, 'simulator.html')));
  app.get(`${basePath}/health`, (req, res) => {
    res.json({ status: 'UP', message: 'Star Cement PJP / DJP Engine API Platform running.' });
  });
  app.use(`${basePath}/api`, apiRoutes);
}

// Global JSON error handler — ensures API responses are ALWAYS valid JSON and never HTML stack traces
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({
    error: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR'
  });
});

// Run startup migrations then start server
runStartupMigrations().then(() => {
  startSfaSyncCron();
  const server = app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`Star Cement PJP / DJP Engine Server running on port ${PORT}`);
    if (basePath) console.log(`Base Path:       ${basePath}`);
    console.log(`Admin Panel UI: http://localhost:${PORT}${basePath}/`);
    console.log(`Health check:    http://localhost:${PORT}${basePath}/health`);
    console.log(`====================================================`);
  });

  // A full C1 + C2 generation over the whole dealer population is a long request.
  // Node's defaults (requestTimeout 300s, headersTimeout 60s) destroy the socket
  // mid-run, which reaches the browser as a dead connection — res.json() then throws
  // "... is not valid JSON" even though the server is still working and eventually
  // finishes. Give long-running generation room, and disable the idle keep-alive
  // timeout so a slow reply is not cut off.
  server.requestTimeout = 30 * 60 * 1000;   // 30 min
  server.headersTimeout = 31 * 60 * 1000;   // must exceed requestTimeout
  server.keepAliveTimeout = 5 * 60 * 1000;
  server.setTimeout(0);
}).catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
