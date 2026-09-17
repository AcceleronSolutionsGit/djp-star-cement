import { dbAll } from '../src/config/database.js';

async function checkBatches() {
  const batches = await dbAll('SELECT * FROM upload_batches ORDER BY id DESC LIMIT 10');
  console.log('Recent batches:', batches);
}

checkBatches().catch(console.error);
