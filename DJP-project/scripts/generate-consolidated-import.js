import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();

const fileSources = [
  {
    sheetName: 'Dealer_Mapping',
    file: path.join(projectRoot, 'upload-files', '01_Dealer_Mapping_Filled.xlsx'),
    title: 'Dealer to Sales Officer & Hierarchy Mapping',
    desc: 'Maps SAP Code, SFA Code, Dealer Name, Cust Type, Area, Zone, Block, SO Name, SO Emp Code, ASM Name/Code, RSM Name/Code, ZH Name/Code, Counter Potential, and DOA.'
  },
  {
    sheetName: 'Dealer_Performance',
    file: path.join(projectRoot, 'upload-files', '02_Dealer_Performance_Filled.xlsx'),
    title: 'Dealer Monthly Performance & Targets',
    desc: 'Contains SAP/Code, Dealer Name, Area, Region, DOA, Targeted Dealer, Exclusive Dealer, Target (June 26), Prorata Target, and historical monthly sales.'
  },
  {
    sheetName: 'SBG_Master',
    file: path.join(projectRoot, 'upload-files', '03_SBG_Master_Filled.xlsx'),
    title: 'SBG Micro Market Potential Master',
    desc: 'Captures Customer Code, Dealer Name, Territory Code/Name, Block, Counter Potential Average (MT), Zone, SO/ASM/RSM/ZH codes, SAP Status, and Dealer Start Date.'
  },
  {
    sheetName: 'Sales_History',
    file: path.join(projectRoot, 'upload-files', '04_Sales_History_RSAR_Filled.xlsx'),
    title: 'RSAR & Sub-Dealer 6-Month Sales History',
    desc: 'Historical trend data with SAP Code, Sub Dealer Name, Linked Dealer Code/Name, Zone, and monthly sales from Jan-26 to Jun-26.'
  },
  {
    sheetName: 'Prospect_Dealers',
    file: path.join(projectRoot, 'upload-files', "Prospect_Dealer_List-Jul'2026 (2) (2).xlsx"),
    title: 'Prospective Dealer & Customer Pipeline',
    desc: 'Pipeline of prospective dealers: Zone, Area, Taluka, SFA Code, Prospective Dealer Name, Assigned SO Name, Potential (MT), Expected Sale (MT), Month.'
  },
  {
    sheetName: 'SFA_Report',
    file: path.join(projectRoot, 'upload-files', '05_SFA_Report_Filled.xlsx'),
    title: 'SFA Field Execution & Visit Tracking Report',
    desc: 'Actual execution records: Date of Visit, Customer Code, Customer Name, Route, Branch, Employee Code/Name, Check-in/out times, Duration, Visit Status, and Purpose.'
  }
];

const newWb = XLSX.utils.book_new();

// 1. Build Index & Guide Sheet
const guideData = [
  ['STAR CEMENT - PJP / DJP AUTOMATION CONSOLIDATED MASTER IMPORT WORKBOOK', '', '', ''],
  ['Version: 1.0 | Environment: Operational Production / Test Engine | Generated: ' + new Date().toISOString().split('T')[0], '', '', ''],
  ['', '', '', ''],
  ['#', 'Sheet Name', 'Data Domain / Module', 'Record Count', 'Primary Purpose / Target Tables'],
];

const loadedSheets = [];

for (let i = 0; i < fileSources.length; i++) {
  const item = fileSources[i];
  if (!fs.existsSync(item.file)) {
    console.warn(`File not found: ${item.file}`);
    continue;
  }
  const sourceWb = XLSX.readFile(item.file);
  const sourceSheetName = sourceWb.SheetNames[0];
  const sourceSheet = sourceWb.Sheets[sourceSheetName];
  const sheetRows = XLSX.utils.sheet_to_json(sourceSheet, { header: 1, defval: '' });
  
  const rowCount = Math.max(0, sheetRows.length - 1);
  guideData.push([
    (i + 1).toString(),
    item.sheetName,
    item.title,
    rowCount.toString() + ' records',
    item.desc
  ]);

  loadedSheets.push({
    sheetName: item.sheetName,
    sheet: sourceSheet,
    rowCount
  });
}

guideData.push(['', '', '', '', '']);
guideData.push(['PIPELINE INGESTION ORDER & INTEGRITY CONSTRAINTS:', '', '', '', '']);
guideData.push(['Step 1', 'Dealer_Mapping', 'Must be ingested first to establish Master Dealers & Hierarchy (SO/ASM/RSM/ZH).', '', '']);
guideData.push(['Step 2', 'SBG_Master', 'Updates dealer counter potential (MT), micro-market territories, and active SAP status.', '', '']);
guideData.push(['Step 3', 'Dealer_Performance', 'Loads monthly targets, prorata targets, DOA classification, and dealer performance history.', '', '']);
guideData.push(['Step 4', 'Sales_History', 'Populates sub-dealer and RSAR 6-month historical sales curves for growth/zero-lifter analysis.', '', '']);
guideData.push(['Step 5', 'Prospect_Dealers', 'Enriches the prospective customer pool for new market expansion recommendations.', '', '']);
guideData.push(['Step 6', 'SFA_Report', 'Logs actual field visit executions, check-in timestamps, and triggers C2 mid-month dynamic feedback.', '', '']);

const guideWs = XLSX.utils.aoa_to_sheet(guideData);
guideWs['!cols'] = [{ wch: 8 }, { wch: 24 }, { wch: 45 }, { wch: 18 }, { wch: 70 }];
XLSX.utils.book_append_sheet(newWb, guideWs, 'Index_and_Guide');

// 2. Append each domain sheet with all data
for (const item of loadedSheets) {
  XLSX.utils.book_append_sheet(newWb, item.sheet, item.sheetName);
  console.log(`Appended sheet: ${item.sheetName} (${item.rowCount} data rows)`);
}

// 3. Write output to root, templates, and upload-files
const outFiles = [
  path.join(projectRoot, 'Consolidated_Master_Import.xlsx'),
  path.join(projectRoot, 'templates', 'Consolidated_Master_Import.xlsx'),
  path.join(projectRoot, 'upload-files', 'Consolidated_Master_Import.xlsx')
];

for (const outPath of outFiles) {
  XLSX.writeFile(newWb, outPath);
  console.log(`Saved consolidated master file to: ${outPath}`);
}

console.log('Successfully generated Consolidated Master Import workbook with all Excel data!');
