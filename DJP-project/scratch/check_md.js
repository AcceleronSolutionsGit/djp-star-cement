import { dbAll, dbGet } from '../src/config/database.js';

async function check() {
  const count = await dbGet('SELECT COUNT(*) as n FROM master_dealers');
  console.log('Total master_dealers in DB:', count.n);

  const types = await dbAll('SELECT dealer_type, COUNT(*) as cnt FROM master_dealers GROUP BY dealer_type');
  console.log('Dealer types:', types);

  const sbgStats = await dbAll('SELECT sbg_status, COUNT(*) as cnt FROM master_dealers GROUP BY sbg_status');
  console.log('SBG stats:', sbgStats);
}

check().catch(console.error);
