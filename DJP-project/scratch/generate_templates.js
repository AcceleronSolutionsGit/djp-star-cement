import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve('templates');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// 1. DEALER MAPPING TEMPLATE
function createDealerMappingTemplate() {
  const headers = [
    'SAP Code', 'SFA Code', 'Dealer Name', 'Cust Type',
    'Area', 'Zone', 'Block',
    'SO Name', 'SO Emp Code', 'ASM Name', 'ASM Code',
    'RSM Name', 'RSM Code', 'ZH Name', 'ZH Code',
    'Counter Potential', 'DOA'
  ];

  const rows = [
    [
      '1000000638', 'S001', 'BANIK HARDWARE', 'STAR',
      'KOLKATA', 'EAST', 'SADAR',
      'SUBHASHIS KARMAKAR', 'SO9012', 'ANIMESH NATH', 'ASM401',
      'VIKASH KUMAR', 'RSM201', 'TARAK NATH GHOSH', 'ZH101',
      494, '01-Feb-05'
    ],
    [
      '1000000671', 'S002', 'SANDHYA HARDWARE STORES', 'STAR',
      'HOJAI', 'NORTH', 'HOJAI',
      'PRABHAS SARKAR', 'SO9015', 'ANIMESH NATH', 'ASM401',
      'VIKASH KUMAR', 'RSM201', 'TARAK NATH GHOSH', 'ZH101',
      160, '07-Feb-05'
    ],
    [
      '1000000669', 'S003', 'SAIKIA ENTERPRISE', 'STAR',
      'NAGAON', 'NORTH', 'KALIABOR',
      'BALARAM DAS', 'SO9018', 'ANIMESH NATH', 'ASM401',
      'VIKASH KUMAR', 'RSM201', 'TARAK NATH GHOSH', 'ZH101',
      670, '11-Jan-07'
    ]
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dealer Mapping');
  const file = path.join(outDir, '01_Dealer_Mapping_Template.xlsx');
  XLSX.writeFile(wb, file);
  console.log('Created:', file);
}

// 2. DEALER PERFORMANCE TEMPLATE
function createDealerPerformanceTemplate() {
  const headers = [
    'SAP', 'CODE', 'DEALERS NAME', 'AREA', 'REGION', 'DOA',
    'Targeted Dealer', 'EXCLUSIVE DEALER',
    "June'26 Tgt", 'Prorata Tgt',
    "June'26 SALE", "May'26 DEALER", "June-25 SALE",
    'Jan-26 SALE', 'Feb-26 SALE', 'Mar-26 SALE', 'Apr-26 SALE', 'May-26 SALE', 'Jun-26 SALE',
    'Last 6 Months Avg Sales'
  ];

  const rows = [
    [
      '1000000638', 'S001', 'BANIK HARDWARE', 'KOLKATA', 'EAST', '01-Feb-05',
      'Yes', 'Yes',
      25.00, 24.00,
      21.00, 20.00, 10.00,
      16.00, 17.00, 18.00, 19.00, 20.00, 21.00,
      18.50
    ],
    [
      '1000000671', 'S002', 'SANDHYA HARDWARE STORES', 'HOJAI', 'NORTH', '07-Feb-05',
      'Yes', 'No',
      15.00, 15.00,
      12.00, 14.00, 8.00,
      10.00, 11.00, 12.00, 13.00, 14.00, 12.00,
      12.00
    ],
    [
      '1000000669', 'S003', 'SAIKIA ENTERPRISE', 'NAGAON', 'NORTH', '11-Jan-07',
      'Yes', 'Yes',
      30.00, 28.00,
      25.00, 22.00, 15.00,
      18.00, 19.00, 20.00, 21.00, 22.00, 25.00,
      20.83
    ]
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dealer Performance');
  const file = path.join(outDir, '02_Dealer_Performance_Template.xlsx');
  XLSX.writeFile(wb, file);
  console.log('Created:', file);
}

// 3. SBG MASTER TEMPLATE
function createSbgMasterTemplate() {
  const headers = [
    'Customer Code', 'Dealer Name', 'Territory Code', 'Territory Name',
    'Block (Taluka)', 'Counter Potential Average (MT)', 'Zone',
    'SO Code', 'SO Name', 'ASM Code', 'ASM Name',
    'RSM Code', 'RSM Name', 'ZH Code', 'ZH Name',
    'Status in SAP', 'Dealer Start Date'
  ];

  const rows = [
    [
      '1000000638', 'BANIK HARDWARE', 'TR01', 'KOLKATA CENTRAL',
      'SADAR', 494.00, 'EAST',
      'SO9012', 'SUBHASHIS KARMAKAR', 'ASM401', 'ANIMESH NATH',
      'RSM201', 'VIKASH KUMAR', 'ZH101', 'TARAK NATH GHOSH',
      'ACTIVE', '01-Feb-05'
    ],
    [
      '1000000671', 'SANDHYA HARDWARE STORES', 'TR02', 'HOJAI TOWN',
      'HOJAI', 160.00, 'NORTH',
      'SO9015', 'PRABHAS SARKAR', 'ASM401', 'ANIMESH NATH',
      'RSM201', 'VIKASH KUMAR', 'ZH101', 'TARAK NATH GHOSH',
      'ACTIVE', '07-Feb-05'
    ],
    [
      '1000000669', 'SAIKIA ENTERPRISE', 'TR03', 'NAGAON RURAL',
      'KALIABOR', 670.00, 'NORTH',
      'SO9018', 'BALARAM DAS', 'ASM401', 'ANIMESH NATH',
      'RSM201', 'VIKASH KUMAR', 'ZH101', 'TARAK NATH GHOSH',
      'ACTIVE', '11-Jan-07'
    ]
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SBG Master');
  const file = path.join(outDir, '03_SBG_Master_Template.xlsx');
  XLSX.writeFile(wb, file);
  console.log('Created:', file);
}

// 4. SALES HISTORY (RSAR / ERP) TEMPLATE
function createSalesHistoryTemplate() {
  const headers = [
    'SAP Code', 'Sub Dealer Name', 'LinkedDealerCode', 'Linked Dealer Name', 'Zone',
    'Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26'
  ];

  const rows = [
    [
      '1000000638', 'BANIK HARDWARE', '1000000638', 'BANIK HARDWARE', 'EAST',
      16.00, 17.00, 18.00, 19.00, 20.00, 21.00
    ],
    [
      '1000000671', 'SANDHYA HARDWARE STORES', '1000000671', 'SANDHYA HARDWARE STORES', 'NORTH',
      10.00, 11.00, 12.00, 13.00, 14.00, 12.00
    ],
    [
      '1000000669', 'SAIKIA ENTERPRISE', '1000000669', 'SAIKIA ENTERPRISE', 'NORTH',
      18.00, 19.00, 20.00, 21.00, 22.00, 25.00
    ]
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sales History');
  const file = path.join(outDir, '04_Sales_History_RSAR_Template.xlsx');
  XLSX.writeFile(wb, file);
  console.log('Created:', file);
}

// 5. PROSPECT DEALERS TEMPLATE
function createProspectDealersTemplate() {
  const headers = [
    'Prospective Dealer Name', 'SFA Code', 'Zone', 'Area', 'Taluka',
    'Name of SO', 'SO Emp Code', 'Potential', 'Expected Sale', 'Status'
  ];

  const rows = [
    [
      'MAA DURGA HARDWARE', 'WBS197', 'EAST', 'MALDA', 'DAKSHIN DINAJPUR',
      'DIPANKAR MAHATO', 'SO9020', 20.00, 15.00, 'PROSPECTIVE'
    ],
    [
      'S S ENTERPRISE', 'WBS198', 'EAST', 'MALDA', 'MALDA TOWN',
      'SUBHASHIS KARMAKAR', 'SO9012', 25.00, 18.00, 'PROSPECTIVE'
    ],
    [
      'NEW ASSAM BUILDMART', 'AS005', 'NORTH', 'NAGAON', 'KALIABOR',
      'BALARAM DAS', 'SO9018', 30.00, 20.00, 'PROSPECTIVE'
    ]
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Prospect Dealers');
  const file = path.join(outDir, '05_Prospect_Dealers_Template.xlsx');
  XLSX.writeFile(wb, file);
  console.log('Created:', file);
}

createDealerMappingTemplate();
createDealerPerformanceTemplate();
createSbgMasterTemplate();
createSalesHistoryTemplate();
createProspectDealersTemplate();
console.log('\nAll 5 exact templates created successfully in /templates directory.');
