import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'star_one_djp',
});

try {
  // Check current columns
  const [cols] = await pool.query('SHOW COLUMNS FROM sales_plans');
  console.log('Current sales_plans columns:', cols.map(c => c.Field).join(', '));

  const hasCycleCode = cols.some(c => c.Field === 'cycle_code');
  if (!hasCycleCode) {
    await pool.query("ALTER TABLE sales_plans ADD COLUMN cycle_code VARCHAR(5) DEFAULT 'C1'");
    console.log('✓ Added cycle_code column to sales_plans');
  } else {
    console.log('cycle_code already exists in sales_plans — skipping');
  }

  const [updatedCols] = await pool.query('SHOW COLUMNS FROM sales_plans');
  console.log('Updated sales_plans columns:', updatedCols.map(c => c.Field).join(', '));

  await pool.end();
  console.log('Migration complete.');
} catch (err) {
  console.error('Migration error:', err.message);
  await pool.end();
  process.exit(1);
}
