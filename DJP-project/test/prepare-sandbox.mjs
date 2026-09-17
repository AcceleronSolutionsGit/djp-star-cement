/**
 * Copies the real source files into test/sandbox and swaps config/database.js
 * for the in-memory SQLite harness, so workflow.test.mjs always runs against
 * the CURRENT controller and service code rather than a stale copy.
 *
 *   node test/prepare-sandbox.mjs && node test/workflow.test.mjs
 */
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sandbox = join(here, 'sandbox');

const FILES = [
  // real code under test
  ['src/services/planRouting.service.js',      'src/services/planRouting.service.js'],
  ['src/services/approvalMatrix.service.js',   'src/services/approvalMatrix.service.js'],
  ['src/services/c2Snapshot.service.js',       'src/services/c2Snapshot.service.js'],
  ['src/controllers/appPlan.controller.js',    'src/controllers/appPlan.controller.js'],
  ['src/controllers/generation.controller.js', 'src/controllers/generation.controller.js'],
  ['src/engines/sfa-adherence.engine.js',      'src/engines/sfa-adherence.engine.real.js'],

  // harness
  ['test/harness/database.js',            'src/config/__real_database.js'],
  ['test/harness/database_spy.js',        'src/config/database.js'],
  ['test/harness/stub_state.js',          'src/engines/__stub_state.js'],
  ['test/harness/stub_djp_generator.js',  'src/engines/djp-generator.engine.js'],
  ['test/harness/stub_autoplan.js',       'src/engines/autoPlanGenerator.js'],
  ['test/harness/stub_adherence.js',      'src/engines/sfa-adherence.engine.js'],

  // generation.controller imports this for the readiness gate
  ['test/harness/stub_data_loader.js',    'src/engines/pjp/data-loader.engine.js'],
  ['test/harness/stub_pjp_engine.js',     'src/engines/pjp/pjp.engine.js']
];

rmSync(sandbox, { recursive: true, force: true });
for (const [from, to] of FILES) {
  const dest = join(sandbox, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(root, from), dest);
  console.log(`  ${from}  ->  test/sandbox/${to}`);
}
console.log('\nSandbox ready. Run: node test/workflow.test.mjs');
