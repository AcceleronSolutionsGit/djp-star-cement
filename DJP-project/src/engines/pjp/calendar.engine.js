/**
 * PJP Calendar Engine
 * 
 * Unified calendar service for working day calculations.
 * Consistently handles Sundays, 2nd Saturdays, 4th Saturdays, configured holidays.
 */

/**
 * Check if a given Saturday is the Nth Saturday of its month.
 * @param {Date} date 
 * @returns {number} nth occurrence (1-5)
 */
function getNthSaturday(date) {
  return Math.ceil(date.getDate() / 7);
}

/**
 * Check if a date is a working day.
 * Excludes: Sundays, 2nd Saturday, 4th Saturday, configured holidays.
 * 
 * @param {Date} date 
 * @param {Object} options
 * @param {boolean} options.excludeSundays - default true
 * @param {boolean} options.exclude2ndSaturday - default true
 * @param {boolean} options.exclude4thSaturday - default true
 * @param {Set<string>} options.holidays - set of YYYY-MM-DD strings
 * @returns {boolean}
 */
export function isWorkingDay(date, options = {}) {
  const {
    excludeSundays = true,
    exclude2ndSaturday = true,
    exclude4thSaturday = true,
    holidays = new Set()
  } = options;

  const day = date.getDay(); // 0=Sun, 6=Sat

  // Sunday
  if (excludeSundays && day === 0) return false;

  // 2nd and 4th Saturday
  if (day === 6) {
    const nth = getNthSaturday(date);
    if (exclude2ndSaturday && nth === 2) return false;
    if (exclude4thSaturday && nth === 4) return false;
  }

  // Configured holidays
  const dateStr = formatDate(date);
  if (holidays.has(dateStr)) return false;

  return true;
}

/**
 * Format a Date object as YYYY-MM-DD string.
 * @param {Date} date 
 * @returns {string}
 */
export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get all working days for a given period month and cycle.
 * 
 * @param {string} periodMonth - YYYY-MM
 * @param {string} cycleCode - 'C1' or 'C2'
 * @param {Object} cycleConfig - { c1StartDay, c1EndDay, c2StartDay, c2EndDay }
 * @param {Object} calendarOptions - passed to isWorkingDay
 * @returns {string[]} array of YYYY-MM-DD date strings
 */
export function getWorkingDays(periodMonth, cycleCode, cycleConfig = {}, calendarOptions = {}) {
  const {
    c1StartDay = 1,
    c1EndDay = 15,
    c2StartDay = 16,
    c2EndDay = 31
  } = cycleConfig;

  const [yearStr, monthStr] = periodMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // 0-indexed

  const startDay = cycleCode === 'C1' ? c1StartDay : c2StartDay;
  const endDayConfig = cycleCode === 'C1' ? c1EndDay : c2EndDay;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const actualEndDay = Math.min(endDayConfig, daysInMonth);

  const workingDays = [];
  for (let d = startDay; d <= actualEndDay; d++) {
    const date = new Date(year, month, d);
    if (isWorkingDay(date, calendarOptions)) {
      workingDays.push(formatDate(date));
    }
  }

  return workingDays;
}

/**
 * Get cycle date boundaries.
 * 
 * @param {string} periodMonth - YYYY-MM
 * @param {string} cycleCode - 'C1' or 'C2'
 * @param {Object} cycleConfig 
 * @returns {Object} { startDate, endDate }
 */
export function getCycleDates(periodMonth, cycleCode, cycleConfig = {}) {
  const {
    c1StartDay = 1,
    c1EndDay = 15,
    c2StartDay = 16,
    c2EndDay = 31
  } = cycleConfig;

  const [yearStr, monthStr] = periodMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;

  const startDay = cycleCode === 'C1' ? c1StartDay : c2StartDay;
  const endDayConfig = cycleCode === 'C1' ? c1EndDay : c2EndDay;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const actualEndDay = Math.min(endDayConfig, daysInMonth);

  return {
    startDate: formatDate(new Date(year, month, startDay)),
    endDate: formatDate(new Date(year, month, actualEndDay))
  };
}
