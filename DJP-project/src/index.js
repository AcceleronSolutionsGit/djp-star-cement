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
    // Migration: add cycle_code to sales_plans (Phase 1 dual-cycle support)
    const cols = await dbAll("SHOW COLUMNS FROM sales_plans");
    const hasCycleCode = cols.some(c => c.Field === 'cycle_code');
    if (!hasCycleCode) {
      await dbRun("ALTER TABLE sales_plans ADD COLUMN cycle_code VARCHAR(5) NOT NULL DEFAULT 'C1'");
      console.log('[Migration] ✓ Added cycle_code to sales_plans');
    }
  } catch (err) {
    console.warn('[Migration] Warning during startup migration:', err.message);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const rawBasePath = process.env.BASE_PATH || process.env.APP_BASE_PATH || '';
const basePath = rawBasePath ? (rawBasePath.startsWith('/') ? rawBasePath : `/${rawBasePath}`).replace(/\/$/, '') : '';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
