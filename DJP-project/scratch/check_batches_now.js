import { dbAll, dbGet } from '../src/config/database.js';

async function checkBatches() {
  const b = await dbAll('SELECT * FROM upload_batches ORDER BY id DESC LIMIT 5');
  console.log('Batches:', b);
  process.exit(0);
}

checkBatches().catch(console.error);
