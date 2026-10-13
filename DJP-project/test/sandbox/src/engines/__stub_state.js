/** Shared recorder for the pipeline stubs. */
export const calls = { order: [], plans: [], purged: [] };

export function reset() {
  calls.order.length = 0;
  calls.plans.length = 0;
  calls.purged.length = 0;
}
