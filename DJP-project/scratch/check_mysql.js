import { dbAll, dbGet } from '../src/config/database.js';

async function checkMySQL() {
  console.log('Testing MySQL connection...');
  const res = await dbGet('SELECT DATABASE() as db, VERSION() as ver');
  console.log('Connected to MySQL:', res);

  const tables = await dbAll('SHOW TABLES');
  console.log('Tables in', res.db, ':', tables.map(t => Object.values(t)[0]));

  for (const table of tables) {
    const tableName = Object.values(table)[0];
    const cnt = await dbGet(`SELECT COUNT(*) as n FROM \`${tableName}\``);
    console.log(`  ${tableName}: ${cnt.n} rows`);
  }
}

checkMySQL().catch(console.error);
