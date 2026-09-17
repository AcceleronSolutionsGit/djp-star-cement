import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../upload-files');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ──────────────────────────────────────────────
// 1. DEALER MAPPING SAMPLE
// ──────────────────────────────────────────────
const mappingHeaders = [
  'Zone', 'Cust Type', 'Area', 'Block', 'ZONAL HEAD', 'RSM', 'ASM', 'SO/SE NAME', 'DEALER NAME', 'Customer CODE'
];

const mappingRows = [
  // 8 Star Control Dealers
  ['NE1', 'STAR', 'NAGAON', 'NAGAON', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'BALARAM DAS', 'SAIKIA ENTERPRISE', '1000000669'],
  ['NE1', 'STAR', 'HOJAI', 'LUMDING', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'PRABHAS SARKAR', 'KALPANA HARDWARE-NGN', '1000001034'],
  ['NE1', 'STAR', 'AP - LIKABALI', 'PASIGHAT', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'SATYAJIT SAHA', 'TOPO TAKEK MARDE', 'NUNG ENTERPRISE', '1000002747'],
  ['NE1', 'STAR', 'HOJAI', 'DOBOKA', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'BIREN MAZUMDER', 'BABU HARDWARE', '1000003202'],
  ['NE1', 'STAR', 'KARBI ANGLONG', 'BAKULIA', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'ISHAN SAHA', 'J.D. HARDWARE', '1000003596'],
  ['NE1', 'STAR', 'HOJAI', 'LUMDING', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'PRABHAS SARKAR', 'SANDHYA HARDWARE STORES', '1000000671'],
  ['NE1', 'STAR', 'KARBI ANGLONG', 'MANJA', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'ISHAN SAHA', 'SWASTIK HARDWARE STORE', '1000003532'],
  ['NE2', 'STAR', 'DARANG', 'BHERGAON', 'BRIJESH SINGH', 'SAURABH KUMAR', 'HEMONTA HAZARIKA', 'SUBHAM SEN', 'BISWAKARMA HARDWARE', '1000003497'],

  // Nagaon Benchmarks (Saikia 52 MT ranks in 40-60% bracket => Grade B)
  ['NE1', 'STAR', 'NAGAON', 'NAGAON', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'BALARAM DAS', 'PRIME CEMENT TRADERS', '1000009001'],
  ['NE1', 'STAR', 'NAGAON', 'NAGAON', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'BALARAM DAS', 'ASSAM HARDWARE MART', '1000009002'],

  // Hojai Benchmarks (Kalpana 140 MT in 40-60% => Grade B, Babu 20 MT & Sandhya 0 MT => Grade D)
  ['NE1', 'STAR', 'HOJAI', 'HOJAI', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'PRABHAS SARKAR', 'HOJAI MEGA BUILDERS', '1000009011'],
  ['NE1', 'STAR', 'HOJAI', 'HOJAI', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'PRABHAS SARKAR', 'EASTERN CEMENT CORP', '1000009012'],
  ['NE1', 'STAR', 'HOJAI', 'HOJAI', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'PRABHAS SARKAR', 'MAHESHWARI TRADERS', '1000009013'],

  // AP - Likabali Benchmarks (Nung 60 MT => Grade D)
  ['NE1', 'STAR', 'AP - LIKABALI', 'PASIGHAT', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'SATYAJIT SAHA', 'TOPO TAKEK MARDE', 'ARUNACHAL APEX STORE', '1000009021'],
  ['NE1', 'STAR', 'AP - LIKABALI', 'PASIGHAT', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'SATYAJIT SAHA', 'TOPO TAKEK MARDE', 'VALLEY BUILDTECH', '1000009022'],
  ['NE1', 'STAR', 'AP - LIKABALI', 'PASIGHAT', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'SATYAJIT SAHA', 'TOPO TAKEK MARDE', 'HIMALAYAN TRADERS', '1000009023'],

  // Karbi Anglong Benchmarks (J.D. 0 MT & Swastik 0 MT => Grade D)
  ['NE1', 'STAR', 'KARBI ANGLONG', 'DIPHU', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'ISHAN SAHA', 'DIPHU INFRA SUPPLIERS', '1000009031'],
  ['NE1', 'STAR', 'KARBI ANGLONG', 'DIPHU', 'TARAK NATH GHOSH', 'VIKASH KUMAR', 'ANIMESH NATH', 'ISHAN SAHA', 'HILLS HARDWARE DEPOT', '1000009032'],

  // Darang Benchmarks (Biswakarma 26 MT ranks in 20-40% => Grade C)
  ['NE2', 'STAR', 'DARANG', 'MANGALDAI', 'BRIJESH SINGH', 'SAURABH KUMAR', 'HEMONTA HAZARIKA', 'SUBHAM SEN', 'MANGALDAI CEMENT AGENCY', '1000009041'],
  ['NE2', 'STAR', 'DARANG', 'MANGALDAI', 'BRIJESH SINGH', 'SAURABH KUMAR', 'HEMONTA HAZARIKA', 'SUBHAM SEN', 'BHERGAON CENTRAL STORE', '1000009042'],

  // Malda Benchmarks (S S Enterprise 8 MT => Grade D)
  ['NB-2', 'STAR', 'MALDA', 'ENGLISH BAZAR', 'BRIJESH SINGH', 'GHALIB FAROOQUE', 'SUBHAJIT ROY', 'SUBHASHIS KARMAKAR', 'MALDA CEMENT SYNDICATE', '1000009051'],
  ['NB-2', 'STAR', 'MALDA', 'ENGLISH BAZAR', 'BRIJESH SINGH', 'GHALIB FAROOQUE', 'SUBHAJIT ROY', 'SUBHASHIS KARMAKAR', 'GOUR ENTERPRISES', '1000009052'],

  // Dakshin Dinajpur Benchmarks (Maa Durga 8 MT => Grade D)
  ['NB-2', 'STAR', 'DAKSHIN DINAJPUR', 'BALURGHAT', 'BRIJESH SINGH', 'GHALIB FAROOQUE', 'SUBHAJIT ROY', 'DIPANKAR MAHATO', 'BALURGHAT TRADING CO', '1000009061'],
  ['NB-2', 'STAR', 'DAKSHIN DINAJPUR', 'BALURGHAT', 'BRIJESH SINGH', 'GHALIB FAROOQUE', 'SUBHAJIT ROY', 'DIPANKAR MAHATO', 'DINAJPUR BUILDMART', '1000009062']
];

