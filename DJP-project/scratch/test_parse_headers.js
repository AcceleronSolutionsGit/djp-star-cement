import { parseMonthKey } from '../src/imports/sales-history.importer.js';

const headers = [
  'REGION', 'AREA', 'CODE', 'SAP', 'DEALERS NAME', 'DOA',
  'Targeted Dealer', 'EXCLUSIVE DEALER', "June'26 Tgt", 'Prorata Tgt',
  '30-Jun-26', 'Shortfall', 'Prorata Achv %', "June'26 SALE",
  "May'26 DEALER", "June'26 SALE", 'VARIENCE', 'GROWTH %',
  'June-26 Vs May-26', 'June-25 SALE', 'May-25 Dealer', 'June-25 SALE',
  'LYSM VARIENCE', 'LYSM GROWTH %', 'June-25 SALE', 'Jan-26 SALE',
  'Feb-26 SALE', 'Mar-26 SALE', 'Apr-26 SALE', 'May-26 SALE',
  'Jun-26 SALE', 'Last 6 Months Avg Sales'
];

for (const h of headers) {
  const res = parseMonthKey(h);
  console.log(h.padEnd(25), '=>', res);
}
