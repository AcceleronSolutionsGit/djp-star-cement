import { dbAll } from '../config/database.js';

async function checkRsarInSpd() {
  const rsarAsDealer = await dbAll(`
    SELECT spd.id, spd.dealer_sap_code, spd.dealer_name, spd.dealer_type,
           md.dealer_type as md_type
    FROM sales_plan_details spd
    LEFT JOIN master_dealers md ON spd.dealer_id = md.id
    WHERE spd.dealer_type = 'DEALER'
      AND (
        spd.dealer_sap_code LIKE '150%'
        OR spd.dealer_name LIKE '%(RSD%'
        OR spd.dealer_name LIKE '%(RSAR%'
        OR spd.dealer_name LIKE '%(RSRA%'
        OR md.dealer_type = 'RSAR'
      )
    LIMIT 10
  `);
  console.log('RSARs with spd.dealer_type = DEALER:', rsarAsDealer);

  const totalRsarAsDealer = await dbAll(`
    SELECT count(spd.id) as c
    FROM sales_plan_details spd
    LEFT JOIN master_dealers md ON spd.dealer_id = md.id
    WHERE spd.dealer_type = 'DEALER'
      AND (
        spd.dealer_sap_code LIKE '150%'
        OR spd.dealer_name LIKE '%(RSD%'
        OR spd.dealer_name LIKE '%(RSAR%'
        OR spd.dealer_name LIKE '%(RSRA%'
        OR md.dealer_type = 'RSAR'
      )
  `);
  console.log('Total RSARs marked as DEALER in sales_plan_details:', totalRsarAsDealer[0]?.c);

  process.exit(0);
}

checkRsarInSpd().catch(console.error);

