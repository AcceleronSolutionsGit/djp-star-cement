import { dbGet } from './src/config/database.js';
dbGet("SELECT COUNT(*) as cnt FROM master_dealers WHERE dealer_type = 'DEALER'").then(console.log);
