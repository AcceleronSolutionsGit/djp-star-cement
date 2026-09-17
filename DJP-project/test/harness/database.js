/**
 * Test-only stand-in for src/config/database.js.
 * Backs the same dbRun / dbGet / dbAll surface with an in-memory SQLite database
 * so the real controllers can be exercised without a MySQL server.
 */
import { DatabaseSync } from 'node:sqlite';

export const db = new DatabaseSync(':memory:');

function translate(sql) {
  return sql
    .replace(/CURRENT_TIMESTAMP/g, "datetime('now')")
    .replace(/\bNOW\(\)/gi, "datetime('now')")
    // information_schema existence probes (migration guards, c2Snapshot) → sqlite_master
    .replace(/information_schema\.TABLES/gi, 'sqlite_master')
    .replace(/TABLE_SCHEMA\s*=\s*DATABASE\(\)/gi, "type = 'table'")
    .replace(/\bTABLE_NAME\b/g, 'name')
    // MySQL's ON DUPLICATE KEY UPDATE only fires when a UNIQUE or PRIMARY key is
    // actually violated. Where the table declares none — which is the case for
    // dealer_performance_history — MySQL silently performs a plain INSERT and the
    // clause is dead. Stripping it reproduces that behaviour faithfully; SQLite has
    // no equivalent syntax, and converting it to ON CONFLICT would invent an upsert
    // the production database does not have.
    .replace(/\bON\s+DUPLICATE\s+KEY\s+UPDATE[\s\S]*$/i, '');
}

export const dbRun = async (sql, params = []) => {
  const r = db.prepare(translate(sql)).run(...params.map(p => (p === undefined ? null : p)));
  return {
    lastID: Number(r.lastInsertRowid || 0),
    insertId: Number(r.lastInsertRowid || 0),
    id: Number(r.lastInsertRowid || 0),
    changes: Number(r.changes || 0),
    affectedRows: Number(r.changes || 0)
  };
};

export const dbGet = async (sql, params = []) => {
  const rows = db.prepare(translate(sql)).all(...params.map(p => (p === undefined ? null : p)));
  return rows.length ? rows[0] : null;
};

export const dbAll = async (sql, params = []) => {
  return db.prepare(translate(sql)).all(...params.map(p => (p === undefined ? null : p)));
};

export const dbExec = async (sql) => db.exec(translate(sql));
export const pool = { end: async () => db.close() };
export default { pool, dbRun, dbGet, dbAll, dbExec };
