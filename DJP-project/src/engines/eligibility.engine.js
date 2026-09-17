import { dbAll } from '../config/database.js';

export async function getEligibleDealersForSO(soEmpCode, soName) {
  const sql = `
    SELECT 
      d.id as dealer_id,
      d.dealer_type,
      d.sap_code,
      d.sfa_code,
      d.rssd_code,
      d.dealer_name,
      d.area,
      d.zone,
      d.counter_potential,
      d.expected_sale,
      d.counter_strategy,
      m.so_emp_code,
      m.so_name
    FROM master_dealer_so_mapping m
    JOIN master_dealers d ON m.dealer_id = d.id
    WHERE m.so_emp_code = ? OR m.so_name = ?
  `;

  const dealers = await dbAll(sql, [soEmpCode, soName]);
  return dealers;
}
