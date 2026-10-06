export const API_BASE = import.meta.env.VITE_API_BASE ?? (
  import.meta.env.BASE_URL && import.meta.env.BASE_URL !== '/' && import.meta.env.BASE_URL !== './'
    ? `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`
    : '/api'
);

/**
 * Read a response body that is SUPPOSED to be JSON, and fail with something a human
 * can act on when it isn't.
 *
 * A long generation that outruns a timeout reaches the browser as an empty or HTML
 * body. Calling res.json() on that throws "Unexpected token '<' ... is not valid JSON",
 * which tells you nothing about what actually happened — the request was cut off, not
 * malformed. This distinguishes the cases.
 */
async function readJson(res, fallbackMessage) {
  const text = await res.text();

  if (!text) {
    throw new Error(
      res.ok
        ? 'The server closed the connection without sending a reply. The job is most likely still running in the background — check the server console, then reload in a minute.'
        : `${fallbackMessage} (HTTP ${res.status}, empty response)`
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const looksLikeHtml = /^\s*</.test(text);
    throw new Error(
      looksLikeHtml
        ? `The server returned a web page instead of data (HTTP ${res.status}). That usually means the request timed out or the API is not reachable through the dev proxy. The job may still be running — check the server console.`
        : `${fallbackMessage} (HTTP ${res.status}): ${text.slice(0, 200)}`
    );
  }

  if (!res.ok) throw new Error(data.error || data.message || fallbackMessage);
  return data;
}

export const api = {
  // Auth
  login: async (username, password) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    return data;
  },

  // Stats & Filters
  getStats: async () => {
    const res = await fetch(`${API_BASE}/admin/stats`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  },

  getFilters: async () => {
    const res = await fetch(`${API_BASE}/admin/filters`);
    if (!res.ok) throw new Error('Failed to fetch filter options');
    return res.json();
  },

  // Visit Targets
  getVisitTargets: async (params = {}) => {
    const query = new URLSearchParams();
    if (params.cycleCode && params.cycleCode !== 'ALL') query.append('cycleCode', params.cycleCode);
    if (params.dealerStatus && params.dealerStatus !== 'ALL') query.append('dealerStatus', params.dealerStatus);
    if (params.custType && params.custType !== 'ALL') query.append('custType', params.custType);
    if (params.search) query.append('search', params.search);
    if (params.periodMonth && params.periodMonth !== 'ALL') query.append('periodMonth', params.periodMonth);
    if (params.soEmpCode && params.soEmpCode !== 'ALL') query.append('soEmpCode', params.soEmpCode);
    if (params.soName && params.soName !== 'ALL') query.append('soName', params.soName);
    if (params.category && params.category !== 'ALL') query.append('category', params.category);
    if (params.zone && params.zone !== 'ALL') query.append('zone', params.zone);
    if (params.area && params.area !== 'ALL') query.append('area', params.area);
    if (params.limit) query.append('limit', params.limit);
    if (params.offset) query.append('offset', params.offset);

    const res = await fetch(`${API_BASE}/djp/dealer-targets?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch visit targets');
    return res.json();
  },

  // Rules Engine
  getRules: async () => {
    const res = await fetch(`${API_BASE}/admin/rules`);
    if (!res.ok) throw new Error('Failed to fetch rules');
    return res.json();
  },

  updateRulesBatch: async (rules) => {
    const res = await fetch(`${API_BASE}/admin/rules/batch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules })
    });
    if (!res.ok) throw new Error('Failed to save rules');
    return res.json();
  },

  // Upload Batches & Ingestion
  getBatches: async () => {
    const res = await fetch(`${API_BASE}/admin/batches`);
    if (!res.ok) throw new Error('Failed to fetch upload batches');
    return res.json();
  },

  getArchiveSummary: async (periodMonth = null) => {
    const query = periodMonth && periodMonth !== 'ALL' ? `?periodMonth=${encodeURIComponent(periodMonth)}` : '';
    const res = await fetch(`${API_BASE}/admin/archives/summary${query}`);
    if (!res.ok) throw new Error('Failed to fetch archive summary');
    return res.json();
  },

  getInputReadiness: async () => {
    const res = await fetch(`${API_BASE}/admin/readiness`);
    if (!res.ok) throw new Error('Failed to fetch input readiness');
    return res.json();
  },

  deleteBatch: async (batchCode) => {
    const res = await fetch(`${API_BASE}/admin/batches/${batchCode}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete batch log');
    return data;
  },

  uploadFile: async (formData) => {
    const res = await fetch(`${API_BASE}/uploads/file`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'File upload failed');
    return data;
  },

  getReconciliation: async (periodMonth = '2026-06', cycleCode = 'C1') => {
    const res = await fetch(`${API_BASE}/djp/reconciliation?periodMonth=${periodMonth}&cycleCode=${cycleCode}`);
    if (!res.ok) throw new Error('Failed to fetch reconciliation report');
    return res.json();
  },

  calculatePjp: async (periodMonth = '2026-06', cycleCode = 'C1') => {
    const res = await fetch(`${API_BASE}/pjp/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodMonth, cycleCode })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to run PJP calculation');
    return data;
  },

  purgeData: async () => {
    const res = await fetch(`${API_BASE}/admin/purge`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Purge failed');
    return data;
  },

  // Territory Mapping
  getTerritoryMapping: async (search = '', limit = 500, offset = 0) => {
    const query = new URLSearchParams();
    if (search) query.append('search', search);
    query.append('limit', limit);
    query.append('offset', offset);

    const res = await fetch(`${API_BASE}/admin/mapping?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch territory mapping');
    return res.json();
  },

  // DJP Generation — generates BOTH C1 and C2 simultaneously
  generateDjp: async (periodMonth) => {
    if (!periodMonth) {
      throw new Error('planMonth is required');
    }
    const res = await fetch(`${API_BASE}/djp/generate-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planMonth: periodMonth, periodMonth })
    });
    return readJson(res, 'DJP generation failed');
  },

  // Regenerate C2 Plans after SFA feedback upload (adherence-based)
  regenerateC2Plans: async (periodMonth) => {
    if (!periodMonth) throw new Error('periodMonth is required');
    const res = await fetch(`${API_BASE}/generation/regenerate-c2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodMonth })
    });
    return readJson(res, 'C2 regeneration failed');
  },

  // PJP Calculation Only
  calculatePjp: async (periodMonth, cycleCode) => {
    if (!periodMonth || !cycleCode) {
      throw new Error('planMonth and cycleCode are required');
    }
    const res = await fetch(`${API_BASE}/pjp/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planMonth: periodMonth, periodMonth, cycleCode })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'PJP calculation failed');
    return data;
  },

  // PJP Dealer Debug
  getPjpDebug: async (dealerCode, periodMonth, cycleCode) => {
    const query = new URLSearchParams();
    if (periodMonth) query.append('periodMonth', periodMonth);
    if (cycleCode) query.append('cycleCode', cycleCode);
    const res = await fetch(`${API_BASE}/pjp/debug/${encodeURIComponent(dealerCode)}?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch PJP debug');
    return res.json();
  },

  // Employees
  getEmployees: async (role = '') => {
    const query = role && role !== 'ALL' ? `?role=${encodeURIComponent(role)}` : '';
    const res = await fetch(`${API_BASE}/employees${query}`);
    if (!res.ok) throw new Error('Failed to fetch employees');
    return res.json();
  },

  // Sales Plans
  generateAutoPlan: async (empCode, periodMonth, role = 'SO', cycleCode = 'C1') => {
    const res = await fetch(`${API_BASE}/plans/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empCode, planMonth: periodMonth, periodMonth, role, cycleCode })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Plan generation failed');
    return data;
  },

  getPlans: async (empCode) => {
    const query = empCode ? `?empCode=${encodeURIComponent(empCode)}` : '';
    const res = await fetch(`${API_BASE}/plans${query}`);
    if (!res.ok) throw new Error('Failed to fetch plans');
    return res.json();
  },

  getPlanDetails: async (planId) => {
    const res = await fetch(`${API_BASE}/plans/${planId}/details`);
    if (!res.ok) throw new Error('Failed to fetch plan details');
    return res.json();
  },

  submitPlan: async (planId) => {
    const res = await fetch(`${API_BASE}/plans/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit plan');
    return data;
  },

  approvePlan: async (planId, managerEmpCode, action, remarks = '') => {
    const res = await fetch(`${API_BASE}/plans/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, managerEmpCode, action, remarks })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update approval status');
    return data;
  },

  deletePlan: async (planId) => {
    const res = await fetch(`${API_BASE}/plans/${planId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete plan');
    return data;
  },

  bulkDeletePlans: async (planIds) => {
    const res = await fetch(`${API_BASE}/plans/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planIds })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to bulk delete plans');
    return data;
  },

  // ── Officer Plans & Adherence (admin panel) ───────────────────────────────
  // Backed by the app API, which carries role, L1 approver and rectification
  // state that the legacy /plans endpoint does not return.
  getAllOfficerPlans: async ({ month, cycle, status, role, search } = {}) => {
    const q = new URLSearchParams();
    if (month) q.append('month', month);
    if (cycle && cycle !== 'ALL') q.append('cycle', cycle);
    if (status && status !== 'ALL') q.append('status', status);
    if (role && role !== 'ALL') q.append('role', role);
    if (search) q.append('search', search);
    const res = await fetch(`${API_BASE}/app/admin/plans?${q.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch officer plans');
    return data;
  },

  getOfficerPlanDetail: async (planId) => {
    const res = await fetch(`${API_BASE}/app/admin/plans/${planId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch plan detail');
    return data;
  },

  // Read-only adherence. Does NOT regenerate C2 — that is regenerateC2Plans.
  // cycle: 'C1' | 'C2' | 'ALL'; asOn: YYYY-MM-DD (defaults to the 15th for C1, month end otherwise)
  getAdherenceReport: async (month, { cycle, asOn, productiveOnly } = {}) => {
    if (!month) throw new Error('month (YYYY-MM) is required');
    const q = new URLSearchParams({ month });
    if (cycle && cycle !== 'ALL') q.append('cycle', cycle);
    if (asOn) q.append('asOn', asOn);
    if (productiveOnly) q.append('productiveOnly', '1');
    const res = await fetch(`${API_BASE}/app/admin/adherence?${q.toString()}`);
    return readJson(res, 'Adherence report failed');
  },

  // C2 regeneration review — what the adherence result changed in the second cycle
  listC2Regenerations: async (month) => {
    const q = month ? `?month=${encodeURIComponent(month)}` : '';
    const res = await fetch(`${API_BASE}/app/admin/c2-regenerations${q}`);
    return readJson(res, 'Failed to load C2 regenerations');
  },

  getC2Regeneration: async (id) => {
    const res = await fetch(`${API_BASE}/app/admin/c2-regenerations/${id}`);
    return readJson(res, 'Failed to load the C2 regeneration');
  },

  restampPlanRouting: async (periodMonth, cycleCode) => {
    const res = await fetch(`${API_BASE}/app/routing/restamp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodMonth, cycleCode })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to re-stamp plan routing');
    return data;
  },

  getDealersForSO: async (empCode) => {
    const res = await fetch(`${API_BASE}/plans/dealers?empCode=${encodeURIComponent(empCode)}`);
    if (!res.ok) throw new Error('Failed to fetch dealers for SO');
    return res.json();
  },

  addPlanVisit: async (data) => {
    const res = await fetch(`${API_BASE}/plans/details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const resData = await res.json();
    if (!res.ok) throw new Error(resData.error || 'Failed to add visit');
    return resData;
  },

  removePlanVisit: async (detailId) => {
    const res = await fetch(`${API_BASE}/plans/details/${detailId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to remove visit');
    return data;
  },

  // Master Data Repository
  getMasterSummary: async () => {
    const res = await fetch(`${API_BASE}/master/summary`);
    if (!res.ok) throw new Error('Failed to fetch master summary');
    return res.json();
  },

  getMasterFilters: async () => {
    const res = await fetch(`${API_BASE}/master/filters`);
    if (!res.ok) throw new Error('Failed to fetch master filters');
    return res.json();
  },

  getMasterDealers: async (params = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.append('search', params.search);
    if (params.dealerType && params.dealerType !== 'ALL') query.append('dealerType', params.dealerType);
    if (params.status && params.status !== 'ALL') query.append('status', params.status);
    if (params.area && params.area !== 'ALL') query.append('area', params.area);
    if (params.region && params.region !== 'ALL') query.append('region', params.region);
    if (params.zone && params.zone !== 'ALL') query.append('zone', params.zone);
    if (params.counterStrategy) query.append('counterStrategy', params.counterStrategy);
    query.append('limit', params.limit || 50);
    query.append('offset', params.offset || 0);

    const res = await fetch(`${API_BASE}/master/dealers?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch master dealers');
    return res.json();
  },

  getTerritoryMappingFiltered: async (params = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.append('search', params.search);
    if (params.area && params.area !== 'ALL') query.append('area', params.area);
    if (params.region && params.region !== 'ALL') query.append('region', params.region);
    if (params.soName && params.soName !== 'ALL') query.append('soName', params.soName);
    if (params.custType && params.custType !== 'ALL') query.append('custType', params.custType);
    query.append('limit', params.limit || 50);
    query.append('offset', params.offset || 0);

    const res = await fetch(`${API_BASE}/admin/mapping?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch territory mapping');
    return res.json();
  },

  getMasterEmployees: async (params = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.append('search', params.search);
    if (params.zone && params.zone !== 'ALL') query.append('zone', params.zone);
    if (params.region && params.region !== 'ALL') query.append('region', params.region);
    query.append('limit', params.limit || 50);
    query.append('offset', params.offset || 0);

    const res = await fetch(`${API_BASE}/master/employees?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch master employees');
    return res.json();
  },

  getSalesHistory: async (params = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.append('search', params.search);
    if (params.period) query.append('period', params.period);
    if (params.zone && params.zone !== 'ALL') query.append('zone', params.zone);
    query.append('limit', params.limit || 50);
    query.append('offset', params.offset || 0);

    const res = await fetch(`${API_BASE}/master/sales-history?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch sales history');
    return res.json();
  },

  getDealerPerformance: async (params = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.append('search', params.search);
    if (params.period) query.append('period', params.period);
    if (params.zone && params.zone !== 'ALL') query.append('zone', params.zone);
    if (params.region && params.region !== 'ALL') query.append('region', params.region);
    if (params.area && params.area !== 'ALL') query.append('area', params.area);
    query.append('limit', params.limit || 50);
    query.append('offset', params.offset || 0);

    const res = await fetch(`${API_BASE}/master/dealer-performance?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch dealer performance');
    return res.json();
  },

  /**
   * The Master sheet as JSON — the same 42 columns the M.xlsx download carries.
   * Both come from src/services/masterSheet.service.js on the server.
   */
  getMasterView: async ({ month, cycle, page = 1, pageSize = 100, search = '' } = {}) => {
    const q = new URLSearchParams();
    if (month && month !== 'ALL') q.append('periodMonth', month);
    if (cycle && cycle !== 'ALL') q.append('cycleCode', cycle);
    q.append('page', page);
    q.append('pageSize', pageSize);
    if (search) q.append('search', search);

    const res = await fetch(`${API_BASE}/djp/master-view?${q.toString()}`);
    const data = await readJson(res, 'Could not load the Master sheet');
    if (!res.ok) throw new Error([data.error, data.fix].filter(Boolean).join(' — '));
    return data;
  },

  /** Download the Master sheet as M_<month>_<cycle>.xlsx. */
  downloadMasterExcel: async (month, cycle) => {
    const q = new URLSearchParams();
    if (month && month !== 'ALL') q.append('periodMonth', month);
    if (cycle && cycle !== 'ALL') q.append('cycleCode', cycle);

    const res = await fetch(`${API_BASE}/djp/export-master?${q.toString()}`);
    if (!res.ok) {
      // The server sends JSON on failure and a spreadsheet on success.
      let msg = `Export failed (HTTP ${res.status})`;
      try { const j = JSON.parse(await res.text()); msg = j.error || msg; } catch { /* not JSON */ }
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `M_${month || 'latest'}_${cycle || 'C1'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  getVisitLogs: async (params = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.append('search', params.search);
    if (params.visitDate && params.visitDate !== 'ALL') query.append('visitDate', params.visitDate);
    if (params.employeeName && params.employeeName !== 'ALL') query.append('employeeName', params.employeeName);
    if (params.branch && params.branch !== 'ALL') query.append('branch', params.branch);
    if (params.route && params.route !== 'ALL') query.append('route', params.route);
    if (params.visitStatus && params.visitStatus !== 'ALL') query.append('visitStatus', params.visitStatus);
    if (params.customerType && params.customerType !== 'ALL') query.append('customerType', params.customerType);
    query.append('limit', params.limit || 50);
    query.append('offset', params.offset || 0);

    const res = await fetch(`${API_BASE}/master/visit-logs?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch visit logs');
    return res.json();
  }
};
