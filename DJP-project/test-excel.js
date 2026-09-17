import XLSX from 'xlsx';
const workbook = XLSX.readFile('upload-files/file-1788252097750-250951342.xlsx');
console.log(workbook.SheetNames);
