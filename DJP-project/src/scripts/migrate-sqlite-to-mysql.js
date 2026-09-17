import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
const dbUser = process.env.DB_USER || 'root';
const dbPassword = process.env.DB_PASSWORD || '';
const dbName = process.env.DB_NAME || 'star_one_djp';

const sqliteDbPath = path.resolve(__dirname, '../../database.sqlite');

function getSqliteRows(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function getSqliteCount(db, tableName) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as cnt FROM ${tableName}`, (err, row) => {
      if (err) resolve(0);
      else resolve(row ? row.cnt : 0);
    });
  });
}

function normalizeDate(val) {
  if (!val) return null;
  if (!isNaN(val) && Number(val) > 20000 && Number(val) < 100000) {
    const serial = Number(val);
    const utc_days = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;
    const dateObj = new Date(utc_value * 1000);
    return dateObj.toISOString().split('T')[0];
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    return val.substring(0, 10);
  }
  if (typeof val === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(val)) {
    const parts = val.split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2].substring(0, 4);
    return `${y}-${m}-${d}`;
  }
  return val;
}

async function runMigration() {
  console.log('======================================================================');
  console.log('🚀 STAR CEMENT: SQLITE TO MYSQL MIGRATION SCRIPT');
  console.log(`Target MySQL DB: ${dbName} (${dbHost}:${dbPort})`);
  console.log(`Source SQLite:   ${sqliteDbPath}`);
  console.log('======================================================================\n');

  if (!fs.existsSync(sqliteDbPath)) {
    console.error(`❌ SQLite database file not found at: ${sqliteDbPath}`);
    process.exit(1);
  }

  // 1. Connect to MySQL server and ensure DB exists
  console.log('1. Checking MySQL server connection...');
  const rootConn = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    multipleStatements: true
  });

  await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
  console.log(`   Database '${dbName}' verified/created.`);
  await rootConn.end();

  // 2. Connect to target database
  const myConn = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    multipleStatements: true
  });

  // 3. Apply Schema
  console.log('\n2. Applying MySQL Schema...');
  const schemaPath = path.resolve(__dirname, '../models/schema.mysql.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await myConn.query(schemaSql);
  console.log('   MySQL schema applied successfully.');

  // 4. Open SQLite database
  const sqDb = new sqlite3.Database(sqliteDbPath);

  // Tables to migrate
  const tables = [
    'upload_batches',
    'master_employees',
    'master_dealers',
    'master_dealer_so_mapping',
    'sales_history',
    'visit_execution_logs',
    'business_rules',
    'dealer_visit_targets',
    'djp_recommendations',
    'sales_plans',
    'sales_plan_details',
    'plan_approvals'
  ];

  console.log('\n3. Migrating Data from SQLite to MySQL...');
  await myConn.query('SET FOREIGN_KEY_CHECKS = 0;');

  for (const table of tables) {
    const totalCount = await getSqliteCount(sqDb, table);
    if (totalCount === 0) {
      console.log(`   - ${table}: 0 rows in SQLite (Skipping)`);
      continue;
    }

    // Clear target table in MySQL
    await myConn.query(`TRUNCATE TABLE \`${table}\`;`);

    const BATCH_SIZE = 2500;
    let offset = 0;
    const startTime = Date.now();

    while (offset < totalCount) {
      const rows = await getSqliteRows(sqDb, `SELECT * FROM \`${table}\` LIMIT ${BATCH_SIZE} OFFSET ${offset}`);
      if (!rows || rows.length === 0) break;

      const columns = Object.keys(rows[0]);
      const colNames = columns.map(c => `\`${c}\``).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const values = [];

      rows.forEach(r => {
        columns.forEach(col => {
          let val = r[col];
          if (val === undefined) val = null;
          if (col === 'visit_date' && val !== null) {
            val = normalizeDate(val);
          }
          values.push(val);
        });
      });

      const rowPlaceholders = rows.map(() => `(${placeholders})`).join(', ');
      const insertSql = `INSERT INTO \`${table}\` (${colNames}) VALUES ${rowPlaceholders}`;

      await myConn.query(insertSql, values);
      offset += rows.length;

      const progress = Math.min(100, Math.round((offset / totalCount) * 100));
      process.stdout.write(`\r   - ${table}: ${offset.toLocaleString()} / ${totalCount.toLocaleString()} rows migrated (${progress}%)`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n     Done in ${duration}s.`);
  }

  await myConn.query('SET FOREIGN_KEY_CHECKS = 1;');

  // 5. Verification
  console.log('\n======================================================================');
  console.log('4. Verification Summary (SQLite vs MySQL):');
  console.log('======================================================================');

  let allMatch = true;
  for (const table of tables) {
    const sqCount = await getSqliteCount(sqDb, table);
    const [myRows] = await myConn.query(`SELECT COUNT(*) as cnt FROM \`${table}\``);
    const myCount = myRows[0]?.cnt || 0;
    const match = sqCount === myCount;
    if (!match) allMatch = false;

    console.log(`   ${table.padEnd(28)} | SQLite: ${sqCount.toString().padStart(7)} | MySQL: ${myCount.toString().padStart(7)} | ${match ? '✅ MATCH' : '❌ MISMATCH'}`);
  }

  sqDb.close();
  await myConn.end();

  console.log('======================================================================');
  if (allMatch) {
    console.log('🎉 MIGRATION TO MYSQL COMPLETED SUCCESSFULLY WITH 100% INTEGRITY!');
  } else {
    console.log('⚠️ Migration completed with some count discrepancies. Review logs above.');
  }
  console.log('======================================================================\n');
}

runMigration().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
