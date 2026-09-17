const MONTH_MAP = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06',
  jul: '07', july: '07', aug: '08', august: '08', sep: '09', sept: '09', september: '09',
  oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12'
};

export function parseDOA(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number') {
    if (isNaN(val) || val <= 0) return null;
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return null;
  }
  const s = String(val).trim();
  if (!s || s === '-' || s.toLowerCase() === 'null' || s.toLowerCase() === 'na' || s.toLowerCase() === 'n/a') return null;

  const num = parseFloat(s);
  if (!isNaN(num) && /^\d+(\.\d+)?$/.test(s) && num > 1000 && num < 100000) {
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  const parts = s.split(/[-/\s.]+/).filter(Boolean);
  if (parts.length === 3) {
    // Check if parts[1] is month name: e.g. 01-Feb-05 or 1-Feb-2005
    const m1 = MONTH_MAP[parts[1].toLowerCase().slice(0, 3)];
    if (m1) {
      const day = parts[0].padStart(2, '0');
      let year = parts[2];
      if (year.length === 2) {
        const yy = parseInt(year, 10);
        year = yy <= 69 ? '20' + year.padStart(2, '0') : '19' + year.padStart(2, '0');
      }
      return `${year}-${m1}-${day}`;
    }

    // Check if parts[0] is month name: e.g. Feb-01-05
    const m0 = MONTH_MAP[parts[0].toLowerCase().slice(0, 3)];
    if (m0) {
      const day = parts[1].padStart(2, '0');
      let year = parts[2];
      if (year.length === 2) {
        const yy = parseInt(year, 10);
        year = yy <= 69 ? '20' + year.padStart(2, '0') : '19' + year.padStart(2, '0');
      }
      return `${year}-${m0}-${day}`;
    }

    // All numeric parts
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      const year = parts[0];
      const month = parts[1].padStart(2, '0');
      const day = parts[2].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // DD-MM-YYYY or DD-MM-YY (Indian standard)
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    let year = parts[2];
    if (year.length === 2) {
      const yy = parseInt(year, 10);
      year = yy <= 69 ? '20' + year.padStart(2, '0') : '19' + year.padStart(2, '0');
    }
    return `${year}-${month}-${day}`;
  }

  // Fallback to ISO string if parsable by Date
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return null;
}

const samples = [
  '01-Feb-05', '07-Feb-05', '18-May-05', '11-Jan-07', '24-Jun-07',
  '09-May-11', '04-Oct-12', '03-May-13', '01-Jun-14', '15-Oct-14',
  '13-Feb-15', '19-Mar-16', '28-Mar-17', '17-Apr-17', '24-Apr-17',
  '28-Jun-17', '01-Feb-18', '23-Feb-18', '01-Jan-2024', 38384,
  '2024-05-15', '15/05/2024', '15-05-24', null, '-', 'N/A'
];

samples.forEach(s => console.log(s, '=>', parseDOA(s)));
