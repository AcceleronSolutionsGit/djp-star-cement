/**
 * Migration Script: Fix Uttar Dinajpur / Raiganj RSM Hierarchy
 *
 * Corrects dealers in Uttar Dinajpur under SO Tapan Kumar Ghosh whose RSM
 * was mistakenly set to 'RITWICK CHATTERJEE' (NB1) instead of 'PRAKRITI RANJAN SIKDAR' (NB2)
 * due to an erroneous Zone entry in the October master file.
 */

import { dbRun, dbAll } from '../config/database.js';

export const UT_DINAJPUR_DEALER_CODES = [
  '1500000637', // ROY CONSTRUCTION (TAHERPUR)(RSDR977)
  '1500014604', // PODDAR CONSTRUCTION(RSDP2055)
  '1500014605', // ROY TRADERS(RSDR2056)
  '1500014657'  // ROY ENTERPRISE - HEMTABAD(RSDR2073)
];

export async function runFixUtDinajpurRsmMigration() {
  const placeholders = UT_DINAJPUR_DEALER_CODES.map(() => '?').join(', ');

  const mdRes = await dbRun(
    `UPDATE master_dealers 
     SET rsm_name = 'PRAKRITI RANJAN SIKDAR', 
         rsm_code = '1101157', 
         zone = 'NB2', 
         area = 'UTTAR DINAJPUR', 
         dm_area = 'UTTAR DINAJPUR',
         zh_name = 'GIRIDHARI MUKHERJEE',
         zh_code = '11002257'
     WHERE sap_code IN (${placeholders})
        OR ((area LIKE '%DINAJPUR%' OR dm_area LIKE '%DINAJPUR%' OR so_emp_code = '1101100' OR LOWER(so_name) LIKE '%tapan kumar ghosh%')
            AND (rsm_name = 'RITWICK CHATTERJEE' OR zone != 'NB2' OR rsm_name IS NULL OR rsm_name = ''))`,
    UT_DINAJPUR_DEALER_CODES
  );

  const mapRes = await dbRun(
    `UPDATE master_dealer_so_mapping 
     SET rsm_name = 'PRAKRITI RANJAN SIKDAR', 
         rsm_code = '1101157', 
         zone = 'NB2', 
         area = 'UTTAR DINAJPUR',
         zh_name = 'GIRIDHARI MUKHERJEE',
         zh_code = '11002257'
     WHERE sap_code IN (${placeholders})
        OR ((area LIKE '%DINAJPUR%' OR so_emp_code = '1101100' OR LOWER(so_name) LIKE '%tapan kumar ghosh%')
            AND (rsm_name = 'RITWICK CHATTERJEE' OR zone != 'NB2' OR rsm_name IS NULL OR rsm_name = ''))`,
    UT_DINAJPUR_DEALER_CODES
  );

  const dvtRes = await dbRun(
    `UPDATE dealer_visit_targets 
     SET rsm_name = 'PRAKRITI RANJAN SIKDAR', 
         rsm_code = '1101157', 
         zone = 'NB2', 
         area = 'UTTAR DINAJPUR', 
         dm_area = 'UTTAR DINAJPUR',
         zh_name = 'GIRIDHARI MUKHERJEE',
         zh_code = '11002257'
     WHERE sap_code IN (${placeholders})
        OR ((area LIKE '%DINAJPUR%' OR dm_area LIKE '%DINAJPUR%' OR so_emp_code = '1101100' OR LOWER(so_name) LIKE '%tapan kumar ghosh%')
            AND (rsm_name = 'RITWICK CHATTERJEE' OR zone != 'NB2' OR rsm_name IS NULL OR rsm_name = ''))`,
    UT_DINAJPUR_DEALER_CODES
  );

  return {
    dealersUpdated: mdRes.affectedRows,
    mappingsUpdated: mapRes.affectedRows,
    targetsUpdated: dvtRes.affectedRows
  };
}

if (process.argv[1] && process.argv[1].endsWith('migrate-fix-ut-dinajpur-rsm.js')) {
  runFixUtDinajpurRsmMigration()
    .then(result => {
      console.log('Migration completed successfully:', result);
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