const mappingWb = XLSX.utils.book_new();
const mappingWs = XLSX.utils.aoa_to_sheet([mappingHeaders, ...mappingRows]);
XLSX.utils.book_append_sheet(mappingWb, mappingWs, 'Dealer Mapping');
const mappingFile = path.join(uploadDir, 'Sample_Dealer_Mapping.xlsx');
XLSX.writeFile(mappingWb, mappingFile);
console.log('Created:', mappingFile);


// ──────────────────────────────────────────────
// 2. PROSPECT DEALERS SAMPLE
// ──────────────────────────────────────────────
const prospectHeaders = [
  'SFA CODE', 'NAME OF PROSPECT DEALER', 'DISTRICT', 'BRANCH/TERRITORY/AREA', 'BLOCK', 'SO NAME', 'SO EMP CODE', 'TOTAL COUNTER POTENTIAL'
];

const prospectRows = [
  ['WBS197', 'S S ENTERPRISE', 'MALDA', 'MALDA', 'ENGLISH BAZAR', 'SUBHASHIS KARMAKAR', '1100123', 20],
  ['NSRE19295', 'MAA DURGA HARDWARE', 'DAKSHIN DINAJPUR', 'DAKSHIN DINAJPUR', 'BALURGHAT', 'DIPANKAR MAHATO', '1100456', 20]
];

const prospectWb = XLSX.utils.book_new();
const prospectWs = XLSX.utils.aoa_to_sheet([prospectHeaders, ...prospectRows]);
XLSX.utils.book_append_sheet(prospectWb, prospectWs, 'Prospects');
const prospectFile = path.join(uploadDir, 'Sample_Prospect_Dealers.xlsx');
XLSX.writeFile(prospectWb, prospectFile);
console.log('Created:', prospectFile);


