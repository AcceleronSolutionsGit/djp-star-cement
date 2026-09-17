import { dbAll, dbGet } from '../src/config/database.js';
import * as XLSX from 'xlsx';

async function testExports() {
  console.log('--- TESTING EXPORTS ---');
  
  // 1. Test PJP Trade Excel data
  const targets = await dbAll(`
    SELECT dvt.*, md.dealer_type, md.block
    FROM dealer_visit_targets dvt
    LEFT JOIN master_dealers md ON dvt.dealer_id = md.id
    WHERE dvt.period_month = '2026-09' AND dvt.cycle_code = 'C1'
    ORDER BY dvt.zone ASC, dvt.category ASC, dvt.dealer_name ASC
  `);

  console.log('PJP Trade Export Row Count:', targets.length);

  const exportData = targets.map(t => {
    let rawType = String(t.cust_type || t.dealer_type || 'DEALER').toUpperCase();
    let custType = 'Dealer';
    if (rawType === 'PROSPECTIVE' || rawType === 'PROSPECT') {
      custType = 'Prospective';
    } else if (rawType === 'NON_STAR' || rawType === 'NON-STAR') {
      custType = 'Non-Star';
    }

    let custCode = t.sap_code || t.sfa_code || '';
    const block = t.sbg_block || t.block || '';
    const area = t.dm_area || t.area || '';
    const priority = t.priority !== null && t.priority !== undefined ? Number(t.priority) : 1;
    const soVisits = parseFloat(t.so_visits) || 0;
    const asmVisits = parseFloat(t.asm_visits) || 0;
    const rsmVisits = parseFloat(t.rsm_visits) || 0;
    const zhVisits = parseFloat(t.zh_visits) || 0;

    return {
      'Zone': t.zone || '',
      'Cust Type': custType,
      'Area': area,
      'Block': block,
      'ZONAL HEAD': t.zh_name || '',
      'RSM': t.rsm_name || '',
      'ASM': t.asm_name || '',
      'SO/SE NAME': t.so_name || '',
      'DEALER NAME': t.dealer_name || '',
      'Customer CODE': custCode,
      'Priority': priority,
      'Category': t.dealer_status || '',
      'No. of visits by SO': soVisits,
      'No. of visits by ASM': asmVisits,
      'Number of Visit by RSM': rsmVisits,
      'Number of Visit by ZH': zhVisits
    };
  });

  console.table(exportData);

  // 2. Test Visits export logic (Churn excluded)
  const nonChurnVisits = exportData.filter(d => d.Category !== 'Churn');
  console.log('\nVisits export count (Churn excluded):', nonChurnVisits.length);

  process.exit(0);
}

testExports().catch(e => {
  console.error(e);
  process.exit(1);
});
