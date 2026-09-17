import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
const dbUser = process.env.DB_USER || 'root';
const dbPassword = process.env.DB_PASSWORD || '';
const dbName = process.env.DB_NAME || 'star_one_djp';

// Create connection pool
export const pool = mysql.createPool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  waitForConnections: true,
  connectionLimit: 25,
  queueLimit: 0,
  multipleStatements: true,
  decimalNumbers: true,
  dateStrings: true
});

/**
 * Execute INSERT, UPDATE, DELETE queries
 * Returns { lastID, insertId, changes, affectedRows }
 */
export const dbRun = async (sql, params = []) => {
  const [result] = await pool.query(sql, params);
  return {
    lastID: result.insertId || 0,
    insertId: result.insertId || 0,
    id: result.insertId || 0,
    changes: result.affectedRows || 0,
    affectedRows: result.affectedRows || 0
  };
};

/**
 * Fetch a single row (equivalent to SQLite db.get)
 */
export const dbGet = async (sql, params = []) => {
  const [rows] = await pool.query(sql, params);
  if (Array.isArray(rows) && rows.length > 0) {
    return rows[0];
  }
  return null;
};

/**
 * Fetch multiple rows (equivalent to SQLite db.all)
 */
export const dbAll = async (sql, params = []) => {
  const [rows] = await pool.query(sql, params);
  return Array.isArray(rows) ? rows : [];
};

/**
 * Execute raw SQL script / multiple statements (equivalent to SQLite db.exec)
 */
export const dbExec = async (sql) => {
  const [result] = await pool.query(sql);
  return result;
};

export default {
  pool,
  dbRun,
  dbGet,
  dbAll,
  dbExec
};
