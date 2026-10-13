/** database.js for the pipeline test: same SQLite harness, but records DELETEs. */
import { calls } from '../engines/__stub_state.js';
export * from './__real_database.js';
import { dbRun as realRun } from './__real_database.js';
export const dbRun = async (sql, params = []) => {
  const m = /DELETE\s+FROM\s+(\w+)/i.exec(sql);
  if (m) {
    const c = /cycle_code\s*=\s*'(\w+)'/i.exec(sql);
    calls.purged.push(`${m[1]}${c ? ':' + c[1] : ''}`);
  }
  return realRun(sql, params);
};
