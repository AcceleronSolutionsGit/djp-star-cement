import { dbAll } from '../config/database.js';

export async function checkMissedVisitsForDealer(dealerCode, soEmpCode) {
  // Check if there was a planned visit in execution logs that was non-productive or missed
  const logs = await dbAll(
    'SELECT * FROM visit_execution_logs WHERE (customer_code = ? OR employee_code = ?) AND visit_status LIKE "%Non productive%" ORDER BY visit_date DESC LIMIT 5',
    [dealerCode, soEmpCode]
  );

  if (logs && logs.length > 0) {
    return {
      isMissed: true,
      missedCount: logs.length,
      reason: `Dealer had ${logs.length} non-productive / missed visits in previous cycle`
    };
  }

  return { isMissed: false, missedCount: 0, reason: null };
}
