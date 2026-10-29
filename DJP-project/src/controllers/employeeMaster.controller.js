import {
  syncEmployeeMasterFromApi,
  getEmployeeMasterStatus,
  searchEmployeesFromMaster,
  getEmployeeByCode
} from '../services/employeeMaster.service.js';

/**
 * GET /api/employees/master
 * Search and list employees from employee_master
 */
export async function listEmployeesMaster(req, res) {
  try {
    const result = await searchEmployeesFromMaster({
      search: req.query.search,
      empCode: req.query.empCode || req.query.emp_code,
      dnsEmpCode: req.query.dnsEmpCode || req.query.dns_emp_code,
      designation: req.query.designation,
      zone: req.query.zone,
      state: req.query.state,
      acedns: req.query.acedns,
      reportingTo: req.query.reportingTo || req.query.reporting_to,
      limit: req.query.limit,
      offset: req.query.offset
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[listEmployeesMaster]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/employees/master/:empCode
 * Get details for a single employee by emp_code or dns_emp_code
 */
export async function getEmployeeMasterDetail(req, res) {
  try {
    const code = req.params.empCode;
    const employee = await getEmployeeByCode(code);
    if (!employee) {
      return res.status(404).json({ error: `Employee '${code}' not found in employee_master.` });
    }

    res.json({
      success: true,
      employee
    });
  } catch (err) {
    console.error('[getEmployeeMasterDetail]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/sync/employee-master
 * On-demand trigger to sync employee master from SFA API
 */
export async function syncEmployeeMasterEndpoint(req, res) {
  try {
    const force = req.body?.force === true;
    const result = await syncEmployeeMasterFromApi({ force });
    res.json(result);
  } catch (err) {
    console.error('[syncEmployeeMasterEndpoint]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/sync/employee-master/status
 * Get status of employee master table and sync state
 */
export async function getEmployeeMasterStatusEndpoint(req, res) {
  try {
    const status = await getEmployeeMasterStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (err) {
    console.error('[getEmployeeMasterStatusEndpoint]', err);
    res.status(500).json({ error: err.message });
  }
}

