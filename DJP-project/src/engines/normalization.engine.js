/**
 * Data Normalization Engine
 * 
 * Provides a single source of truth for normalizing dealer names, areas, blocks,
 * and identifiers to ensure consistent matching across all importers.
 */

/**
 * Normalizes a general string (e.g., Dealer Name, Area, Block).
 * - Trims whitespace
 * - Collapses multiple spaces into single space
 * - Converts to uppercase
 * - Replaces "&" with "AND"
 * - Removes common punctuation that causes mismatch (.,-)
 * - Preserves alphanumerics and spaces
 */
export function normalizeString(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).trim();
  if (s === '') return null;

  return s
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[.,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes SAP/SFA/Customer Codes.
 * - Trims whitespace
 * - Ensures it's a string, not a float (Excel scientific notation edge cases)
 * - Converts to uppercase
 */
export function normalizeCode(code) {
  if (code === null || code === undefined) return null;
  const s = String(code).trim();
  if (s === '' || s === '-') return null;

  // If it's a number, make sure there's no decimal ".0"
  if (!isNaN(s) && s.includes('.')) {
    return s.split('.')[0];
  }

  return s.toUpperCase();
}

/**
 * Normalizes dealer/customer names.
 */
export function normalizeName(name) {
  return normalizeString(name);
}

/**
 * Normalizes branch names.
 */
export function normalizeBranch(branch) {
  return normalizeString(branch);
}

/**
 * Normalizes region/zone names.
 */
export function normalizeRegion(region) {
  if (region === null || region === undefined) return null;
  const s = String(region).trim();
  if (s === '' || s === '-') return null;
  return s.toUpperCase().replace(/\s+/g, ' ').trim();
}

const DOA_MONTH_MAP = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12'
};

/**
 * Parses DOA (Date of Activation) from any format:
 * - Excel Date objects (with UTC safe adjustment)
 * - Excel serial date numbers (e.g. 38384 -> 2005-02-01)
 * - DD-MMM-YY (e.g. 01-Feb-05 -> 2005-02-01)
 * - DD-MMM-YYYY (e.g. 01-Feb-2005 -> 2005-02-01)
 * - DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
 * Returns canonical 'YYYY-MM-DD' or null.
 */
export function parseDOA(val) {
  if (val === null || val === undefined || val === '') return null;

  // 1. JavaScript Date object (e.g., from XLSX { cellDates: true })
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    // Add 12 hours so midnight-anchored dates with historical or timezone shifts land in the correct UTC calendar day
    const adjusted = new Date(val.getTime() + 12 * 3600 * 1000);
    const y = adjusted.getUTCFullYear();
    const m = String(adjusted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(adjusted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 2. Pure number (Excel serial date)
  if (typeof val === 'number') {
    if (isNaN(val) || val <= 0) return null;
    // Excel epoch: Dec 30, 1899 (serial 25569 = Jan 1, 1970)
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
  if (!s || s === '-' || s.toLowerCase() === 'null' || s.toLowerCase() === 'na' || s.toLowerCase() === 'n/a' || s === '0000-00-00') {
    return null;
  }

  // 3. String that is numeric (e.g. '38384')
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

  // 4. Split by common date delimiters
  const parts = s.split(/[-/\s.]+/).filter(Boolean);
  if (parts.length === 3) {
    // 4a. Middle part is month name: e.g. 01-Feb-05, 01-Feb-2005, 18-May-05
    const m1 = DOA_MONTH_MAP[parts[1].toLowerCase().slice(0, 3)];
    if (m1) {
      const day = parts[0].padStart(2, '0');
      let year = parts[2];
      if (year.length === 2) {
        const yy = parseInt(year, 10);
        year = yy <= 69 ? '20' + year.padStart(2, '0') : '19' + year.padStart(2, '0');
      }
      return `${year}-${m1}-${day}`;
    }

    // 4b. First part is month name: e.g. Feb-01-05
    const m0 = DOA_MONTH_MAP[parts[0].toLowerCase().slice(0, 3)];
    if (m0) {
      const day = parts[1].padStart(2, '0');
      let year = parts[2];
      if (year.length === 2) {
        const yy = parseInt(year, 10);
        year = yy <= 69 ? '20' + year.padStart(2, '0') : '19' + year.padStart(2, '0');
      }
      return `${year}-${m0}-${day}`;
    }

    // 4c. All numeric: YYYY-MM-DD
    if (parts[0].length === 4) {
      const year = parts[0];
      const month = parts[1].padStart(2, '0');
      const day = parts[2].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // 4d. All numeric: DD-MM-YYYY or DD-MM-YY (Indian standard)
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    let year = parts[2];
    if (year.length === 2) {
      const yy = parseInt(year, 10);
      year = yy <= 69 ? '20' + year.padStart(2, '0') : '19' + year.padStart(2, '0');
    }
    return `${year}-${month}-${day}`;
  }

  // 5. Fallback Date constructor
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const adjusted = new Date(d.getTime() + 12 * 3600 * 1000);
    const y = adjusted.getUTCFullYear();
    const m = String(adjusted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(adjusted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return null;
}

