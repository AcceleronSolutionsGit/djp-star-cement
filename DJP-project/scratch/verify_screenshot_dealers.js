import { dbAll } from '../src/config/database.js';

async function verify() {
  const codes = ['1000000638', '1000000671', '1000000673', '1000000669', '1000000668', '1000000665', '1000000653', '1000000634', '1000000654'];
  const placeholders = codes.map(() => '?').join(',');
  const rows = await dbAll(`SELECT sap_code, dealer_name, doa FROM master_dealers WHERE sap_code IN (${placeholders}) ORDER BY doa ASC`, codes);
  console.log('Verified dealers from user screenshot:');
  console.table(rows);
}

verify().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
