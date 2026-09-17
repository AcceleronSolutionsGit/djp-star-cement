/**
 * Churn Risk Controller
 *
 * Calculates churn probability scores for all non-Churn dealers
 * based on sales trends and visit history.
 *
 * Scoring model (0–100):
 *   +40  currentSales == 0
 *   +30  previousSales == 0
 *   +20  currentSales < sixMonthAverage × 0.20  (deep decline)
 *   +10  no SFA visit logged in last 30 days
 *
 * riskLevel:
 *   score >= 70 → High
 *   score >= 40 → Medium
 *   score <  40 → Low
 */

import { dbAll } from '../config/database.js';

/**
 * GET /api/reports/churn-risk
 * Full ranked list of at-risk dealers (excluding confirmed Churn).
 * 
 * Query params:
 *   area, soName, asmName, riskLevel ('High'|'Medium'|'Low')
 *   periodMonth (YYYY-MM, defaults to latest)
 *   limit (default 100), offset (default 0)
 */
export async function getChurnRiskList(req, res) {
  try {
    const { area, soName, asmName, riskLevel, limit = 100, offset = 0 } = req.query;
    let { periodMonth } = req.query;

    // Default to latest period_month in dealer_visit_targets
    if (!periodMonth) {
      const latest = await dbAll("SELECT period_month FROM dealer_visit_targets ORDER BY period_month DESC LIMIT 1");
      periodMonth = latest[0]?.period_month || null;
    }

    // Load dealer visit targets excluding confirmed Churn
    let dealerQuery = `
      SELECT
        dvt.dealer_name,
        dvt.sap_code,
        dvt.sfa_code,
        dvt.area,
        dvt.zone,
        dvt.so_name,
        dvt.so_emp_code,
        dvt.asm_name,
        dvt.asm_code,
        dvt.current_sales,
        dvt.previous_sales,
        dvt.rsar_six_month_avg,
        dvt.dp_six_month_avg,
        dvt.dealer_status,
        dvt.grade,
        dvt.period_month
      FROM dealer_visit_targets dvt
      WHERE dvt.dealer_status != 'Churn'
    `;
    const params = [];

    if (periodMonth) {
      dealerQuery += ' AND dvt.period_month = ?';
      params.push(periodMonth);
    }
    if (area) {
      dealerQuery += ' AND dvt.area = ?';
      params.push(area);
    }
    if (soName) {
      dealerQuery += ' AND dvt.so_name LIKE ?';
      params.push(`%${soName}%`);
    }
    if (asmName) {
      dealerQuery += ' AND dvt.asm_name LIKE ?';
      params.push(`%${asmName}%`);
    }

    const dealers = await dbAll(dealerQuery, params);

    // Load visit log counts per dealer (last 30 days) in one query
    const visitCounts = await dbAll(`
      SELECT customer_code, COUNT(*) as visit_count
      FROM visit_execution_logs
      WHERE visit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND visit_status = 'VISITED'
      GROUP BY customer_code
    `);
    const visitCountMap = new Map(visitCounts.map(v => [v.customer_code, v.visit_count]));

    // Score each dealer
    const scored = dealers.map(d => {
      const cm = Number(d.current_sales) || 0;
      const pm = Number(d.previous_sales) || 0;
      const avg6m = Number(d.rsar_six_month_avg) || Number(d.dp_six_month_avg) || 0;

      const recentVisits = visitCountMap.get(d.sap_code) ||
                            visitCountMap.get(d.sfa_code) || 0;

      let score = 0;
      const reasons = [];

      if (cm === 0) {
        score += 40;
        reasons.push('Current month sales = 0');
      }
      if (pm === 0) {
        score += 30;
        reasons.push('Previous month sales = 0');
      }
      if (avg6m > 0 && cm < avg6m * 0.20) {
        score += 20;
        reasons.push(`Sales dropped to < 20% of 6-month avg (CM=${cm}, 6M avg=${avg6m.toFixed(0)})`);
      }
      if (recentVisits === 0) {
        score += 10;
        reasons.push('No SFA visit in last 30 days');
      }

      const riskLevel = score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low';

      return {
        dealer_name: d.dealer_name,
        sap_code: d.sap_code,
        sfa_code: d.sfa_code,
        area: d.area,
        zone: d.zone,
        so_name: d.so_name,
        so_emp_code: d.so_emp_code,
        asm_name: d.asm_name,
        asm_code: d.asm_code,
        current_status: d.dealer_status,
        grade: d.grade,
        currentSales: cm,
        previousSales: pm,
        sixMonthAverage: avg6m,
        recentVisitCount: recentVisits,
        churnProbability: Math.min(score, 100),
        riskLevel,
        reasons,
        period_month: d.period_month
      };
    });

    // Filter by riskLevel if requested
    let filtered = riskLevel
      ? scored.filter(d => d.riskLevel === riskLevel)
      : scored;

    // Sort by churnProbability descending
    filtered.sort((a, b) => b.churnProbability - a.churnProbability);

    const total = filtered.length;
    const paginated = filtered.slice(Number(offset), Number(offset) + Number(limit));

    res.json({
      reportDate: new Date().toISOString().split('T')[0],
      periodMonth: periodMonth || 'N/A',
      totalAtRisk: total,
      summary: {
        High: filtered.filter(d => d.riskLevel === 'High').length,
        Medium: filtered.filter(d => d.riskLevel === 'Medium').length,
        Low: filtered.filter(d => d.riskLevel === 'Low').length
      },
      dealers: paginated
    });
  } catch (err) {
    console.error('Error calculating churn risk:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/reports/churn-risk/summary
 * Aggregate churn risk counts by area and risk level.
 * Useful for ASM dashboard cards on Day 15.
 */
export async function getChurnRiskSummary(req, res) {
  try {
    let { periodMonth } = req.query;

    if (!periodMonth) {
      const latest = await dbAll("SELECT period_month FROM dealer_visit_targets ORDER BY period_month DESC LIMIT 1");
      periodMonth = latest[0]?.period_month || null;
    }

    const dealers = await dbAll(`
      SELECT
        dvt.area,
        dvt.asm_name,
        dvt.so_name,
        dvt.current_sales,
        dvt.previous_sales,
        dvt.rsar_six_month_avg,
        dvt.dp_six_month_avg,
        dvt.sap_code,
        dvt.sfa_code
      FROM dealer_visit_targets dvt
      WHERE dvt.dealer_status != 'Churn'
        ${periodMonth ? 'AND dvt.period_month = ?' : ''}
    `, periodMonth ? [periodMonth] : []);

    const visitCounts = await dbAll(`
      SELECT customer_code, COUNT(*) as visit_count
      FROM visit_execution_logs
      WHERE visit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND visit_status = 'VISITED'
      GROUP BY customer_code
    `);
    const visitCountMap = new Map(visitCounts.map(v => [v.customer_code, v.visit_count]));

    // Build area-level summary
    const areaMap = new Map();

    for (const d of dealers) {
      const cm = Number(d.current_sales) || 0;
      const pm = Number(d.previous_sales) || 0;
      const avg6m = Number(d.rsar_six_month_avg) || Number(d.dp_six_month_avg) || 0;
      const recentVisits = visitCountMap.get(d.sap_code) || visitCountMap.get(d.sfa_code) || 0;

      let score = 0;
      if (cm === 0) score += 40;
      if (pm === 0) score += 30;
      if (avg6m > 0 && cm < avg6m * 0.20) score += 20;
      if (recentVisits === 0) score += 10;

      const riskLevel = score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low';
      const key = d.area || 'Unknown Area';

      if (!areaMap.has(key)) {
        areaMap.set(key, {
          area: key,
          asm_name: d.asm_name || null,
          total: 0,
          High: 0,
          Medium: 0,
          Low: 0
        });
      }

      const entry = areaMap.get(key);
      entry.total++;
      entry[riskLevel]++;
    }

    const summary = Array.from(areaMap.values())
      .sort((a, b) => b.High - a.High);

    const grandTotal = {
      total: dealers.length,
      High: summary.reduce((s, a) => s + a.High, 0),
      Medium: summary.reduce((s, a) => s + a.Medium, 0),
      Low: summary.reduce((s, a) => s + a.Low, 0)
    };

    res.json({
      reportDate: new Date().toISOString().split('T')[0],
      periodMonth: periodMonth || 'N/A',
      grandTotal,
      byArea: summary
    });
  } catch (err) {
    console.error('Error in churn risk summary:', err);
    res.status(500).json({ error: err.message });
  }
}