// ──────────────────────────────────────────────
// 3. SALES HISTORY SAMPLE
// ──────────────────────────────────────────────
const months = [
  'Apr-24', 'May-24', 'Jun-24', 'Jul-24', 'Aug-24', 'Sep-24', 'Oct-24', 'Nov-24', 'Dec-24',
  'Jan-25', 'Feb-25', 'Mar-25', 'Apr-25', 'May-25', 'Jun-25', 'Jul-25', 'Aug-25', 'Sep-25',
  'Oct-25', 'Nov-25', 'Dec-25', 'Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26'
];

const salesHeaders = [
  'SAP Code', 'RSSD Code', 'Sub Dealer Name', 'Linked Dealer code', 'Linked Dealer Name', 'Branch as per RSSD Master', 'Zone',
  ...months
];

function generateMonthlySales(may26, apr26, lysmMay25, avg6) {
  const sales = new Array(27).fill(avg6);
  sales[13] = lysmMay25; // May-25 (LYSM)
  sales[24] = apr26;     // Apr-26
  sales[25] = may26;     // May-26
  sales[26] = Math.round(may26 * 0.9); // Jun-26
  return sales;
}

const salesRows = [
  // 8 Star Control Dealers
  ['1500005563', 'RSSR277', 'R.K. BORA STORE', '1000000669', 'SAIKIA ENTERPRISE', 'NAGAON', 'NE1', ...generateMonthlySales(52, 45, 40, 48)],
  ['1500016605', 'RSSH256', 'LUMDING HARDWARE', '1000001034', 'KALPANA HARDWARE-NGN', 'HOJAI', 'NE1', ...generateMonthlySales(140, 110, 100, 120)],
  ['1500017890', 'RSSA101', 'PASIGHAT STORE', '1000002747', 'NUNG ENTERPRISE', 'AP - LIKABALI', 'NE1', ...generateMonthlySales(60, 55, 50, 58)],
  ['1500014317', 'RSSI074', 'ISLAM STORE HARDWARE', '1000003202', 'BABU HARDWARE', 'HOJAI', 'NE1', ...generateMonthlySales(20, 25, 35, 28)],
  ['1500018921', 'RSSB202', 'BAKULIA BUILDERS', '1000003596', 'J.D. HARDWARE', 'KARBI ANGLONG', 'NE1', ...generateMonthlySales(0, 0, 0, 15)],
  ['1500019234', 'RSSS303', 'SANDHYA TRADERS', '1000000671', 'SANDHYA HARDWARE STORES', 'HOJAI', 'NE1', ...generateMonthlySales(0, 0, 0, 12)],
  ['1500019555', 'RSSM404', 'MANJA STORE', '1000003532', 'SWASTIK HARDWARE STORE', 'KARBI ANGLONG', 'NE1', ...generateMonthlySales(0, 0, 0, 18)],
  ['1500019888', 'RSSD505', 'BHERGAON MART', '1000003497', 'BISWAKARMA HARDWARE', 'DARANG', 'NE2', ...generateMonthlySales(26, 22, 20, 24)],

  // Nagaon Benchmarks (total Nagaon volume = 60 + 50 + 52 = 162 MT. Saikia is rank 2 with 52 MT => (50+52)/162 = 63% > 40% => Grade B!)
  ['1500099001', 'RSSN001', 'PRIME CEMENT TRADERS', '1000009001', 'PRIME CEMENT TRADERS', 'NAGAON', 'NE1', ...generateMonthlySales(60, 55, 50, 55)],
  ['1500099002', 'RSSN002', 'ASSAM HARDWARE MART', '1000009002', 'ASSAM HARDWARE MART', 'NAGAON', 'NE1', ...generateMonthlySales(50, 48, 45, 48)],

  // Hojai Benchmarks (Total volume = 170 + 100 + 70 + 140(Kalpana) + 20(Babu) + 8(Sandhya) = 508 MT. Kalpana is rank 2 => 47% => Grade B!)
  ['1500099011', 'RSSH011', 'HOJAI MEGA BUILDERS', '1000009011', 'HOJAI MEGA BUILDERS', 'HOJAI', 'NE1', ...generateMonthlySales(170, 160, 150, 165)],
  ['1500099012', 'RSSH012', 'EASTERN CEMENT CORP', '1000009012', 'EASTERN CEMENT CORP', 'HOJAI', 'NE1', ...generateMonthlySales(100, 95, 90, 95)],
  ['1500099013', 'RSSH013', 'MAHESHWARI TRADERS', '1000009013', 'MAHESHWARI TRADERS', 'HOJAI', 'NE1', ...generateMonthlySales(70, 65, 60, 65)],

  // AP - Likabali Benchmarks (Total = 150 + 120 + 95 + 60(Nung) = 425 MT. Nung is rank 4 => 14% => Grade D!)
  ['1500099021', 'RSSA021', 'ARUNACHAL APEX STORE', '1000009021', 'ARUNACHAL APEX STORE', 'AP - LIKABALI', 'NE1', ...generateMonthlySales(150, 140, 130, 145)],
  ['1500099022', 'RSSA022', 'VALLEY BUILDTECH', '1000009022', 'VALLEY BUILDTECH', 'AP - LIKABALI', 'NE1', ...generateMonthlySales(120, 110, 100, 115)],
  ['1500099023', 'RSSA023', 'HIMALAYAN TRADERS', '1000009023', 'HIMALAYAN TRADERS', 'AP - LIKABALI', 'NE1', ...generateMonthlySales(95, 90, 85, 90)],

  // Karbi Anglong Benchmarks (Total = 120 + 90 + 10(J.D.) + 12(Swastik) = 232 MT. J.D. & Swastik => < 20% => Grade D!)
  ['1500099031', 'RSSK031', 'DIPHU INFRA SUPPLIERS', '1000009031', 'DIPHU INFRA SUPPLIERS', 'KARBI ANGLONG', 'NE1', ...generateMonthlySales(120, 110, 100, 115)],
  ['1500099032', 'RSSK032', 'HILLS HARDWARE DEPOT', '1000009032', 'HILLS HARDWARE DEPOT', 'KARBI ANGLONG', 'NE1', ...generateMonthlySales(90, 85, 80, 85)],

  // Darang Benchmarks (Total = 60 + 40 + 26(Biswakarma) = 126 MT. Biswakarma is rank 3 => 26/126 = 20.6% => Grade C!)
  ['1500099041', 'RSSD041', 'MANGALDAI CEMENT AGENCY', '1000009041', 'MANGALDAI CEMENT AGENCY', 'DARANG', 'NE2', ...generateMonthlySales(60, 55, 50, 55)],
  ['1500099042', 'RSSD042', 'BHERGAON CENTRAL STORE', '1000009042', 'BHERGAON CENTRAL STORE', 'DARANG', 'NE2', ...generateMonthlySales(40, 38, 35, 38)],

  // Malda Benchmarks (Total = 140 + 100 + 8(S S Ent) = 248 MT. S S Ent is rank 3 => 3.2% => Grade D!)
  ['1500099051', 'RSSM051', 'MALDA CEMENT SYNDICATE', '1000009051', 'MALDA CEMENT SYNDICATE', 'MALDA', 'NB-2', ...generateMonthlySales(140, 130, 120, 135)],
  ['1500099052', 'RSSM052', 'GOUR ENTERPRISES', '1000009052', 'GOUR ENTERPRISES', 'MALDA', 'NB-2', ...generateMonthlySales(100, 95, 90, 95)],

  // Dakshin Dinajpur Benchmarks (Total = 130 + 95 + 8(Maa Durga) = 233 MT. Maa Durga is rank 3 => 3.4% => Grade D!)
  ['1500099061', 'RSSD061', 'BALURGHAT TRADING CO', '1000009061', 'BALURGHAT TRADING CO', 'DAKSHIN DINAJPUR', 'NB-2', ...generateMonthlySales(130, 120, 110, 125)],
  ['1500099062', 'RSSD062', 'DINAJPUR BUILDMART', '1000009062', 'DINAJPUR BUILDMART', 'DAKSHIN DINAJPUR', 'NB-2', ...generateMonthlySales(95, 90, 85, 90)]
];

const salesWb = XLSX.utils.book_new();
const salesWs = XLSX.utils.aoa_to_sheet([salesHeaders, ...salesRows]);
XLSX.utils.book_append_sheet(salesWb, salesWs, 'Sales History');
const salesFile = path.join(uploadDir, 'Sample_Sales_History.xlsx');
XLSX.writeFile(salesWb, salesFile);
console.log('Created:', salesFile);

console.log('\n✅ Small Sample Test Kit Generated!');
