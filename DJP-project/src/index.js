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
