import http from 'http';
import express from 'express';
import cors from 'cors';
import XLSX from 'xlsx';
import apiRoutes from '../routes/api.routes.js';

async function testApiExports() {
  console.log('=== STARTING HTTP API & EXPORT VERIFICATION TEST ===\n');

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', apiRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`Test server listening on ephemeral port: ${port}`);

  const fetchBuffer = (path) => new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${path}`, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${path}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });

  const fetchJson = (path) => new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${path}`, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${path}`));
      }
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve(JSON.parse(raw)));
      res.on('error', reject);
    }).on('error', reject);
  });

  try {
    // 1. Test Reconciliation API
    console.log('\n1. Testing GET /api/djp/reconciliation...');
    const recon = await fetchJson('/api/djp/reconciliation?periodMonth=2026-06&cycleCode=C1');
    console.log('   Reconciliation response:', {
      totalReceived: recon.reconciliationReport.totalReceived,
      normalizedCount: recon.reconciliationReport.normalizedCount,
      unmatchedCount: recon.reconciliationReport.unmatchedCount,
      canonicalDealers: recon.canonicalDealers.length
    });

    if (recon.canonicalDealers.length !== 5) {
      throw new Error(`Expected 5 canonical dealers, got ${recon.canonicalDealers.length}`);
    }
    console.log('   >>> Reconciliation API: PASS! <<<');

    // 2. Test Master Excel Export API
    console.log('\n2. Testing GET /api/djp/export-master...');
    const masterBuf = await fetchBuffer('/api/djp/export-master?periodMonth=2026-06&cycleCode=C1');
    const masterWb = XLSX.read(masterBuf, { type: 'buffer' });
    console.log('   Master export sheets:', masterWb.SheetNames);
    if (!masterWb.SheetNames.includes('Report')) {
      throw new Error('Master export must contain sheet named "Report"');
    }
    const masterRows = XLSX.utils.sheet_to_json(masterWb.Sheets['Report']);
    console.log(`   Master exported rows count: ${masterRows.length}`);
    if (masterRows.length !== 5) {
      throw new Error(`Expected 5 rows in Master export, got ${masterRows.length}`);
    }

    // Compare with expected
    const expMasterWb = XLSX.readFile('upload-files/M_SAMPLE_EXPECTED.xlsx');
    const expMasterRows = XLSX.utils.sheet_to_json(expMasterWb.Sheets['Report']);

    let masterErrors = 0;
    for (let i = 0; i < 5; i++) {
      const exp = expMasterRows[i];
      const act = masterRows[i];
      for (const col of Object.keys(exp)) {
        if (String(exp[col]).trim() !== String(act[col]).trim()) {
          console.error(`   Mismatch in Master row ${i}, col ${col}: exp="${exp[col]}", act="${act[col]}"`);
          masterErrors++;
        }
      }
    }
    if (masterErrors > 0) {
      throw new Error(`Master export had ${masterErrors} column value mismatches`);
    }
    console.log('   >>> Master Excel Export API: 100% PASS! <<<');

    // 3. Test Visits Excel Export API
    console.log('\n3. Testing GET /api/djp/export-visits...');
    const visitsBuf = await fetchBuffer('/api/djp/export-visits?periodMonth=2026-06&cycleCode=C1');
    const visitsWb = XLSX.read(visitsBuf, { type: 'buffer' });
    console.log('   Visits export sheets:', visitsWb.SheetNames);
    if (!visitsWb.SheetNames.includes('Report') || !visitsWb.SheetNames.includes('Summary')) {
      throw new Error('Visits export must contain sheets "Report" and "Summary"');
    }
    const visitsReportRows = XLSX.utils.sheet_to_json(visitsWb.Sheets['Report']);
    const visitsSummaryRows = XLSX.utils.sheet_to_json(visitsWb.Sheets['Summary']);
    console.log(`   Visits Report rows: ${visitsReportRows.length}, Summary rows: ${visitsSummaryRows.length}`);

    const expVisitsWb = XLSX.readFile('upload-files/visits-To Be Achieved_SAMPLE_EXPECTED.xlsx');
    const expReportRows = XLSX.utils.sheet_to_json(expVisitsWb.Sheets['Report']);
    const expSummaryRows = XLSX.utils.sheet_to_json(expVisitsWb.Sheets['Summary']);

    if (visitsReportRows.length !== expReportRows.length) {
      throw new Error(`Expected ${expReportRows.length} active visit rows, got ${visitsReportRows.length}`);
    }

    let visitErrors = 0;
    for (let i = 0; i < expReportRows.length; i++) {
      const exp = expReportRows[i];
      const act = visitsReportRows[i];
      for (const col of Object.keys(exp)) {
        if (String(exp[col]).trim() !== String(act[col]).trim()) {
          console.error(`   Mismatch in Visits row ${i}, col ${col}: exp="${exp[col]}", act="${act[col]}"`);
          visitErrors++;
        }
      }
    }
    for (let i = 0; i < expSummaryRows.length; i++) {
      const exp = expSummaryRows[i];
      const act = visitsSummaryRows[i];
      for (const col of Object.keys(exp)) {
        if (String(exp[col]).trim() !== String(act[col]).trim()) {
          console.error(`   Mismatch in Summary row ${i}, col ${col}: exp="${exp[col]}", act="${act[col]}"`);
          visitErrors++;
        }
      }
    }
    if (visitErrors > 0) {
      throw new Error(`Visits export had ${visitErrors} value mismatches`);
    }
    console.log('   >>> Visits Excel Export API: 100% PASS! <<<');

    console.log('\n================================================================');
    console.log('>>> ALL HTTP ENDPOINTS & EXCEL REPORTS VERIFIED 100% SUCCESSFUL! <<<');
    console.log('================================================================\n');
    server.close();
    process.exit(0);
  } finally {
    server.close();
  }
}

testApiExports().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
