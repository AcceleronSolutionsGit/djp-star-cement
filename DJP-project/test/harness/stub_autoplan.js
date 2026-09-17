/** Stub for engines/autoPlanGenerator.js — records who was asked, with what options. */
import { calls } from './__stub_state.js';
import { dbRun } from '../config/database.js';
export class AutoPlanGenerator {
  async generatePlan(empCode, periodMonth, role, cycleCode, options = {}) {
    calls.order.push(`plan:${role}:${cycleCode}`);
    calls.plans.push({ empCode, role, cycleCode, periodMonth, opts: options });
    const r = await dbRun(
      `INSERT INTO sales_plans (emp_code, emp_name, period_month, cycle_code, status, emp_role)
       VALUES (?, ?, ?, ?, 'DRAFT', ?)`,
      [empCode, `EMP ${empCode}`, periodMonth, cycleCode, role]
    );
    return { success: true, planId: r.insertId, totalVisitsScheduled: 2, totalDealers: 1 };
  }
}
