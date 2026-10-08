import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  try {
    const mappingPath = path.resolve(__dirname, './upload-files/01_Dealer_Mapping_Filled.xlsx');
    if (!fs.existsSync(mappingPath)) {
      console.error('Mapping file not found at ' + mappingPath);
      process.exit(1);
    }

    const wbIn = XLSX.readFile(mappingPath);
    const wsIn = wbIn.Sheets[wbIn.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(wsIn);

    if (rawRows.length === 0) {
      console.log('No mapped dealers found.');
      process.exit(1);
    }

    // Grab first 500 rows
    const rows = rawRows.slice(0, 500);

    const sfaData = rows.map((row) => {
      // Find keys that match "Dealer Name", "Customer Code", "SO Name" etc.
      const getVal = (keywords) => {
        const key = Object.keys(row).find(k => keywords.some(kw => k.toLowerCase().includes(kw)));
        return key ? row[key] : null;
      };

      const dealerCode = getVal(['code', 'sap', 'dealer code']) || 'DLR123';
      const dealerName = getVal(['dealer name', 'customer']) || 'Test Dealer';
      const soName = getVal(['so name', 'officer']) || 'Test SO';
      
      const date = new Date();
      date.setDate(Math.floor(Math.random() * Math.min(15, date.getDate())) + 1);
      
      return {
        'Date of Visit': date.toISOString().split('T')[0],
        'Customer Code': dealerCode,
        'Customer Name': dealerName,
        'Route': 'R1',
        'Type': 'Retailer',
        'Branch': 'Branch-A',
        'Employee Code': 'EMP_TEST',
        'Employee Name': soName,
        'Check In Time': '10:00:00',
        'Check Out Time': '10:30:00',
        'Duration': '00:30:00',
        'Visit Status(Productive / Non productive)': 'Productive',
        'Purpose Of Visit': 'Sales',
        'Remarks': 'Test Adherence Visit'
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sfaData);
    XLSX.utils.book_append_sheet(wb, ws, 'SFA Report');

    const empData = [{ Name: 'Test SO', Desig: 'SO', ZONE: 'Z1', Region: 'R1' }];
    const empWs = XLSX.utils.json_to_sheet(empData);
    XLSX.utils.book_append_sheet(wb, empWs, 'Employee list');

    const outPath = path.resolve(__dirname, './upload-files/Test_SFA_Report.xlsx');
    XLSX.writeFile(wb, outPath);
    console.log('Successfully generated SFA report with ' + sfaData.length + ' executed visits at ' + outPath);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
