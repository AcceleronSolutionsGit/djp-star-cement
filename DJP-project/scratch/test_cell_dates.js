import XLSX from 'xlsx';

const wbDates = XLSX.readFile('upload-files/file-1788945377913-432571350.xlsx', { cellDates: true });
const sDates = wbDates.Sheets['DLRWISE'];
for (let r = 2; r <= 15; r++) {
  const cell = sDates[XLSX.utils.encode_cell({ r, c: 5 })];
  const d = cell.v;
  const adjusted = new Date(d.getTime() + 12 * 3600 * 1000);
  const utcStr = adjusted.toISOString().split('T')[0];
  console.log(r, cell.w, '-> adjusted UTC:', utcStr);
}
