/**
 * Benchmark test for Dealer Mapping Ingestion with 15,000 rows.
 */
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { dbAll, dbRun, dbGet } from '../config/database.js';

async function generate15kExcel() {
  const filePath = path.resolve('upload-files/benchmark-15k-mapping.xlsx');
  if (fs.existsSync(filePath)) {
    console.log('Benchmark file already exists at:', filePath);
    return filePath;
  }

  console.log('Generating 15,000-row benchmark Excel file...');
  const headers = [
    'Dealer SAP Code', 'Dealer Name', 'Branch', 'Zone',
    'SO Name', 'SO Emp Code', 'ASM Name', 'ASM Code',
    'RSM Name', 'RSM Code', 'Zonal Head', 'ZH Code',
    'Cust Type', 'Block', 'Counter Potential', 'DOA'
  ];

  const rows = [headers];
  const zones = ['NE1', 'NE2', 'NB1', 'NB2', 'SOUTH BENGAL', 'BIHAR'];
  const branches = ['GUWAHATI', 'SILCHAR', 'SILIGURI', 'MALDA', 'KOLKATA', 'PATNA'];
  
  for (let i = 1; i <= 15000; i++) {
    const zoneIdx = i % zones.length;
    rows.push([
      `TEST_SAP_${100000 + i}`,
      `Benchmark Dealer ${i}`,
      branches[zoneIdx],
      zones[zoneIdx],
      `SO Officer ${i % 50}`,
      `SO_${i % 50}`,
      `ASM Officer ${i % 20}`,
      `ASM_${i % 20}`,
      `RSM Officer ${i % 5}`,
      `RSM_${i % 5}`,
      `ZH Head ${zoneIdx}`,
      `ZH_${zoneIdx}`,
      i % 10 === 0 ? 'RSAR' : (i % 20 === 0 ? 'NON STAR' : 'DEALER'),
      `Block ${i % 100}`,
      (i * 10) % 500,
      '2024-01-15'
    ]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Dealer Mapping');
  XLSX.writeFile(wb, filePath);
  console.log('Saved benchmark file (15,000 rows) at:', filePath);
  return filePath;
}

generate15kExcel().catch(console.error);

