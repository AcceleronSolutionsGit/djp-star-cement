/** Stub for engines/sfa-adherence.engine.js */
import { calls } from './__stub_state.js';
export async function analyseC1Adherence(periodMonth) {
  calls.order.push(`adherence:${periodMonth}`);
  const byEmployee = new Map([['11001774', { completed: [], missed: [{ dealer_sap_code: '1000001153', dealer_name: 'R P ENTERPRISE' }] }]]);
  return { periodMonth, byEmployee, completedDealers: [], missedDealers: [{ dealer_sap_code: '1000001153' }],
           plannedCount: 33, completedCount: 8, missedCount: 6, adherencePct: 24 };
}
export function getAdherenceForEmployee() { return { visitedDealerCodes: new Set(), missedDealerCodes: new Set() }; }
