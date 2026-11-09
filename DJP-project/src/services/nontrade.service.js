import xlsx from 'xlsx';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { dbAll, dbRun, dbGet } from '../config/database.js';

/**
 * Non-Trade DJP Service
 * Handles data ingestion, automatic adherence calculation, counter plans,
 * master employee verification, and Excel export.
 */

// Helper to normalize and parse dates
export function parseDateVal(val) {
  if (val === null || val === undefined || val === '' || val === 'NA' || val === 'null' || val === 0 || val === '0') return null;
  if (typeof val === 'number') {
    // Excel serial date to YYYY-MM-DD
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s || s === 'NA' || s === '0') return null;
    if (s.includes('.')) {
      const parts = s.split('.');
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }
    if (s.includes('-')) {
      const parts = s.split('-');
      if (parts.length === 3 && parts[0].length === 4) return s.slice(0, 10);
      if (parts.length === 3 && parts[2].length === 4) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }
    return s.slice(0, 20);
  }
  return null;
}

// Known Non-Trade officer name to emp_code mapping for sheets where code might be omitted
const KNOWN_EMP_MAP = {
  'MONJYOTI KALITA': '11001465',
  'SAMJAL HAZAM': '2500271',
  'SATISH KUMAR': '11001570',
  'SANDEEP BHATTACHARJEE': '1200145',
  'VIVEK KUMAR': '2500130',
  'ROHIT GUPTA': '2500320',
  'ISHWAN KALITA': '2500310',
  'MIRAJ AKTHER': '11002259',
  'DEBAJIT MITRA': '2500288',
  'PREETAM KARMAKAR': '2500232',
  'DEBASHISH DEY': '1100160',
  'PARTHA PROTIM BORA': '11001802',
  'BORNALEE BORA KALITA': '2500062',
  'SHANTANU BHATTACHARJEE': '1100745',
  'JOY GHOSE': '11002094',
  'BISHAL DEB ROY': '11002047',
  'DIPANKER DEKA': '11002056',
  'SHAKEEL RAHMAN': '2600059'
};

export const NONTRADE_HIERARCHY_MAP = {
  '2500288':  { asm_code: '1100160', asm_name: 'DEBASHISH DEY', hos_code: '1100745', hos_name: 'SHANTANU BHATTACHARJEE' },
  '2500232':  { asm_code: '1100160', asm_name: 'DEBASHISH DEY', hos_code: '1100745', hos_name: 'SHANTANU BHATTACHARJEE' },
  '11001465': { asm_code: '11001802', asm_name: 'PARTHA PROTIM BORA', hos_code: '1100745', hos_name: 'SHANTANU BHATTACHARJEE' },
  '11001570': { asm_code: '11001802', asm_name: 'PARTHA PROTIM BORA', hos_code: '1100745', hos_name: 'SHANTANU BHATTACHARJEE' },
  '2500271':  { asm_code: '11001802', asm_name: 'PARTHA PROTIM BORA', hos_code: '1100745', hos_name: 'SHANTANU BHATTACHARJEE' },
  '1200145':  { asm_code: '2500062', asm_name: 'BORNALEE BORA KALITA', hos_code: '11002094', hos_name: 'JOY GHOSE' },
  '2500130':  { asm_code: '2500062', asm_name: 'BORNALEE BORA KALITA', hos_code: '11002094', hos_name: 'JOY GHOSE' },
  '2500310':  { asm_code: '2500062', asm_name: 'BORNALEE BORA KALITA', hos_code: '11002094', hos_name: 'JOY GHOSE' },
  '1100160':  { asm_code: '1100160', asm_name: 'DEBASHISH DEY', hos_code: '1100745', hos_name: 'SHANTANU BHATTACHARJEE' },
  '11001802': { asm_code: '11001802', asm_name: 'PARTHA PROTIM BORA', hos_code: '1100745', hos_name: 'SHANTANU BHATTACHARJEE' },
  '2500062':  { asm_code: '2500062', asm_name: 'BORNALEE BORA KALITA', hos_code: '11002094', hos_name: 'JOY GHOSE' },
};

/**
 * Ingest Non-Trade Excel Workbook (either Planning sheet or Execution sheet or both)
 */
export async function ingestNonTradeWorkbook(filePath, periodMonth = '2026-09', originalName = '') {
  const wb = xlsx.readFile(filePath, { cellDates: false });
  const sheetNames = wb.SheetNames;
  const fileName = originalName || path.basename(filePath);

  const importStats = {
    plansInserted: 0,
    hoPlansInserted: 0,
    cvrInserted: 0,
    leadsInserted: 0,
    siteVisitsInserted: 0,
    profVisitsInserted: 0
  };

  // 1. Check for Officer Visits or Planning sheet - Officer
  const offSheetName = sheetNames.find(s => s === 'Officer Visits' || s === 'Planning sheet - Officer');
  if (offSheetName) {
    const ws = wb.Sheets[offSheetName];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
    // find header row (contains SAP code or Ship-to party)
    let headerIdx = 0;
    for (let r = 0; r < Math.min(10, data.length); r++) {
      const row = data[r] || [];
      if (row.some(c => typeof c === 'string' && (c.includes('SAP code') || c.includes('Ship-to party')))) {
        headerIdx = r;
        break;
      }
    }

    const header = data[headerIdx] || [];
    const isVisitSheet = offSheetName === 'Officer Visits';

    const plans = [];
    for (let r = headerIdx + 1; r < data.length; r++) {
      const row = data[r];
      if (!row || !row[0]) continue;
      const empName = String(row[0]).trim();
      let empCode = row[1] ? String(row[1]).trim() : (KNOWN_EMP_MAP[empName.toUpperCase()] || '');
      if (!empCode && KNOWN_EMP_MAP[empName.toUpperCase()]) empCode = KNOWN_EMP_MAP[empName.toUpperCase()];
      
      const sapCode = row[2] ? String(row[2]).trim() : '';
      const partyName = row[3] ? String(row[3]).trim() : '';
      const destZone = row[4] ? String(row[4]).trim() : '';
      const shipToName = row[5] ? String(row[5]).trim() : '';
      const shipToParty = row[6] ? String(row[6]).trim() : '';
      const segment = row[7] ? String(row[7]).trim() : '';
      const bucket = row[8] ? String(row[8]).trim() : '';
      const priority = Number(row[9]) || 0;
      const modelVisits = Number(row[10]) || 0;
      const d1 = parseDateVal(row[11]);
      const d2 = parseDateVal(row[12]);
      const d3 = parseDateVal(row[13]);
      const ho1 = parseDateVal(row[14]);
      const ho2 = parseDateVal(row[15]);
      const remarks = row[16] ? String(row[16]).trim() : null;

      const concat = isVisitSheet && row[20] ? String(row[20]).trim() : (shipToParty ? `${empCode}-${shipToParty}` : '');

      const hier = NONTRADE_HIERARCHY_MAP[empCode] || {};
      plans.push([
        periodMonth, 'Officer', empCode, empName,
        hier.asm_name || null, hier.asm_code || null, hier.hos_name || null, hier.hos_code || null,
        sapCode, partyName, destZone, null,
        shipToName, shipToParty, segment, bucket,
        priority, modelVisits,
        d1, d2, d3, ho1, ho2,
        remarks, concat, fileName
      ]);
    }

    if (plans.length > 0) {
      await dbRun('DELETE FROM nontrade_plans WHERE period_month = ? AND role_type = "Officer"', [periodMonth]);
      const sql = `
        INSERT INTO nontrade_plans (
          period_month, role_type, emp_code, emp_name,
          asm_name, asm_emp_code, hos_name, hos_emp_code,
          sap_code, party_name, destination_zone, area,
          ship_to_party_name, ship_to_party, segment, bucket,
          priority, model_visits,
          date_of_visit_1, date_of_visit_2, date_of_visit_3,
          ho_visit_date_1, ho_visit_date_2,
          remarks, concat_id, source_file
        ) VALUES ?
      `;
      for (let i = 0; i < plans.length; i += 500) {
        await dbRun(sql, [plans.slice(i, i + 500)]);
      }
      importStats.plansInserted += plans.length;
    }
  }

  // 2. Check for ASM Visits or Planning sheet - ASM
  const asmSheetName = sheetNames.find(s => s === 'ASM Visits' || s === 'Planning sheet - ASM');
  if (asmSheetName) {
    const ws = wb.Sheets[asmSheetName];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
    let headerIdx = 0;
    for (let r = 0; r < Math.min(10, data.length); r++) {
      const row = data[r] || [];
      if (row.some(c => typeof c === 'string' && (c.includes('ASM') || c.includes('SAP code')))) {
        headerIdx = r;
        break;
      }
    }

    const isVisitSheet = asmSheetName === 'ASM Visits';
    const plans = [];
    for (let r = headerIdx + 1; r < data.length; r++) {
      const row = data[r];
      if (!row || !row[0]) continue;
      const asmName = String(row[0]).trim();
      let asmEmpCode = row[1] ? String(row[1]).trim() : (KNOWN_EMP_MAP[asmName.toUpperCase()] || '');
      const officerName = row[2] ? String(row[2]).trim() : '';
      const sapCode = row[3] ? String(row[3]).trim() : '';
      const partyName = row[4] ? String(row[4]).trim() : '';
      const destZone = row[5] ? String(row[5]).trim() : '';
      const shipToName = row[6] ? String(row[6]).trim() : '';
      const shipToParty = row[7] ? String(row[7]).trim() : '';
      const segment = row[8] ? String(row[8]).trim() : '';
      const bucket = row[9] ? String(row[9]).trim() : '';
      const priority = Number(row[10]) || 0;
      const modelVisits = Number(row[11]) || 0;
      const d1 = parseDateVal(row[12]);
      const d2 = parseDateVal(row[13]);
      const d3 = parseDateVal(row[14]);
      const ho1 = parseDateVal(row[15]);
      const ho2 = parseDateVal(row[16]);
      const remarks = row[17] ? String(row[17]).trim() : null;

      const concat = isVisitSheet && row[21] ? String(row[21]).trim() : (shipToParty ? `${asmEmpCode}-${shipToParty}` : '');

      plans.push([
        periodMonth, 'ASM', asmEmpCode, asmName,
        asmName, asmEmpCode, null, null,
        sapCode, partyName, destZone, null,
        shipToName, shipToParty, segment, bucket,
        priority, modelVisits,
        d1, d2, d3, ho1, ho2,
        remarks, concat, fileName
      ]);
    }

    if (plans.length > 0) {
      await dbRun('DELETE FROM nontrade_plans WHERE period_month = ? AND role_type = "ASM"', [periodMonth]);
      const sql = `
        INSERT INTO nontrade_plans (
          period_month, role_type, emp_code, emp_name,
          asm_name, asm_emp_code, hos_name, hos_emp_code,
          sap_code, party_name, destination_zone, area,
          ship_to_party_name, ship_to_party, segment, bucket,
          priority, model_visits,
          date_of_visit_1, date_of_visit_2, date_of_visit_3,
          ho_visit_date_1, ho_visit_date_2,
          remarks, concat_id, source_file
        ) VALUES ?
      `;
      for (let i = 0; i < plans.length; i += 500) {
        await dbRun(sql, [plans.slice(i, i + 500)]);
      }
      importStats.plansInserted += plans.length;
    }
  }

  // 3. Check for HOS visits or Planning sheet - HOS
  const hosSheetName = sheetNames.find(s => s === 'HOS visits' || s === 'Planning sheet - HOS');
  if (hosSheetName) {
    const ws = wb.Sheets[hosSheetName];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
    let headerIdx = 0;
    for (let r = 0; r < Math.min(10, data.length); r++) {
      const row = data[r] || [];
      if (row.some(c => typeof c === 'string' && (c.includes('HOS') || c.includes('SAP code')))) {
        headerIdx = r;
        break;
      }
    }

    const isVisitSheet = hosSheetName === 'HOS visits';
    const plans = [];
    for (let r = headerIdx + 1; r < data.length; r++) {
      const row = data[r];
      if (!row || !row[0]) continue;
      const hosName = String(row[0]).trim();
      let hosEmpCode = row[1] ? String(row[1]).trim() : (KNOWN_EMP_MAP[hosName.toUpperCase()] || '');
      const asmName = row[2] ? String(row[2]).trim() : '';
      const officerName = row[3] ? String(row[3]).trim() : '';
      const sapCode = row[4] ? String(row[4]).trim() : '';
      const partyName = row[5] ? String(row[5]).trim() : '';
      const destZone = row[6] ? String(row[6]).trim() : '';
      const area = row[7] ? String(row[7]).trim() : '';
      const shipToName = row[8] ? String(row[8]).trim() : '';
      const shipToParty = row[9] ? String(row[9]).trim() : '';
      const segment = row[10] ? String(row[10]).trim() : '';
      const bucket = row[11] ? String(row[11]).trim() : '';
      const priority = Number(row[12]) || 0;
      const modelVisits = Number(row[13]) || 0;
      const d1 = parseDateVal(row[14]);
      const d2 = parseDateVal(row[15]);
      const d3 = parseDateVal(row[16]);
      const ho1 = parseDateVal(row[17]);
      const ho2 = parseDateVal(row[18]);
      const remarks = row[19] ? String(row[19]).trim() : null;

      const concat = isVisitSheet && row[23] ? String(row[23]).trim() : (shipToParty ? `${hosEmpCode}-${shipToParty}` : '');

      plans.push([
        periodMonth, 'HOS', hosEmpCode, hosName,
        asmName, null, hosName, hosEmpCode,
        sapCode, partyName, destZone, area,
        shipToName, shipToParty, segment, bucket,
        priority, modelVisits,
        d1, d2, d3, ho1, ho2,
        remarks, concat, fileName
      ]);
    }

    if (plans.length > 0) {
      await dbRun('DELETE FROM nontrade_plans WHERE period_month = ? AND role_type = "HOS"', [periodMonth]);
      const sql = `
        INSERT INTO nontrade_plans (
          period_month, role_type, emp_code, emp_name,
          asm_name, asm_emp_code, hos_name, hos_emp_code,
          sap_code, party_name, destination_zone, area,
          ship_to_party_name, ship_to_party, segment, bucket,
          priority, model_visits,
          date_of_visit_1, date_of_visit_2, date_of_visit_3,
          ho_visit_date_1, ho_visit_date_2,
          remarks, concat_id, source_file
        ) VALUES ?
      `;
      for (let i = 0; i < plans.length; i += 500) {
        await dbRun(sql, [plans.slice(i, i + 500)]);
      }
      importStats.plansInserted += plans.length;
    }
  }

  // 4. Check for HO Sheets
  const hoSheets = ['Officer visit - HO', 'ASM - HO', 'HOS - HO'];
  const hasHoSheet = sheetNames.some(s => hoSheets.includes(s));
  if (hasHoSheet) {
    const hoPlans = [];
    hoSheets.forEach(sheetName => {
      if (!sheetNames.includes(sheetName)) return;
      const role = sheetName.startsWith('Officer') ? 'Officer' : sheetName.startsWith('ASM') ? 'ASM' : 'HOS';
      const ws = wb.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(ws);
      rows.forEach(r => {
        const empName = r['Officer'] || r['ASM'] || r['HOS'] || '';
        let empCode = r['ASM Emp. Code'] || r['HOS Emp. Code'] || r['Officer Emp. Code'] || r['Emp Code'] || r['Emp. Code'];
        if (!empCode && KNOWN_EMP_MAP[String(empName).toUpperCase()]) {
          empCode = KNOWN_EMP_MAP[String(empName).toUpperCase()];
        }
        const sapCode = r['SAP code'] ? String(r['SAP code']).trim() : '';
        if (!sapCode || !empName || String(empName).includes('HO-SALES')) return;

        const ho1 = parseDateVal(r['HO visit date 1']);
        const ho2 = parseDateVal(r['HO Visit date 2']);
        const concat = r['Concat'] || `${empCode || empName}-${sapCode}`;

        hoPlans.push([
          periodMonth, role, String(empCode || empName).trim(), String(empName).trim(),
          sapCode, r['Party name'] ? String(r['Party name']).trim() : null,
          ho1, ho2,
          String(concat).trim(), fileName
        ]);
      });
    });

    if (hoPlans.length > 0) {
      await dbRun('DELETE FROM nontrade_ho_plans WHERE period_month = ?', [periodMonth]);
      const hoSql = `
        INSERT INTO nontrade_ho_plans (
          period_month, role_type, emp_code, emp_name,
          sap_code, party_name,
          ho_visit_date_1, ho_visit_date_2,
          concat_id, source_file
        ) VALUES ?
      `;
      for (let i = 0; i < hoPlans.length; i += 500) {
        await dbRun(hoSql, [hoPlans.slice(i, i + 500)]);
      }
      importStats.hoPlansInserted += hoPlans.length;
    }
  }

  // 5. Customer Visit Report
  if (sheetNames.includes('Customer Visit Report')) {
    const ws = wb.Sheets['Customer Visit Report'];
    const rows = xlsx.utils.sheet_to_json(ws);
    const cvrData = rows.map(r => {
      const empCode = String(r['Employee Code'] || '').trim();
      const custCode = String(r['Customer Code'] || '').trim();
      const sapCode = String(r['SAP code'] || '').trim();
      let concat = '';
      if (custCode.startsWith('14')) {
        concat = `${empCode}-${custCode}`;
      } else {
        concat = `${empCode}-${sapCode}`;
      }
      return [
        periodMonth, Number(r['SI']) || 0, parseDateVal(r['Date of Visit']),
        custCode, r['Customer Name'] ? String(r['Customer Name']).trim() : null,
        r['Route'] ? String(r['Route']).trim() : null, r['Type'] ? String(r['Type']).trim() : null,
        r['Branch'] ? String(r['Branch']).trim() : null, empCode,
        r['Employee Name'] ? String(r['Employee Name']).trim() : null,
        r['Check In Time'] ? String(r['Check In Time']) : null,
        r['Check Out Time'] ? String(r['Check Out Time']) : null,
        r['Duration'] ? String(r['Duration']) : null,
        r['Visit Status(Productive / Non productive)'] ? String(r['Visit Status(Productive / Non productive)']) : null,
        r['Remarks'] ? String(r['Remarks']) : null,
        r['Purpose Of Visit'] ? String(r['Purpose Of Visit']) : null,
        sapCode, concat, r['Bucket'] ? String(r['Bucket']).trim() : null
      ];
    });

    if (cvrData.length > 0) {
      await dbRun('DELETE FROM nontrade_customer_visit_reports WHERE period_month = ?', [periodMonth]);
      const cvrSql = `
        INSERT INTO nontrade_customer_visit_reports (
          period_month, si_no, visit_date, customer_code, customer_name,
          route, type, branch, emp_code, emp_name,
          check_in_time, check_out_time, duration, visit_status,
          remarks, purpose_of_visit, sap_code, concat_id, bucket
        ) VALUES ?
      `;
      for (let i = 0; i < cvrData.length; i += 500) {
        await dbRun(cvrSql, [cvrData.slice(i, i + 500)]);
      }
      importStats.cvrInserted += cvrData.length;
    }
  }

  // 6. New Leads
  if (sheetNames.includes('New Lead')) {
    const ws = wb.Sheets['New Lead'];
    const rows = xlsx.utils.sheet_to_json(ws);
    const nlData = rows.map(r => [
      periodMonth, parseDateVal(r['Date']),
      r['Firm'] ? String(r['Firm']).trim() : null,
      r['Contact Person'] ? String(r['Contact Person']).trim() : null,
      r['Mobile'] ? String(r['Mobile']).trim() : null,
      r['Branch'] ? String(r['Branch']).trim() : null,
      r['Area'] ? String(r['Area']).trim() : null,
      r['Address'] ? String(r['Address']).trim() : null,
      r['Category'] ? String(r['Category']).trim() : null,
      r['Sub-Category'] ? String(r['Sub-Category']).trim() : null,
      String(r['Emp Code'] || '').trim(),
      r['Created By'] ? String(r['Created By']).trim() : null,
      r['Department'] ? String(r['Department']).trim() : null
    ]);

    if (nlData.length > 0) {
      await dbRun('DELETE FROM nontrade_leads WHERE period_month = ?', [periodMonth]);
      const nlSql = `
        INSERT INTO nontrade_leads (
          period_month, lead_date, firm, contact_person, mobile,
          branch, area, address, category, sub_category,
          emp_code, created_by, department
        ) VALUES ?
      `;
      for (let i = 0; i < nlData.length; i += 500) {
        await dbRun(nlSql, [nlData.slice(i, i + 500)]);
      }
      importStats.leadsInserted += nlData.length;
    }
  }

  // 7. Site Visits
  if (sheetNames.includes('Site Visit')) {
    const ws = wb.Sheets['Site Visit'];
    const rows = xlsx.utils.sheet_to_json(ws);
    const svData = rows.map(r => [
      periodMonth, parseDateVal(r['Date']),
      String(r['Emp Code'] || '').trim(),
      r['Emp Name'] ? String(r['Emp Name']).trim() : null,
      r['Branch'] ? String(r['Branch']).trim() : null,
      r['Place'] ? String(r['Place']).trim() : null,
      r['Name'] ? String(r['Name']).trim() : null,
      r['Category'] ? String(r['Category']).trim() : null,
      r['Contact no'] ? String(r['Contact no']).trim() : null,
      Number(r['Total Consumption (Bag)']) || null,
      Number(r['Balance Consumption (Bag)']) || null,
      r['Visit Status'] ? String(r['Visit Status']).trim() : null
    ]);

    if (svData.length > 0) {
      await dbRun('DELETE FROM nontrade_site_visits WHERE period_month = ?', [periodMonth]);
      const svSql = `
        INSERT INTO nontrade_site_visits (
          period_month, visit_date, emp_code, emp_name,
          branch, place, name, category, contact_no,
          total_consumption_bag, balance_consumption_bag, visit_status
        ) VALUES ?
      `;
      await dbRun(svSql, [svData]);
      importStats.siteVisitsInserted += svData.length;
    }
  }

  // 8. Professional Visits
  if (sheetNames.includes('Professional Visit')) {
    const ws = wb.Sheets['Professional Visit'];
    const rows = xlsx.utils.sheet_to_json(ws);
    const pvData = rows.map(r => [
      periodMonth, parseDateVal(r['Date']),
      String(r['Employee Code'] || '').trim(),
      r['Employee Name'] ? String(r['Employee Name']).trim() : null,
      r['Branch'] ? String(r['Branch']).trim() : null,
      r['Zone'] ? String(r['Zone']).trim() : null,
      r['Name'] ? String(r['Name']).trim() : null,
      r['Mobile No.'] ? String(r['Mobile No.']).trim() : null,
      r['Type'] ? String(r['Type']).trim() : null,
      r['Organisation'] ? String(r['Organisation']).trim() : null,
      r['Designation'] ? String(r['Designation']).trim() : null
    ]);

    if (pvData.length > 0) {
      await dbRun('DELETE FROM nontrade_professional_visits WHERE period_month = ?', [periodMonth]);
      const pvSql = `
        INSERT INTO nontrade_professional_visits (
          period_month, visit_date, emp_code, emp_name,
          branch, zone, name, mobile_no, type, organisation, designation
        ) VALUES ?
      `;
      await dbRun(pvSql, [pvData]);
      importStats.profVisitsInserted += pvData.length;
    }
  }

  // Log upload
  await dbRun(`
    INSERT INTO nontrade_uploads (period_month, file_type, file_name, record_count)
    VALUES (?, ?, ?, ?)
  `, [
    periodMonth,
    importStats.cvrInserted > 0 ? 'EXECUTION_SHEET' : 'PLANNING_SHEET',
    fileName,
    importStats.plansInserted + importStats.hoPlansInserted + importStats.cvrInserted
  ]);

  return importStats;
}

/**
 * Check if Non-Trade employees exist in master tables and whether adherence can be tracked
 */
export async function checkNonTradeEmployeesInMaster(periodMonth = '2026-09') {
  await ensureNonTradePlansForMonth(periodMonth);
  // Get all unique employees appearing in Non-Trade plans or execution
  const empRows = await dbAll(`
    SELECT DISTINCT role_type, emp_code, emp_name FROM nontrade_plans WHERE period_month = ? AND emp_code != '' AND emp_code NOT LIKE '%HO-SALES%'
    UNION
    SELECT DISTINCT role_type, emp_code, emp_name FROM nontrade_ho_plans WHERE period_month = ? AND emp_code != '' AND emp_code NOT LIKE '%HO-SALES%'
    UNION
    SELECT DISTINCT 'Officer' as role_type, emp_code, emp_name FROM nontrade_customer_visit_reports WHERE period_month = ? AND emp_code != ''
    UNION
    SELECT DISTINCT 'Officer' as role_type, emp_code, created_by as emp_name FROM nontrade_leads WHERE period_month = ? AND emp_code != ''
    UNION
    SELECT DISTINCT 'Officer' as role_type, emp_code, emp_name FROM nontrade_professional_visits WHERE period_month = ? AND emp_code != ''
  `, [periodMonth, periodMonth, periodMonth, periodMonth, periodMonth]);

  const verifiedList = [];
  let verifiedCount = 0;

  // Deduplicate by emp_code
  const seenCodes = new Set();
  const dedupedRows = [];
  for (const r of empRows) {
    const code = String(r.emp_code).trim();
    if (!code || code === 'undefined' || code === 'null' || seenCodes.has(code)) continue;
    seenCodes.add(code);
    dedupedRows.push(r);
  }

  for (const emp of dedupedRows) {
    const code = String(emp.emp_code).trim();

    // Check master_employees
    const masterMatches = await dbAll(
      'SELECT emp_code, emp_name, designation, zone, region, role, is_active FROM master_employees WHERE emp_code = ?',
      [code]
    );

    // Check employee_master (SFA master)
    const sfaMatches = await dbAll(
      'SELECT emp_code, dns_emp_code, emp_name, designation, hq, zone, state, app_access FROM employee_master WHERE dns_emp_code = ? OR emp_code = ?',
      [code, code]
    );

    const inMaster = masterMatches.length > 0;
    const inSfa = sfaMatches.length > 0;
    const isAvailable = inMaster || inSfa;
    if (isAvailable) verifiedCount++;

    const primaryDesignation = inMaster ? masterMatches[0].designation : (inSfa ? sfaMatches[0].designation : 'N/A');
    const primaryHq = inSfa ? sfaMatches[0].hq : (inMaster ? masterMatches[0].zone : 'N/A');

    verifiedList.push({
      role: emp.role_type,
      empCode: code,
      empName: emp.emp_name,
      inMasterEmployees: inMaster,
      inEmployeeMaster: inSfa,
      isAvailable,
      designation: primaryDesignation,
      hq: primaryHq,
      zone: inMaster ? masterMatches[0].zone : (inSfa ? sfaMatches[0].zone : 'N/A'),
      trackingStatus: isAvailable ? 'AUTOMATIC TRACKING ACTIVE' : 'PENDING MASTER SYNC'
    });
  }

  // Sort by role (Officer, ASM, HOS) and name
  const roleRank = { 'Officer': 1, 'ASM': 2, 'HOS': 3 };
  verifiedList.sort((a, b) => (roleRank[a.role] || 99) - (roleRank[b.role] || 99) || a.empName.localeCompare(b.empName));

  return {
    periodMonth,
    totalEmployees: verifiedList.length,
    verifiedCount,
    verificationRatePct: verifiedList.length > 0 ? ((verifiedCount / verifiedList.length) * 100).toFixed(1) : 100,
    canBeTrackedAutomatically: verifiedCount > 0,
    employees: verifiedList
  };
}

/**
 * Calculate Adherence and Bucket Summary matching Excel formulas
 */
export async function calculateNonTradeAdherence(periodMonth = '2026-09', asOnDate = null) {
  // Dynamically ensure plans and execution baseline exist for any requested month
  await ensureNonTradePlansForMonth(periodMonth);

  // Ensure cutoffDate is valid and belongs to the periodMonth
  let cutoffDate = asOnDate;
  if (!cutoffDate || !cutoffDate.startsWith(periodMonth)) {
    const parts = periodMonth.split('-');
    const year = Number(parts[0]) || 2026;
    const month = Number(parts[1]) || 9;
    const lastDay = new Date(year, month, 0).getDate();
    cutoffDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }

  // 1. Fetch Customer Visit Reports
  const cvrRows = await dbAll(
    'SELECT emp_code, concat_id, bucket, customer_code, sap_code FROM nontrade_customer_visit_reports WHERE period_month = ?',
    [periodMonth]
  );

  const cvrConcatMap = new Map();
  const cvrEmpMap = new Map();
  const cvrBucketMap = new Map();

  cvrRows.forEach(r => {
    const cid = String(r.concat_id || '').trim();
    if (cid) cvrConcatMap.set(cid, (cvrConcatMap.get(cid) || 0) + 1);

    const ec = String(r.emp_code || '').trim();
    if (ec) cvrEmpMap.set(ec, (cvrEmpMap.get(ec) || 0) + 1);

    const b = String(r.bucket || '').trim();
    if (b) cvrBucketMap.set(b, (cvrBucketMap.get(b) || 0) + 1);
  });

  // 2. Leads count per employee
  const leadRows = await dbAll(
    'SELECT emp_code, COUNT(*) as c FROM nontrade_leads WHERE period_month = ? GROUP BY emp_code',
    [periodMonth]
  );
  const leadEmpMap = new Map(leadRows.map(r => [String(r.emp_code).trim(), Number(r.c)]));

  // 3. Site visits count per employee
  const svRows = await dbAll(
    'SELECT emp_code, COUNT(*) as c FROM nontrade_site_visits WHERE period_month = ? GROUP BY emp_code',
    [periodMonth]
  );
  const svEmpMap = new Map(svRows.map(r => [String(r.emp_code).trim(), Number(r.c)]));

  // 4. Professional visits count per employee
  const pvRows = await dbAll(
    'SELECT emp_code, COUNT(*) as c FROM nontrade_professional_visits WHERE period_month = ? GROUP BY emp_code',
    [periodMonth]
  );
  const pvEmpMap = new Map(pvRows.map(r => [String(r.emp_code).trim(), Number(r.c)]));

  // 5. Fetch all plans
  const plans = await dbAll(
    `SELECT role_type, emp_code, emp_name, sap_code, party_name, destination_zone,
            ship_to_party_name, ship_to_party, segment, bucket, priority, model_visits,
            date_of_visit_1, date_of_visit_2, date_of_visit_3,
            ho_visit_date_1, ho_visit_date_2, concat_id
     FROM nontrade_plans WHERE period_month = ?`,
    [periodMonth]
  );

  // 6. Fetch all HO plans
  const hoPlans = await dbAll(
    `SELECT role_type, emp_code, emp_name, sap_code, party_name,
            ho_visit_date_1, ho_visit_date_2, concat_id
     FROM nontrade_ho_plans WHERE period_month = ?`,
    [periodMonth]
  );

  // Initialize employee map
  const empMap = new Map();
  function getOrInitEmp(role, code, name) {
    const cleanCode = String(code).trim();
    if (!empMap.has(cleanCode)) {
      empMap.set(cleanCode, {
        role,
        empCode: cleanCode,
        empName: name,
        modelVisits: 0,
        plannedSites: 0,
        plannedHo: 0,
        proratedSites: 0,
        proratedHo: 0,
        doneSites: 0,
        doneHo: 0,
        cvrDone: cvrEmpMap.get(cleanCode) || 0,
        leadsDone: leadEmpMap.get(cleanCode) || 0,
        siteVisitsDone: svEmpMap.get(cleanCode) || 0,
        profVisitsDone: pvEmpMap.get(cleanCode) || 0
      });
    }
    return empMap.get(cleanCode);
  }

  // Initialize bucket tracking
  const bucketMap = new Map();
  const BUCKET_ORDER = ['Zero-lifter', 'Penetrate', 'Retain', 'Prospective', 'To be dorment', 'HO'];
  BUCKET_ORDER.forEach(b => {
    bucketMap.set(b, {
      bucket: b,
      count: 0,
      modelVisits: 0,
      plannedSites: 0,
      plannedHo: 0,
      proratedSites: 0,
      proratedHo: 0,
      doneSites: 0,
      doneHo: 0,
      totalVisitsDone: 0
    });
  });

  // Calculate Site Plans
  for (const p of plans) {
    const emp = getOrInitEmp(p.role_type, p.emp_code, p.emp_name);
    emp.modelVisits += Number(p.model_visits) || 0;

    const siteDates = [p.date_of_visit_1, p.date_of_visit_2, p.date_of_visit_3].filter(d => d && d !== 'NA' && d !== '0');
    const plannedCount = siteDates.length;
    const proratedCount = siteDates.filter(d => d <= cutoffDate).length;

    emp.plannedSites += plannedCount;
    emp.proratedSites += proratedCount;

    const cid = String(p.concat_id || '').trim();
    const actualVisits = cvrConcatMap.get(cid) || 0;
    const doneForCounter = Math.min(actualVisits, plannedCount);
    emp.doneSites += doneForCounter;

    // Bucket tracking
    const bName = p.bucket || '';
    if (bucketMap.has(bName)) {
      const bObj = bucketMap.get(bName);
      if (p.role_type === 'Officer') bObj.count++;
      bObj.modelVisits += Number(p.model_visits) || 0;
      bObj.plannedSites += plannedCount;
      bObj.proratedSites += proratedCount;
      bObj.doneSites += doneForCounter;
    }
  }

  // Calculate HO Plans
  for (const hp of hoPlans) {
    const emp = getOrInitEmp(hp.role_type, hp.emp_code, hp.emp_name);
    const hoDates = [hp.ho_visit_date_1, hp.ho_visit_date_2].filter(d => d && d !== 'NA' && d !== '0');
    const plannedCount = hoDates.length;
    const proratedCount = hoDates.filter(d => d <= cutoffDate).length;

    emp.plannedHo += plannedCount;
    emp.proratedHo += proratedCount;

    const cid = String(hp.concat_id || '').trim();
    const actualVisits = cvrConcatMap.get(cid) || 0;
    const doneForHo = Math.min(actualVisits, plannedCount);
    emp.doneHo += doneForHo;

    // Bucket HO
    const bObj = bucketMap.get('HO');
    bObj.plannedHo += plannedCount;
    bObj.proratedHo += proratedCount;
    bObj.doneHo += doneForHo;
  }

  // Format Employee List
  const roleRank = { 'Officer': 1, 'ASM': 2, 'HOS': 3 };
  const employees = Array.from(empMap.values())
    .filter(e => e.empCode && e.empCode !== 'undefined' && e.empCode !== 'null' && !e.empCode.startsWith('HO-SALES'))
    .map(e => {
      const totalPlanned = e.plannedSites + e.plannedHo;
      const totalProrated = e.proratedSites + e.proratedHo;
      const plannedDone = e.doneSites + e.doneHo;
      const totalVisitsDone = e.cvrDone + e.leadsDone + e.siteVisitsDone + e.profVisitsDone;
      const unplannedDone = totalVisitsDone - plannedDone;
      const adherencePct = totalProrated > 0 ? (plannedDone / totalProrated) * 100 : 0;
      const achievementPct = totalPlanned > 0 ? (totalVisitsDone / totalPlanned) * 100 : 0;

      return {
        role: e.role,
        empCode: e.empCode,
        empName: e.empName,
        modelVisits: Math.round(e.modelVisits * 10) / 10,
        totalPlanned,
        plannedSites: e.plannedSites,
        plannedHo: e.plannedHo,
        totalProrated,
        proratedSites: e.proratedSites,
        proratedHo: e.proratedHo,
        plannedDone,
        plannedDoneSites: e.doneSites,
        plannedDoneHo: e.doneHo,
        unplannedDone,
        leadsDone: e.leadsDone,
        cvrDone: e.cvrDone,
        siteVisitsDone: e.siteVisitsDone,
        profVisitsDone: e.profVisitsDone,
        totalVisitsDone,
        adherencePct: Math.round(adherencePct * 10) / 10,
        achievementPct: Math.round(achievementPct * 10) / 10
      };
    });

  employees.sort((a, b) => (roleRank[a.role] || 99) - (roleRank[b.role] || 99) || a.empName.localeCompare(b.empName));

  // Format Bucket Summary List
  const buckets = Array.from(bucketMap.values()).map(b => {
    const totalPlanned = b.plannedSites + b.plannedHo;
    const totalProrated = b.proratedSites + b.proratedHo;
    const plannedDone = b.doneSites + b.doneHo;
    const totalDone = cvrBucketMap.get(b.bucket) || 0;
    const unplannedDone = totalDone - plannedDone;
    const adhPct = totalProrated > 0 ? (plannedDone / totalProrated) * 100 : 0;
    const achPct = totalPlanned > 0 ? (totalDone / totalPlanned) * 100 : 0;

    return {
      bucket: b.bucket,
      count: b.count,
      modelVisits: Math.round(b.modelVisits * 10) / 10,
      totalPlanned,
      plannedSites: b.plannedSites,
      plannedHo: b.plannedHo,
      totalProrated,
      proratedSites: b.proratedSites,
      proratedHo: b.proratedHo,
      plannedDone,
      plannedDoneSites: b.doneSites,
      plannedDoneHo: b.doneHo,
      unplannedDone,
      totalVisitsDone: totalDone,
      adherencePct: Math.round(adhPct * 10) / 10,
      achievementPct: Math.round(achPct * 10) / 10
    };
  });

  // Calculate Overall Totals
  const overall = {
    totalEmployees: employees.length,
    totalPlanned: employees.reduce((s, e) => s + e.totalPlanned, 0),
    totalProrated: employees.reduce((s, e) => s + e.totalProrated, 0),
    plannedDone: employees.reduce((s, e) => s + e.plannedDone, 0),
    unplannedDone: employees.reduce((s, e) => s + e.unplannedDone, 0),
    totalVisitsDone: employees.reduce((s, e) => s + e.totalVisitsDone, 0),
    totalCvr: cvrRows.length,
    totalLeads: leadRows.reduce((s, r) => s + Number(r.c), 0),
    totalSiteVisits: svRows.reduce((s, r) => s + Number(r.c), 0),
    totalProfVisits: pvRows.reduce((s, r) => s + Number(r.c), 0),
    adherencePct: 0,
    achievementPct: 0
  };
  overall.adherencePct = overall.totalProrated > 0 ? Math.round((overall.plannedDone / overall.totalProrated) * 1000) / 10 : 0;
  overall.achievementPct = overall.totalPlanned > 0 ? Math.round((overall.totalVisitsDone / overall.totalPlanned) * 1000) / 10 : 0;

  // Master employee check
  const masterCheck = await checkNonTradeEmployeesInMaster(periodMonth);

  return {
    periodMonth,
    cutoffDate,
    overall,
    employees,
    buckets,
    masterCheck
  };
}

/**
 * Get Paginated Counter Plans
 */
export async function getNonTradePlans({ periodMonth = '2026-09', roleType, empCode, bucket, search, page = 1, limit = 50 }) {
  await ensureNonTradePlansForMonth(periodMonth);
  const whereClauses = ['period_month = ?'];
  const params = [periodMonth];

  if (roleType && roleType !== 'ALL') {
    whereClauses.push('role_type = ?');
    params.push(roleType);
  }
  if (empCode && empCode !== 'ALL') {
    whereClauses.push('emp_code = ?');
    params.push(empCode);
  }
  if (bucket && bucket !== 'ALL') {
    whereClauses.push('bucket = ?');
    params.push(bucket);
  }
  if (search) {
    whereClauses.push('(emp_name LIKE ? OR party_name LIKE ? OR ship_to_party_name LIKE ? OR destination_zone LIKE ? OR ship_to_party LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term, term);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const totalRow = await dbGet(`SELECT COUNT(*) as total FROM nontrade_plans ${whereSql}`, params);
  const total = totalRow?.total || 0;

  const offset = (Math.max(1, page) - 1) * limit;
  const plans = await dbAll(
    `SELECT * FROM nontrade_plans ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    plans
  };
}

/**
 * Get Paginated HO Plans
 */
export async function getNonTradeHoPlans({ periodMonth = '2026-09', roleType, empCode, search, page = 1, limit = 50 }) {
  await ensureNonTradePlansForMonth(periodMonth);
  const whereClauses = ['period_month = ?'];
  const params = [periodMonth];

  if (roleType && roleType !== 'ALL') {
    whereClauses.push('role_type = ?');
    params.push(roleType);
  }
  if (empCode && empCode !== 'ALL') {
    whereClauses.push('emp_code = ?');
    params.push(empCode);
  }
  if (search) {
    whereClauses.push('(emp_name LIKE ? OR party_name LIKE ? OR sap_code LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const totalRow = await dbGet(`SELECT COUNT(*) as total FROM nontrade_ho_plans ${whereSql}`, params);
  const total = totalRow?.total || 0;

  const offset = (Math.max(1, page) - 1) * limit;
  const hoPlans = await dbAll(
    `SELECT * FROM nontrade_ho_plans ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    hoPlans
  };
}

/**
 * Get Paginated Customer Visit Reports
 */
export async function getNonTradeCustomerVisits({ periodMonth = '2026-09', empCode, bucket, search, page = 1, limit = 50 }) {
  await ensureNonTradePlansForMonth(periodMonth);
  const whereClauses = ['period_month = ?'];
  const params = [periodMonth];

  if (empCode && empCode !== 'ALL') {
    whereClauses.push('emp_code = ?');
    params.push(empCode);
  }
  if (bucket && bucket !== 'ALL') {
    whereClauses.push('bucket = ?');
    params.push(bucket);
  }
  if (search) {
    whereClauses.push('(emp_name LIKE ? OR customer_name LIKE ? OR customer_code LIKE ? OR route LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
  const totalRow = await dbGet(`SELECT COUNT(*) as total FROM nontrade_customer_visit_reports ${whereSql}`, params);
  const total = totalRow?.total || 0;

  const offset = (Math.max(1, page) - 1) * limit;
  const visits = await dbAll(
    `SELECT * FROM nontrade_customer_visit_reports ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    visits
  };
}

/**
 * Get Paginated Leads
 */
export async function getNonTradeLeads({ periodMonth = '2026-09', empCode, search, page = 1, limit = 50 }) {
  await ensureNonTradePlansForMonth(periodMonth);
  const whereClauses = ['period_month = ?'];
  const params = [periodMonth];

  if (empCode && empCode !== 'ALL') {
    whereClauses.push('emp_code = ?');
    params.push(empCode);
  }
  if (search) {
    whereClauses.push('(firm LIKE ? OR contact_person LIKE ? OR created_by LIKE ? OR branch LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
  const totalRow = await dbGet(`SELECT COUNT(*) as total FROM nontrade_leads ${whereSql}`, params);
  const total = totalRow?.total || 0;

  const offset = (Math.max(1, page) - 1) * limit;
  const leads = await dbAll(
    `SELECT * FROM nontrade_leads ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    leads
  };
}

/**
 * Get Paginated Site Visits
 */
export async function getNonTradeSiteVisits({ periodMonth = '2026-09', empCode, search, page = 1, limit = 50 }) {
  await ensureNonTradePlansForMonth(periodMonth);
  const whereClauses = ['period_month = ?'];
  const params = [periodMonth];

  if (empCode && empCode !== 'ALL') {
    whereClauses.push('emp_code = ?');
    params.push(empCode);
  }
  if (search) {
    whereClauses.push('(emp_name LIKE ? OR name LIKE ? OR place LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
  const totalRow = await dbGet(`SELECT COUNT(*) as total FROM nontrade_site_visits ${whereSql}`, params);
  const total = totalRow?.total || 0;

  const offset = (Math.max(1, page) - 1) * limit;
  const siteVisits = await dbAll(
    `SELECT * FROM nontrade_site_visits ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    siteVisits
  };
}

/**
 * Get Paginated Professional Visits
 */
export async function getNonTradeProfessionalVisits({ periodMonth = '2026-09', empCode, search, page = 1, limit = 50 }) {
  await ensureNonTradePlansForMonth(periodMonth);
  const whereClauses = ['period_month = ?'];
  const params = [periodMonth];

  if (empCode && empCode !== 'ALL') {
    whereClauses.push('emp_code = ?');
    params.push(empCode);
  }
  if (search) {
    whereClauses.push('(emp_name LIKE ? OR name LIKE ? OR organisation LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
  const totalRow = await dbGet(`SELECT COUNT(*) as total FROM nontrade_professional_visits ${whereSql}`, params);
  const total = totalRow?.total || 0;

  const offset = (Math.max(1, page) - 1) * limit;
  const profVisits = await dbAll(
    `SELECT * FROM nontrade_professional_visits ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    profVisits
  };
}

/**
 * Export Non-Trade DJP Workbook with all tabs styled cleanly
 */
export async function generateNonTradeExcelExport(periodMonth = '2026-09', asOnDate = null) {
  const adh = await calculateNonTradeAdherence(periodMonth, asOnDate);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Star Cement DJP Platform';
  wb.created = new Date();

  // Helper for header styling
  const styleHeader = (row, bgHex = '1E3A8A') => {
    row.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgHex }
    };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.height = 24;
  };

  // 1. Sheet: Adherence Tracker
  const wsAdh = wb.addWorksheet('Adherence Tracker');
  wsAdh.columns = [
    { header: 'Role', key: 'role', width: 12 },
    { header: 'Emp Code', key: 'empCode', width: 14 },
    { header: 'Names', key: 'empName', width: 26 },
    { header: 'Model Visits', key: 'modelVisits', width: 14 },
    { header: 'Planned (Sites+HO)', key: 'totalPlanned', width: 18 },
    { header: 'Planned (Sites)', key: 'plannedSites', width: 16 },
    { header: 'Planned (HO)', key: 'plannedHo', width: 14 },
    { header: 'Prorated (Sites+HO)', key: 'totalProrated', width: 18 },
    { header: 'Prorated (Sites)', key: 'proratedSites', width: 16 },
    { header: 'Prorated (HO)', key: 'proratedHo', width: 14 },
    { header: 'Done (Sites+HO)', key: 'plannedDone', width: 16 },
    { header: 'Done (Sites)', key: 'plannedDoneSites', width: 14 },
    { header: 'Done (HO)', key: 'plannedDoneHo', width: 14 },
    { header: 'Unplanned Done', key: 'unplannedDone', width: 16 },
    { header: 'New Lead & KYC', key: 'leadsDone', width: 16 },
    { header: 'Total Visits Done', key: 'totalVisitsDone', width: 16 },
    { header: 'Adherence %', key: 'adherencePct', width: 14 },
    { header: 'Achievement %', key: 'achievementPct', width: 15 },
    { header: 'CVR Visits', key: 'cvrDone', width: 14 },
    { header: 'Site Visits', key: 'siteVisitsDone', width: 14 },
    { header: 'Prof Visits', key: 'profVisitsDone', width: 14 }
  ];
  styleHeader(wsAdh.getRow(1), '0F172A');

  adh.employees.forEach(e => {
    wsAdh.addRow({
      role: e.role,
      empCode: e.empCode,
      empName: e.empName,
      modelVisits: e.modelVisits,
      totalPlanned: e.totalPlanned,
      plannedSites: e.plannedSites,
      plannedHo: e.plannedHo,
      totalProrated: e.totalProrated,
      proratedSites: e.proratedSites,
      proratedHo: e.proratedHo,
      plannedDone: e.plannedDone,
      plannedDoneSites: e.plannedDoneSites,
      plannedDoneHo: e.plannedDoneHo,
      unplannedDone: e.unplannedDone,
      leadsDone: e.leadsDone,
      totalVisitsDone: e.totalVisitsDone,
      adherencePct: `${e.adherencePct}%`,
      achievementPct: `${e.achievementPct}%`,
      cvrDone: e.cvrDone,
      siteVisitsDone: e.siteVisitsDone,
      profVisitsDone: e.profVisitsDone
    });
  });

  // 2. Sheet: Category / Bucket Summary
  const wsBucket = wb.addWorksheet('Category Summary');
  wsBucket.columns = [
    { header: 'Category / Bucket', key: 'bucket', width: 20 },
    { header: 'Counter Count', key: 'count', width: 14 },
    { header: 'Model Visits', key: 'modelVisits', width: 14 },
    { header: 'Planned (Sites+HO)', key: 'totalPlanned', width: 18 },
    { header: 'Planned (Sites)', key: 'plannedSites', width: 16 },
    { header: 'Planned (HO)', key: 'plannedHo', width: 14 },
    { header: 'Prorated (Sites+HO)', key: 'totalProrated', width: 18 },
    { header: 'Done (Sites+HO)', key: 'plannedDone', width: 16 },
    { header: 'Unplanned Done', key: 'unplannedDone', width: 16 },
    { header: 'Total Visits Done', key: 'totalVisitsDone', width: 16 },
    { header: 'Adherence %', key: 'adherencePct', width: 14 },
    { header: 'Achievement %', key: 'achievementPct', width: 15 }
  ];
  styleHeader(wsBucket.getRow(1), '1E3A8A');

  adh.buckets.forEach(b => {
    wsBucket.addRow({
      bucket: b.bucket,
      count: b.count,
      modelVisits: b.modelVisits,
      totalPlanned: b.totalPlanned,
      plannedSites: b.plannedSites,
      plannedHo: b.plannedHo,
      totalProrated: b.totalProrated,
      plannedDone: b.plannedDone,
      unplannedDone: b.unplannedDone,
      totalVisitsDone: b.totalVisitsDone,
      adherencePct: `${b.adherencePct}%`,
      achievementPct: `${b.achievementPct}%`
    });
  });

  // 3. Sheet: Officer Plans
  const wsOff = wb.addWorksheet('Officer Plans');
  wsOff.columns = [
    { header: 'Officer', key: 'emp_name', width: 22 },
    { header: 'Emp Code', key: 'emp_code', width: 14 },
    { header: 'SAP Code', key: 'sap_code', width: 14 },
    { header: 'Party Name', key: 'party_name', width: 26 },
    { header: 'Destination', key: 'destination_zone', width: 18 },
    { header: 'Ship-to Name', key: 'ship_to_party_name', width: 26 },
    { header: 'Ship-to Party', key: 'ship_to_party', width: 16 },
    { header: 'Segment', key: 'segment', width: 12 },
    { header: 'Bucket', key: 'bucket', width: 14 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Model Visits', key: 'model_visits', width: 12 },
    { header: 'Visit Date 1', key: 'date_of_visit_1', width: 14 },
    { header: 'Visit Date 2', key: 'date_of_visit_2', width: 14 },
    { header: 'Visit Date 3', key: 'date_of_visit_3', width: 14 },
    { header: 'HO Date 1', key: 'ho_visit_date_1', width: 14 },
    { header: 'HO Date 2', key: 'ho_visit_date_2', width: 14 },
    { header: 'Remarks', key: 'remarks', width: 20 },
    { header: 'Concat ID', key: 'concat_id', width: 22 }
  ];
  styleHeader(wsOff.getRow(1), '2563EB');

  const offPlans = await dbAll('SELECT * FROM nontrade_plans WHERE period_month = ? AND role_type = "Officer"', [periodMonth]);
  offPlans.forEach(p => wsOff.addRow(p));

  // 4. Sheet: ASM Plans
  const wsAsm = wb.addWorksheet('ASM Plans');
  wsAsm.columns = [
    { header: 'ASM', key: 'emp_name', width: 22 },
    { header: 'ASM Emp Code', key: 'emp_code', width: 14 },
    { header: 'SAP Code', key: 'sap_code', width: 14 },
    { header: 'Party Name', key: 'party_name', width: 26 },
    { header: 'Destination', key: 'destination_zone', width: 18 },
    { header: 'Ship-to Name', key: 'ship_to_party_name', width: 26 },
    { header: 'Ship-to Party', key: 'ship_to_party', width: 16 },
    { header: 'Segment', key: 'segment', width: 12 },
    { header: 'Bucket', key: 'bucket', width: 14 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Model Visits', key: 'model_visits', width: 12 },
    { header: 'Visit Date 1', key: 'date_of_visit_1', width: 14 },
    { header: 'Visit Date 2', key: 'date_of_visit_2', width: 14 },
    { header: 'Visit Date 3', key: 'date_of_visit_3', width: 14 },
    { header: 'HO Date 1', key: 'ho_visit_date_1', width: 14 },
    { header: 'HO Date 2', key: 'ho_visit_date_2', width: 14 }
  ];
  styleHeader(wsAsm.getRow(1), '7C3AED');
  const asmPlans = await dbAll('SELECT * FROM nontrade_plans WHERE period_month = ? AND role_type = "ASM"', [periodMonth]);
  asmPlans.forEach(p => wsAsm.addRow(p));

  // 5. Sheet: HOS Plans
  const wsHos = wb.addWorksheet('HOS Plans');
  wsHos.columns = [
    { header: 'HOS', key: 'emp_name', width: 22 },
    { header: 'HOS Emp Code', key: 'emp_code', width: 14 },
    { header: 'ASM', key: 'asm_name', width: 20 },
    { header: 'SAP Code', key: 'sap_code', width: 14 },
    { header: 'Party Name', key: 'party_name', width: 26 },
    { header: 'Destination', key: 'destination_zone', width: 18 },
    { header: 'Area', key: 'area', width: 16 },
    { header: 'Ship-to Name', key: 'ship_to_party_name', width: 26 },
    { header: 'Ship-to Party', key: 'ship_to_party', width: 16 },
    { header: 'Bucket', key: 'bucket', width: 14 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Model Visits', key: 'model_visits', width: 12 },
    { header: 'Visit Date 1', key: 'date_of_visit_1', width: 14 },
    { header: 'Visit Date 2', key: 'date_of_visit_2', width: 14 }
  ];
  styleHeader(wsHos.getRow(1), '059669');
  const hosPlans = await dbAll('SELECT * FROM nontrade_plans WHERE period_month = ? AND role_type = "HOS"', [periodMonth]);
  hosPlans.forEach(p => wsHos.addRow(p));

  // 6. Sheet: Customer Visit Report
  const wsCvr = wb.addWorksheet('Customer Visit Report');
  wsCvr.columns = [
    { header: 'SI', key: 'si_no', width: 8 },
    { header: 'Date of Visit', key: 'visit_date', width: 14 },
    { header: 'Customer Code', key: 'customer_code', width: 16 },
    { header: 'Customer Name', key: 'customer_name', width: 30 },
    { header: 'Route', key: 'route', width: 22 },
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Branch', key: 'branch', width: 22 },
    { header: 'Employee Code', key: 'emp_code', width: 16 },
    { header: 'Employee Name', key: 'emp_name', width: 24 },
    { header: 'Duration', key: 'duration', width: 20 },
    { header: 'Visit Status', key: 'visit_status', width: 16 },
    { header: 'Purpose', key: 'purpose_of_visit', width: 20 },
    { header: 'SAP Code', key: 'sap_code', width: 14 },
    { header: 'Concat ID', key: 'concat_id', width: 24 },
    { header: 'Bucket', key: 'bucket', width: 16 }
  ];
  styleHeader(wsCvr.getRow(1), 'D97706');
  const cvrList = await dbAll('SELECT * FROM nontrade_customer_visit_reports WHERE period_month = ?', [periodMonth]);
  cvrList.forEach(c => wsCvr.addRow(c));

  return wb;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * NON-TRADE PLAN ROLLOUT & FIELD APP INTEGRATION
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Roll out Non-Trade plans to make them active in the Field App
 */
export async function rolloutNonTradePlans({ periodMonth = '2026-09' } = {}) {
  const query = `
    UPDATE nontrade_plans
    SET status = 'ROLLED_OUT'
    WHERE period_month = ? AND (status = 'PENDING_ROLLOUT' OR status IS NULL)
  `;
  const result1 = await dbRun(query, [periodMonth]);

  const queryHo = `
    UPDATE nontrade_ho_plans
    SET status = 'ROLLED_OUT'
    WHERE period_month = ? AND (status = 'PENDING_ROLLOUT' OR status IS NULL)
  `;
  const result2 = await dbRun(queryHo, [periodMonth]);

  const updatedPlans = (result1?.changes || result1?.affectedRows || 0) + (result2?.changes || result2?.affectedRows || 0);

  return {
    success: true,
    message: `Non-Trade plans for ${periodMonth} rolled out successfully to the Field App.`,
    periodMonth,
    updatedPlans
  };
}

/**
 * Get rollout status of Non-Trade plans
 */
export async function getNonTradeRolloutStatus(periodMonth = '2026-09') {
  await ensureNonTradePlansForMonth(periodMonth);
  const rows = await dbAll(`
    SELECT status, COUNT(*) as cnt, COUNT(DISTINCT emp_code) as officers
    FROM nontrade_plans
    WHERE period_month = ? AND role_type = 'Officer'
    GROUP BY status
  `, [periodMonth]);

  let total = 0;
  let pending = 0;
  let rolledOut = 0;
  for (const r of rows) {
    total += Number(r.cnt);
    if (r.status === 'PENDING_ROLLOUT' || !r.status) pending += Number(r.cnt);
    if (r.status === 'ROLLED_OUT') rolledOut += Number(r.cnt);
  }

  return {
    periodMonth,
    totalCounters: total,
    pendingRollout: pending,
    rolledOut: rolledOut,
    isRolledOut: pending === 0 && rolledOut > 0,
    byStatus: Object.fromEntries(rows.map(r => [r.status || 'PENDING_ROLLOUT', Number(r.cnt)]))
  };
}

/**
 * Get Non-Trade plan summaries shaped for the Field App API (/api/app/officers/:empCode/plans)
 */
export async function getNonTradeOfficerPlanSummaries(empCode = null, periodMonth = null, includePending = false) {
  if (periodMonth) {
    await ensureNonTradePlansForMonth(periodMonth);
  }
  let where = 'role_type = "Officer"';
  const params = [];
  if (!includePending) {
    where += ' AND status != "PENDING_ROLLOUT"';
  }
  if (empCode) {
    where += ' AND UPPER(TRIM(emp_code)) = UPPER(TRIM(?))';
    params.push(empCode);
  }
  if (periodMonth) {
    where += ' AND period_month = ?';
    params.push(periodMonth);
  }

  const rows = await dbAll(`
    SELECT period_month, emp_code, emp_name, asm_emp_code, asm_name, hos_emp_code, hos_name,
           COUNT(*) as total_counters,
           SUM((CASE WHEN date_of_visit_1 IS NOT NULL AND date_of_visit_1 != 'NA' AND date_of_visit_1 != '0' THEN 1 ELSE 0 END) +
               (CASE WHEN date_of_visit_2 IS NOT NULL AND date_of_visit_2 != 'NA' AND date_of_visit_2 != '0' THEN 1 ELSE 0 END) +
               (CASE WHEN date_of_visit_3 IS NOT NULL AND date_of_visit_3 != 'NA' AND date_of_visit_3 != '0' THEN 1 ELSE 0 END)) as total_visits,
           status
    FROM nontrade_plans
    WHERE ${where}
    GROUP BY period_month, emp_code, emp_name, asm_emp_code, asm_name, hos_emp_code, hos_name, status
  `, params);

  return rows.map(r => ({
    plan_id: `NT-${r.emp_code}-${r.period_month}`,
    period_month: r.period_month,
    cycle_code: 'MONTHLY',
    status: r.status === 'ROLLED_OUT' ? 'APPROVED' : (r.status || 'DRAFT'),
    channel: 'NON_TRADE',
    employee: {
      emp_code: r.emp_code,
      emp_name: r.emp_name,
      role: 'Officer'
    },
    approver: {
      emp_code: r.asm_emp_code || r.hos_emp_code || '1100160',
      name: r.asm_name || r.hos_name || 'DEBASHISH DEY',
      role: r.asm_emp_code ? 'ASM' : 'HOS'
    },
    counts: {
      visits: Number(r.total_visits || 0),
      dealers: Number(r.total_counters || 0),
      working_days: 25
    },
    date_range: {
      from: `${r.period_month}-01`,
      to: `${r.period_month}-30`
    },
    rectification: { count: 0, remaining: 0, requested_by: null, requested_at: null, remarks: null },
    timestamps: { created_at: '2026-09-01 00:00:00', submitted_at: null, resubmitted_at: null, approved_at: '2026-09-01 00:00:00', last_edited_at: null },
    actions: {
      can_edit: false,
      can_submit: false,
      can_approve: false,
      can_rectify: false,
      can_punch: true
    }
  }));
}

/**
 * Get full day-by-day Non-Trade plan detail shaped for Field App / Simulator
 */
export async function getNonTradePlanDetail(planIdOrEmpCode, periodMonth = '2026-09') {
  let empCode = planIdOrEmpCode;
  let period = periodMonth;

  if (typeof planIdOrEmpCode === 'string' && planIdOrEmpCode.startsWith('NT-')) {
    const parts = planIdOrEmpCode.split('-');
    // format NT-empCode-YYYY-MM
    empCode = parts[1];
    if (parts.length >= 4) {
      period = `${parts[2]}-${parts[3]}`;
    }
  }

  await ensureNonTradePlansForMonth(period);

  // Get officer plans
  const counterRows = await dbAll(`
    SELECT * FROM nontrade_plans
    WHERE period_month = ? AND UPPER(TRIM(emp_code)) = UPPER(TRIM(?))
    ORDER BY priority ASC, id ASC
  `, [period, empCode]);

  if (!counterRows.length) {
    return null;
  }

  const first = counterRows[0];
  const hier = NONTRADE_HIERARCHY_MAP[first.emp_code] || {};
  const approverCode = first.asm_emp_code || hier.asm_code || '1100160';
  const approverName = first.asm_name || hier.asm_name || 'DEBASHISH DEY';

  // Get execution records from Customer Visit Report for this officer
  const cvrRows = await dbAll(`
    SELECT * FROM nontrade_customer_visit_reports
    WHERE period_month = ? AND UPPER(TRIM(emp_code)) = UPPER(TRIM(?))
  `, [period, empCode]);

  const cvrDateMap = new Map();
  for (const c of cvrRows) {
    const dStr = c.visit_date ? String(c.visit_date).slice(0, 10) : '';
    const cust = String(c.customer_code || '').trim();
    const sap = String(c.sap_code || '').trim();
    if (dStr) {
      if (cust) cvrDateMap.set(`${dStr}#${cust}`, c);
      if (sap) cvrDateMap.set(`${dStr}#${sap}`, c);
    }
  }

  // Group visits day by day
  const dayVisitsMap = new Map();
  const categoryMix = {};

  for (const row of counterRows) {
    const bucket = row.bucket || 'Unclassified';
    const dates = [row.date_of_visit_1, row.date_of_visit_2, row.date_of_visit_3, row.ho_visit_date_1, row.ho_visit_date_2]
      .filter(d => d && d !== 'NA' && d !== '0');

    for (let i = 0; i < dates.length; i++) {
      const vDate = dates[i];
      categoryMix[bucket] = (categoryMix[bucket] || 0) + 1;

      if (!dayVisitsMap.has(vDate)) {
        dayVisitsMap.set(vDate, []);
      }

      const shipCode = String(row.ship_to_party || '').trim();
      const sapCode = String(row.sap_code || '').trim();
      const exec = cvrDateMap.get(`${vDate}#${shipCode}`) || cvrDateMap.get(`${vDate}#${sapCode}`) || null;

      dayVisitsMap.get(vDate).push({
        detail_id: row.id * 10 + (i + 1),
        sequence: dayVisitsMap.get(vDate).length + 1,
        dealer: {
          dealer_id: row.id,
          sap_code: row.sap_code || null,
          sfa_code: row.ship_to_party || row.sap_code,
          name: row.ship_to_party_name || row.party_name,
          type: row.bucket || 'DEALER',
          area: row.destination_zone || 'AGARTALA',
          zone: 'NT',
          block: null,
          latitude: null,
          longitude: null,
          has_coordinates: false,
          route_name: row.destination_zone || 'NT Beat'
        },
        final_category: bucket,
        grade: 'NT',
        priority_score: row.priority || 0,
        distance_from_prev_km: 0,
        is_backdated_edit: false,
        purpose_of_visit: `Non-Trade Visit (${bucket})`,
        visit_status: 'ACTIVE',
        executed: Boolean(exec),
        execution: exec ? {
          check_in_time: exec.check_in_time || '10:05:00',
          check_out_time: exec.check_out_time || '10:39:00',
          duration: exec.duration || '34 Minute(s)',
          visit_status: exec.visit_status || 'Productive',
          remarks: exec.remarks || null
        } : null,
        source: 'NON_TRADE'
      });
    }
  }

  // Sort days chronologically
  const sortedDates = Array.from(dayVisitsMap.keys()).sort();
  const days = sortedDates.map(dateStr => ({
    visit_date: dateStr,
    visit_count: dayVisitsMap.get(dateStr).length,
    visits: dayVisitsMap.get(dateStr)
  }));

  const totalVisitsCount = days.reduce((sum, d) => sum + d.visit_count, 0);

  return {
    plan_id: `NT-${first.emp_code}-${period}`,
    period_month: period,
    cycle_code: 'MONTHLY',
    channel: 'NON_TRADE',
    status: first.status === 'ROLLED_OUT' ? 'APPROVED' : (first.status || 'DRAFT'),
    employee: {
      emp_code: first.emp_code,
      emp_name: first.emp_name,
      role: 'Officer'
    },
    approver: {
      emp_code: approverCode,
      name: approverName,
      role: 'ASM'
    },
    counts: {
      visits: totalVisitsCount,
      dealers: counterRows.length,
      working_days: days.length
    },
    date_range: {
      from: `${period}-01`,
      to: `${period}-30`
    },
    rectification: { count: 0, remaining: 0, requested_by: null, requested_at: null, remarks: null },
    timestamps: { created_at: '2026-09-01 00:00:00', submitted_at: null, resubmitted_at: null, approved_at: '2026-09-01 00:00:00', last_edited_at: null },
    actions: {
      can_edit: false,
      can_submit: false,
      can_approve: false,
      can_rectify: false,
      can_punch: true
    },
    category_mix: categoryMix,
    cycle_window: {
      from: `${period}-01`,
      to: `${period}-30`,
      daily_cap: 8,
      days: days.map(d => ({
        visit_date: d.visit_date,
        visit_count: d.visit_count,
        full: d.visit_count >= 8
      }))
    },
    days,
    history: []
  };
}

/**
 * Record a visit punch for a Non-Trade plan
 */
export async function recordNonTradeVisitPunch({
  empCode,
  visitDate,
  dealerCode,
  checkInTime = '10:05:00',
  checkOutTime = '10:39:00',
  visitStatus = 'Productive',
  purposeOfVisit = 'Non-Trade Scheduled Visit',
  remarks = null
}) {
  const periodMonth = visitDate ? visitDate.slice(0, 7) : '2026-09';

  // Look up counter details in nontrade_plans
  const ntCounter = await dbGet(`
    SELECT * FROM nontrade_plans
    WHERE (UPPER(TRIM(ship_to_party)) = UPPER(TRIM(?)) OR UPPER(TRIM(sap_code)) = UPPER(TRIM(?)))
    LIMIT 1
  `, [dealerCode, dealerCode]);

  // Look up employee name
  const emp = await dbGet(`
    SELECT emp_name FROM nontrade_plans WHERE UPPER(TRIM(emp_code)) = UPPER(TRIM(?)) LIMIT 1
  `, [empCode]);
  const empName = emp?.emp_name || 'Non-Trade Officer';

  const customerName = ntCounter?.ship_to_party_name || ntCounter?.party_name || dealerCode;
  const sapCode = ntCounter?.sap_code || (dealerCode.startsWith('11') ? dealerCode : null);
  const shipCode = ntCounter?.ship_to_party || (dealerCode.startsWith('14') ? dealerCode : dealerCode);
  const concatId = `${empCode}-${shipCode}`;
  const bucket = ntCounter?.bucket || 'Non-Trade';
  const branch = ntCounter?.destination_zone || 'NT';

  // Insert or update Customer Visit Report
  await dbRun(`
    INSERT INTO nontrade_customer_visit_reports (
      period_month, visit_date, customer_code, customer_name,
      route, type, branch, emp_code, emp_name,
      check_in_time, check_out_time, duration, visit_status,
      remarks, purpose_of_visit, sap_code, concat_id, bucket
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    periodMonth, visitDate, shipCode, customerName,
    branch, 'Non-Trade', branch, empCode, empName,
    checkInTime, checkOutTime, '34 Minute(s)', visitStatus,
    remarks, purposeOfVisit, sapCode, concatId, bucket
  ]);

  // Also log into visit_execution_logs so app SFA sync and global logs see it
  await dbRun(`
    INSERT INTO visit_execution_logs (
      visit_date, customer_code, customer_name, customer_type,
      branch, employee_code, employee_name, check_in_time, check_out_time,
      duration, visit_status, purpose_of_visit, remarks, is_planned
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `, [
    visitDate, shipCode, customerName, 'Non-Trade',
    branch, empCode, empName, checkInTime, checkOutTime,
    '34 Minute(s)', visitStatus, purposeOfVisit, remarks
  ]).catch(err => console.warn('[recordNonTradeVisitPunch] visit_execution_logs insert skipped:', err.message));

  return {
    success: true,
    message: `Punched ${customerName} on ${visitDate}.`,
    planned: Boolean(ntCounter),
    channel: 'NON_TRADE',
    cycle_code: 'MONTHLY',
    sfa_row: {
      "Date of Visit": visitDate,
      "Customer Code": shipCode,
      "Customer Name": customerName,
      "Type": bucket,
      "Route": branch,
      "Branch": branch,
      "Employee Code": empCode,
      "Employee Name": empName,
      "Check In Time": checkInTime,
      "Check Out Time": checkOutTime,
      "Duration": "34 Minute(s)",
      "Visit Status(Productive / Non productive)": visitStatus,
      "Purpose Of Visit": purposeOfVisit,
      "Remarks": remarks
    }
  };
}

/**
 * Get Non-Trade Calendar Data for the dedicated Red-themed Plan Calendar
 */
export async function getNonTradeCalendarData({
  periodMonth = '2026-09',
  roleType = 'Officer',
  empCode = 'ALL',
  bucket = 'ALL',
  search = ''
} = {}) {
  await ensureNonTradePlansForMonth(periodMonth);
  const [yearStr, monthStr] = periodMonth.split('-');
  const year = parseInt(yearStr, 10) || 2026;
  const month = parseInt(monthStr, 10) || 9;

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month - 1] || 'September';
  const daysInMonth = new Date(year, month, 0).getDate();

  let where = 'period_month = ?';
  const params = [periodMonth];

  if (roleType && roleType !== 'ALL') {
    where += ' AND role_type = ?';
    params.push(roleType);
  }
  if (empCode && empCode !== 'ALL') {
    where += ' AND UPPER(TRIM(emp_code)) = UPPER(TRIM(?))';
    params.push(empCode);
  }
  if (bucket && bucket !== 'ALL') {
    where += ' AND UPPER(TRIM(bucket)) = UPPER(TRIM(?))';
    params.push(bucket);
  }
  if (search) {
    where += ' AND (party_name LIKE ? OR ship_to_party_name LIKE ? OR emp_name LIKE ? OR destination_zone LIKE ? OR sap_code LIKE ? OR ship_to_party LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q, q, q, q);
  }

  // Get matching plan rows that have at least one scheduled visit date
  const planRows = await dbAll(`
    SELECT id, period_month, role_type, emp_code, emp_name, asm_name, asm_emp_code,
           sap_code, party_name, destination_zone, ship_to_party_name, ship_to_party,
           segment, bucket, priority, model_visits,
           date_of_visit_1, date_of_visit_2, date_of_visit_3,
           ho_visit_date_1, ho_visit_date_2, remarks, concat_id
    FROM nontrade_plans
    WHERE ${where} AND (
      (date_of_visit_1 IS NOT NULL AND date_of_visit_1 != 'NA' AND date_of_visit_1 != '0') OR
      (date_of_visit_2 IS NOT NULL AND date_of_visit_2 != 'NA' AND date_of_visit_2 != '0') OR
      (date_of_visit_3 IS NOT NULL AND date_of_visit_3 != 'NA' AND date_of_visit_3 != '0') OR
      (ho_visit_date_1 IS NOT NULL AND ho_visit_date_1 != 'NA' AND ho_visit_date_1 != '0') OR
      (ho_visit_date_2 IS NOT NULL AND ho_visit_date_2 != 'NA' AND ho_visit_date_2 != '0')
    )
    ORDER BY priority ASC, id ASC
  `, params);

  // Get execution records for matching period
  const cvrRows = await dbAll(
    'SELECT * FROM nontrade_customer_visit_reports WHERE period_month = ?',
    [periodMonth]
  );

  const cvrDateMap = new Map();
  for (const c of cvrRows) {
    const dStr = c.visit_date ? String(c.visit_date).slice(0, 10) : '';
    const cust = String(c.customer_code || '').trim();
    const sap = String(c.sap_code || '').trim();
    const ec = String(c.emp_code || '').trim();
    if (dStr) {
      if (cust) cvrDateMap.set(`${dStr}#${ec}#${cust}`, c);
      if (sap) cvrDateMap.set(`${dStr}#${ec}#${sap}`, c);
      cvrDateMap.set(`${dStr}#${cust}`, c);
      if (sap) cvrDateMap.set(`${dStr}#${sap}`, c);
    }
  }

  // Populate days
  const days = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(year, month - 1, d);
    const dayOfWeek = dateObj.getDay();
    days[isoDate] = {
      date: isoDate,
      dayNumber: d,
      dayOfWeek,
      isSunday: dayOfWeek === 0,
      visits: [],
      visitCount: 0,
      executedCount: 0
    };
  }

  const officersMap = new Map();
  const bucketsMap = new Map();
  let totalScheduled = 0;
  let totalExecuted = 0;

  for (const p of planRows) {
    const ec = p.emp_code;
    if (ec) {
      if (!officersMap.has(ec)) {
        officersMap.set(ec, { emp_code: ec, emp_name: p.emp_name, visits: 0 });
      }
    }

    const b = p.bucket || 'Unclassified';
    bucketsMap.set(b, (bucketsMap.get(b) || 0) + 1);

    const dates = [
      p.date_of_visit_1, p.date_of_visit_2, p.date_of_visit_3,
      p.ho_visit_date_1, p.ho_visit_date_2
    ].filter(d => d && d !== 'NA' && d !== '0');

    for (let i = 0; i < dates.length; i++) {
      const vDate = dates[i];
      if (days[vDate]) {
        totalScheduled++;
        if (ec && officersMap.has(ec)) {
          officersMap.get(ec).visits++;
        }

        const ship = String(p.ship_to_party || '').trim();
        const sap = String(p.sap_code || '').trim();
        const exec = cvrDateMap.get(`${vDate}#${ec}#${ship}`) ||
                     cvrDateMap.get(`${vDate}#${ec}#${sap}`) ||
                     cvrDateMap.get(`${vDate}#${ship}`) ||
                     cvrDateMap.get(`${vDate}#${sap}`) || null;

        if (exec) {
          totalExecuted++;
          days[vDate].executedCount++;
        }

        days[vDate].visits.push({
          id: p.id * 10 + (i + 1),
          plan_id: p.id,
          emp_code: p.emp_code,
          emp_name: p.emp_name,
          asm_name: p.asm_name,
          sap_code: p.sap_code,
          party_name: p.party_name,
          ship_to_party: p.ship_to_party,
          ship_to_party_name: p.ship_to_party_name || p.party_name,
          destination_zone: p.destination_zone,
          segment: p.segment,
          bucket: p.bucket,
          priority: p.priority,
          model_visits: p.model_visits,
          executed: Boolean(exec),
          execution: exec ? {
            check_in_time: exec.check_in_time || '10:05:00',
            check_out_time: exec.check_out_time || '10:39:00',
            duration: exec.duration || '34 Minute(s)',
            visit_status: exec.visit_status || 'Productive',
            remarks: exec.remarks || null
          } : null
        });
        days[vDate].visitCount = days[vDate].visits.length;
      }
    }
  }

  const activeDays = Object.values(days).filter(d => d.visitCount > 0).length;

  // Query all officers roster for this period & roleType so the UI can always list all officers
  let allOffWhere = 'period_month = ?';
  const allOffParams = [periodMonth];
  if (roleType && roleType !== 'ALL') {
    allOffWhere += ' AND role_type = ?';
    allOffParams.push(roleType);
  }
  const allOfficerPlanRows = await dbAll(`
    SELECT emp_code, emp_name, asm_name, role_type,
           date_of_visit_1, date_of_visit_2, date_of_visit_3,
           ho_visit_date_1, ho_visit_date_2, ship_to_party, sap_code
    FROM nontrade_plans
    WHERE ${allOffWhere} AND (
      (date_of_visit_1 IS NOT NULL AND date_of_visit_1 != 'NA' AND date_of_visit_1 != '0') OR
      (date_of_visit_2 IS NOT NULL AND date_of_visit_2 != 'NA' AND date_of_visit_2 != '0') OR
      (date_of_visit_3 IS NOT NULL AND date_of_visit_3 != 'NA' AND date_of_visit_3 != '0') OR
      (ho_visit_date_1 IS NOT NULL AND ho_visit_date_1 != 'NA' AND ho_visit_date_1 != '0') OR
      (ho_visit_date_2 IS NOT NULL AND ho_visit_date_2 != 'NA' AND ho_visit_date_2 != '0')
    )
  `, allOffParams);

  const allOfficersMap = new Map();
  for (const r of allOfficerPlanRows) {
    const ec = r.emp_code;
    if (!ec) continue;
    if (!allOfficersMap.has(ec)) {
      allOfficersMap.set(ec, {
        emp_code: ec,
        emp_name: r.emp_name,
        asm_name: r.asm_name,
        role_type: r.role_type,
        totalVisits: 0,
        executedVisits: 0,
        activeDates: new Set()
      });
    }
    const o = allOfficersMap.get(ec);
    const dList = [r.date_of_visit_1, r.date_of_visit_2, r.date_of_visit_3, r.ho_visit_date_1, r.ho_visit_date_2]
      .filter(d => d && d !== 'NA' && d !== '0');
    for (const vd of dList) {
      o.totalVisits++;
      o.activeDates.add(vd);
      const ship = String(r.ship_to_party || '').trim();
      const sap = String(r.sap_code || '').trim();
      const exec = cvrDateMap.get(`${vd}#${ec}#${ship}`) ||
                   cvrDateMap.get(`${vd}#${ec}#${sap}`) ||
                   cvrDateMap.get(`${vd}#${ship}`) ||
                   cvrDateMap.get(`${vd}#${sap}`) || null;
      if (exec) {
        o.executedVisits++;
      }
    }
  }

  const allOfficers = Array.from(allOfficersMap.values()).map(o => ({
    emp_code: o.emp_code,
    emp_name: o.emp_name,
    asm_name: o.asm_name,
    role_type: o.role_type,
    totalVisits: o.totalVisits,
    executedVisits: o.executedVisits,
    activeDays: o.activeDates.size,
    adherencePct: o.totalVisits > 0 ? ((o.executedVisits / o.totalVisits) * 100).toFixed(1) : '0.0'
  })).sort((a, b) => b.totalVisits - a.totalVisits);

  return {
    periodMonth,
    year,
    month,
    monthName,
    daysInMonth,
    roleType,
    empCode,
    totalVisits: totalScheduled,
    activeDays,
    executedVisits: totalExecuted,
    pendingVisits: Math.max(0, totalScheduled - totalExecuted),
    adherencePct: totalScheduled > 0 ? ((totalExecuted / totalScheduled) * 100).toFixed(1) : '0.0',
    officers: empCode && empCode !== 'ALL'
      ? allOfficers.filter(o => String(o.emp_code).trim() === String(empCode).trim())
      : allOfficers,
    allOfficers,
    selectedOfficer: allOfficers.find(o => String(o.emp_code).trim() === String(empCode).trim()) || null,
    buckets: Array.from(bucketsMap.entries()).map(([name, count]) => ({ bucket: name, count })),
    days
  };
}

/**
 * Get Non-Trade Approval Matrix & Team Reporting Hierarchy with Automated Adherence Tracking
 */
export async function getNonTradeApprovalMatrix(periodMonth = '2026-09') {
  await ensureNonTradePlansForMonth(periodMonth);
  // Query distinct reporting pairs from nontrade_plans
  const officerRows = await dbAll(`
    SELECT DISTINCT
      p.emp_code, p.emp_name, p.role_type, p.asm_name, p.hos_name, p.status,
      COUNT(*) as total_counters,
      SUM(CASE WHEN date_of_visit_1 IS NOT NULL AND date_of_visit_1 != 'NA' AND date_of_visit_1 != '0' THEN 1 ELSE 0 END +
          CASE WHEN date_of_visit_2 IS NOT NULL AND date_of_visit_2 != 'NA' AND date_of_visit_2 != '0' THEN 1 ELSE 0 END +
          CASE WHEN date_of_visit_3 IS NOT NULL AND date_of_visit_3 != 'NA' AND date_of_visit_3 != '0' THEN 1 ELSE 0 END +
          CASE WHEN ho_visit_date_1 IS NOT NULL AND ho_visit_date_1 != 'NA' AND ho_visit_date_1 != '0' THEN 1 ELSE 0 END +
          CASE WHEN ho_visit_date_2 IS NOT NULL AND ho_visit_date_2 != 'NA' AND ho_visit_date_2 != '0' THEN 1 ELSE 0 END) as scheduled_visits
    FROM nontrade_plans p
    WHERE p.period_month = ? AND p.role_type = 'Officer'
    GROUP BY p.emp_code, p.emp_name, p.role_type, p.asm_name, p.hos_name, p.status
    ORDER BY p.asm_name ASC, p.emp_name ASC
  `, [periodMonth]);

  // Query ASM rows
  const asmRows = await dbAll(`
    SELECT DISTINCT
      p.emp_code, p.emp_name, p.role_type, p.asm_name, p.hos_name, p.status,
      COUNT(*) as total_counters,
      SUM(CASE WHEN date_of_visit_1 IS NOT NULL AND date_of_visit_1 != 'NA' AND date_of_visit_1 != '0' THEN 1 ELSE 0 END +
          CASE WHEN date_of_visit_2 IS NOT NULL AND date_of_visit_2 != 'NA' AND date_of_visit_2 != '0' THEN 1 ELSE 0 END +
          CASE WHEN date_of_visit_3 IS NOT NULL AND date_of_visit_3 != 'NA' AND date_of_visit_3 != '0' THEN 1 ELSE 0 END +
          CASE WHEN ho_visit_date_1 IS NOT NULL AND ho_visit_date_1 != 'NA' AND ho_visit_date_1 != '0' THEN 1 ELSE 0 END +
          CASE WHEN ho_visit_date_2 IS NOT NULL AND ho_visit_date_2 != 'NA' AND ho_visit_date_2 != '0' THEN 1 ELSE 0 END) as scheduled_visits
    FROM nontrade_plans p
    WHERE p.period_month = ? AND p.role_type = 'ASM'
    GROUP BY p.emp_code, p.emp_name, p.role_type, p.asm_name, p.hos_name, p.status
    ORDER BY p.emp_name ASC
  `, [periodMonth]);

  // Query HOS rows
  const hosRows = await dbAll(`
    SELECT DISTINCT
      p.emp_code, p.emp_name, p.role_type, p.asm_name, p.hos_name, p.status,
      COUNT(*) as total_counters,
      SUM(CASE WHEN date_of_visit_1 IS NOT NULL AND date_of_visit_1 != 'NA' AND date_of_visit_1 != '0' THEN 1 ELSE 0 END +
          CASE WHEN date_of_visit_2 IS NOT NULL AND date_of_visit_2 != 'NA' AND date_of_visit_2 != '0' THEN 1 ELSE 0 END +
          CASE WHEN date_of_visit_3 IS NOT NULL AND date_of_visit_3 != 'NA' AND date_of_visit_3 != '0' THEN 1 ELSE 0 END +
          CASE WHEN ho_visit_date_1 IS NOT NULL AND ho_visit_date_1 != 'NA' AND ho_visit_date_1 != '0' THEN 1 ELSE 0 END +
          CASE WHEN ho_visit_date_2 IS NOT NULL AND ho_visit_date_2 != 'NA' AND ho_visit_date_2 != '0' THEN 1 ELSE 0 END) as scheduled_visits
    FROM nontrade_plans p
    WHERE p.period_month = ? AND p.role_type = 'HOS'
    GROUP BY p.emp_code, p.emp_name, p.role_type, p.asm_name, p.hos_name, p.status
    ORDER BY p.emp_name ASC
  `, [periodMonth]);

  // Get SFA execution counts per officer
  const cvrCounts = await dbAll(`
    SELECT emp_code, COUNT(*) as executed_count
    FROM nontrade_customer_visit_reports
    WHERE period_month = ?
    GROUP BY emp_code
  `, [periodMonth]);
  const cvrMap = new Map(cvrCounts.map(c => [String(c.emp_code).trim(), Number(c.executed_count)]));

  // Build ASM Groups
  const asmMap = new Map();
  for (const a of asmRows) {
    const asmName = a.emp_name;
    if (!asmMap.has(asmName)) {
      asmMap.set(asmName, {
        asm_name: asmName,
        asm_emp_code: a.emp_code,
        hos_name: a.hos_name || 'SHANTANU BHATTACHARJEE',
        status: a.status || 'APPROVED',
        asm_scheduled_visits: Number(a.scheduled_visits) || 0,
        subordinates: [],
        total_officers: 0,
        total_officer_planned_visits: 0,
        total_officer_executed_visits: 0
      });
    }
  }

  for (const o of officerRows) {
    const asmName = o.asm_name || 'Unassigned';
    if (!asmMap.has(asmName)) {
      asmMap.set(asmName, {
        asm_name: asmName,
        asm_emp_code: 'NA',
        hos_name: o.hos_name || 'NA',
        status: o.status || 'APPROVED',
        asm_scheduled_visits: 0,
        subordinates: [],
        total_officers: 0,
        total_officer_planned_visits: 0,
        total_officer_executed_visits: 0
      });
    }

    const asm = asmMap.get(asmName);
    const execCount = cvrMap.get(String(o.emp_code).trim()) || 0;
    const planned = Number(o.scheduled_visits) || 0;
    const adhPct = planned > 0 ? ((execCount / planned) * 100).toFixed(1) : '0.0';

    asm.subordinates.push({
      emp_code: o.emp_code,
      emp_name: o.emp_name,
      role_type: o.role_type,
      total_counters: o.total_counters,
      scheduled_visits: planned,
      executed_visits: execCount,
      adherence_pct: adhPct,
      status: o.status || 'APPROVED'
    });
    asm.total_officers++;
    asm.total_officer_planned_visits += planned;
    asm.total_officer_executed_visits += execCount;
  }

  const asmHierarchy = Array.from(asmMap.values()).map(a => ({
    ...a,
    officers: a.subordinates,
    team_adherence_pct: a.total_officer_planned_visits > 0
      ? ((a.total_officer_executed_visits / a.total_officer_planned_visits) * 100).toFixed(1)
      : '0.0'
  })).sort((a, b) => b.total_officers - a.total_officers);

  // General Approval Matrix Rules
  const matrixRules = [
    {
      level: 1,
      role: 'Officer',
      approverRole: 'ASM',
      submitter_role: 'Sales Officer (Non-Trade)',
      submitter_code: 'Officer',
      approver_role: 'Area Sales Manager (ASM)',
      approver_code: 'ASM',
      description: 'L1 Sign-Off: Officer visits verified by Area Sales Manager',
      scope: 'Weekly / Monthly Counter Visits & Journey Plan',
      sla_hours: '48 Hours',
      auto_adherence: 'Active — punches directly match planned visit dates'
    },
    {
      level: 2,
      role: 'ASM',
      approverRole: 'HOS',
      submitter_role: 'Area Sales Manager (ASM)',
      submitter_code: 'ASM',
      approver_role: 'Head of Sales (HOS)',
      approver_code: 'HOS',
      description: 'L2 Sign-Off: ASM planned touches & joint visits approved by Head of Sales',
      scope: 'Zonal & Joint Account Visits',
      sla_hours: '24 Hours',
      auto_adherence: 'Active — team adherence aggregated automatically'
    },
    {
      level: 3,
      role: 'HOS',
      approverRole: 'Commercial Head / VP',
      submitter_role: 'Head of Sales (HOS)',
      submitter_code: 'HOS',
      approver_role: 'Commercial Head / VP Sales',
      approver_code: 'VP / COMM',
      description: 'Executive Sign-Off: Key institutional & Head Office planned accounts',
      scope: 'Strategic Non-Trade Accounts & Overall Adherence',
      sla_hours: '72 Hours',
      auto_adherence: 'Active — company-wide Non-Trade tracking'
    }
  ];

  return {
    periodMonth,
    rules: matrixRules,
    levels: matrixRules,
    hierarchy: asmHierarchy,
    asms: asmHierarchy,
    autoTrackingEnabled: true,
    summary: {
      total_officers: officerRows.length,
      total_asms: asmRows.length,
      total_hos: hosRows.length,
      rollout_status: 'APPROVED / ACTIVE IN FIELD APP',
      auto_adherence_status: 'AUTOMATICALLY TRACKED LIKE DJP'
    }
  };
}

/**
 * Roll forward plans and execution baseline from sourceMonth to targetMonth (e.g. 2026-09 -> 2026-10)
 */
export async function rollForwardNonTradePlans(sourceMonth = '2026-09', targetMonth = '2026-10', copyVisits = true) {
  // Check if targetMonth already has plans
  const existing = await dbGet('SELECT COUNT(*) as c FROM nontrade_plans WHERE period_month = ?', [targetMonth]);
  if (existing?.c > 0) {
    return {
      success: true,
      message: `Plans already exist for ${targetMonth} (${existing.c} records).`,
      count: existing.c
    };
  }

  // Fetch plans from sourceMonth
  const plans = await dbAll('SELECT * FROM nontrade_plans WHERE period_month = ?', [sourceMonth]);
  if (plans.length === 0) {
    throw new Error(`No plans found in ${sourceMonth} to roll forward.`);
  }

  const shiftDate = (dStr) => {
    if (!dStr || dStr === 'NA' || dStr === '0') return null;
    const parts = String(dStr).split('-');
    if (parts.length < 3) return null;
    const day = parts[2];
    const [tY, tM] = targetMonth.split('-');
    const maxDays = new Date(Number(tY), Number(tM), 0).getDate();
    const safeDay = Math.min(Number(day) || 1, maxDays);
    return `${targetMonth}-${String(safeDay).padStart(2, '0')}`;
  };

  const newPlans = plans.map(p => [
    targetMonth, p.role_type, p.emp_code, p.emp_name,
    p.asm_name, p.asm_emp_code, p.hos_name, p.hos_emp_code,
    p.sap_code, p.party_name, p.destination_zone, p.area,
    p.ship_to_party_name, p.ship_to_party, p.segment, p.bucket,
    p.priority, p.model_visits,
    shiftDate(p.date_of_visit_1), shiftDate(p.date_of_visit_2), shiftDate(p.date_of_visit_3),
    shiftDate(p.ho_visit_date_1), shiftDate(p.ho_visit_date_2),
    p.remarks, p.concat_id, `ROLLED_FORWARD_FROM_${sourceMonth}`
  ]);

  const insertSql = `
    INSERT INTO nontrade_plans (
      period_month, role_type, emp_code, emp_name,
      asm_name, asm_emp_code, hos_name, hos_emp_code,
      sap_code, party_name, destination_zone, area,
      ship_to_party_name, ship_to_party, segment, bucket,
      priority, model_visits,
      date_of_visit_1, date_of_visit_2, date_of_visit_3,
      ho_visit_date_1, ho_visit_date_2,
      remarks, concat_id, source_file
    ) VALUES ?
  `;

  for (let i = 0; i < newPlans.length; i += 500) {
    await dbRun(insertSql, [newPlans.slice(i, i + 500)]);
  }

  // Roll forward HO plans
  const hoPlans = await dbAll('SELECT * FROM nontrade_ho_plans WHERE period_month = ?', [sourceMonth]);
  if (hoPlans.length > 0) {
    const newHoPlans = hoPlans.map(hp => [
      targetMonth, hp.role_type, hp.emp_code, hp.emp_name,
      hp.sap_code, hp.party_name,
      shiftDate(hp.ho_visit_date_1), shiftDate(hp.ho_visit_date_2),
      hp.concat_id, `ROLLED_FORWARD_FROM_${sourceMonth}`
    ]);
    const hoSql = `
      INSERT INTO nontrade_ho_plans (
        period_month, role_type, emp_code, emp_name,
        sap_code, party_name,
        ho_visit_date_1, ho_visit_date_2,
        concat_id, source_file
      ) VALUES ?
    `;
    for (let i = 0; i < newHoPlans.length; i += 500) {
      await dbRun(hoSql, [newHoPlans.slice(i, i + 500)]);
    }
  }

  // Copy baseline visit logs so targetMonth has baseline tracking
  if (copyVisits) {
    await copyBaselineVisitsToMonth(sourceMonth, targetMonth);
  }

  return {
    success: true,
    message: `Successfully rolled forward plans from ${sourceMonth} into ${targetMonth}`,
    count: newPlans.length
  };
}

/**
 * Copy baseline visits, leads, and influencer reports to target month
 */
export async function copyBaselineVisitsToMonth(sourceMonth = '2026-09', targetMonth) {
  if (!targetMonth || targetMonth === sourceMonth) return;

  const shiftDate = (dStr) => {
    if (!dStr) return null;
    const parts = String(dStr).split('-');
    if (parts.length < 3) return null;
    const day = parts[2];
    const [tY, tM] = targetMonth.split('-');
    const maxDays = new Date(Number(tY), Number(tM), 0).getDate();
    const safeDay = Math.min(Number(day) || 1, maxDays);
    return `${targetMonth}-${String(safeDay).padStart(2, '0')}`;
  };

  // 1. CVR
  const cvrExisting = await dbGet('SELECT COUNT(*) as c FROM nontrade_customer_visit_reports WHERE period_month = ?', [targetMonth]);
  if (cvrExisting?.c === 0) {
    const cvr = await dbAll('SELECT * FROM nontrade_customer_visit_reports WHERE period_month = ?', [sourceMonth]);
    if (cvr.length > 0) {
      const newCvr = cvr.map(c => [
        targetMonth, c.si_no, shiftDate(c.visit_date),
        c.customer_code, c.customer_name,
        c.route, c.type, c.branch, c.emp_code, c.emp_name,
        c.check_in_time, c.check_out_time, c.duration, c.visit_status,
        c.remarks, c.purpose_of_visit, c.sap_code, c.concat_id, c.bucket
      ]);
      const cvrSql = `
        INSERT INTO nontrade_customer_visit_reports (
          period_month, si_no, visit_date, customer_code, customer_name,
          route, type, branch, emp_code, emp_name,
          check_in_time, check_out_time, duration, visit_status,
          remarks, purpose_of_visit, sap_code, concat_id, bucket
        ) VALUES ?
      `;
      for (let i = 0; i < newCvr.length; i += 500) {
        await dbRun(cvrSql, [newCvr.slice(i, i + 500)]);
      }
    }
  }

  // 2. Leads
  const leadsExisting = await dbGet('SELECT COUNT(*) as c FROM nontrade_leads WHERE period_month = ?', [targetMonth]);
  if (leadsExisting?.c === 0) {
    const leads = await dbAll('SELECT * FROM nontrade_leads WHERE period_month = ?', [sourceMonth]);
    if (leads.length > 0) {
      const newLeads = leads.map(l => [
        targetMonth, shiftDate(l.lead_date), l.firm, l.contact_person, l.mobile,
        l.branch, l.area, l.address, l.category, l.sub_category,
        l.emp_code, l.created_by, l.department
      ]);
      const leadsSql = `
        INSERT INTO nontrade_leads (
          period_month, lead_date, firm, contact_person, mobile,
          branch, area, address, category, sub_category,
          emp_code, created_by, department
        ) VALUES ?
      `;
      for (let i = 0; i < newLeads.length; i += 500) {
        await dbRun(leadsSql, [newLeads.slice(i, i + 500)]);
      }
    }
  }

  // 3. Site visits
  const svExisting = await dbGet('SELECT COUNT(*) as c FROM nontrade_site_visits WHERE period_month = ?', [targetMonth]);
  if (svExisting?.c === 0) {
    const sv = await dbAll('SELECT * FROM nontrade_site_visits WHERE period_month = ?', [sourceMonth]);
    if (sv.length > 0) {
      const newSv = sv.map(s => [
        targetMonth, shiftDate(s.visit_date), s.emp_code, s.emp_name,
        s.branch, s.place, s.name, s.category, s.contact_no,
        s.total_consumption_bag, s.balance_consumption_bag, s.visit_status
      ]);
      const svSql = `
        INSERT INTO nontrade_site_visits (
          period_month, visit_date, emp_code, emp_name,
          branch, place, name, category, contact_no,
          total_consumption_bag, balance_consumption_bag, visit_status
        ) VALUES ?
      `;
      for (let i = 0; i < newSv.length; i += 500) {
        await dbRun(svSql, [newSv.slice(i, i + 500)]);
      }
    }
  }

  // 4. Professional visits
  const pvExisting = await dbGet('SELECT COUNT(*) as c FROM nontrade_professional_visits WHERE period_month = ?', [targetMonth]);
  if (pvExisting?.c === 0) {
    const pv = await dbAll('SELECT * FROM nontrade_professional_visits WHERE period_month = ?', [sourceMonth]);
    if (pv.length > 0) {
      const newPv = pv.map(p => [
        targetMonth, shiftDate(p.visit_date), p.emp_code, p.emp_name,
        p.branch, p.zone, p.name, p.mobile_no, p.type,
        p.organisation, p.designation
      ]);
      const pvSql = `
        INSERT INTO nontrade_professional_visits (
          period_month, visit_date, emp_code, emp_name,
          branch, zone, name, mobile_no, type,
          organisation, designation
        ) VALUES ?
      `;
      for (let i = 0; i < newPv.length; i += 500) {
        await dbRun(pvSql, [newPv.slice(i, i + 500)]);
      }
    }
  }
}

const ensureMonthPromises = new Map();

/**
 * Automatically & dynamically ensures counter plans, HO touchpoints, and baseline execution exist
 * for ANY requested periodMonth (e.g. 2026-09, 2026-10, 2026-11, 2026-12, 2027-01, etc.)
 * Protected by an in-flight single-promise guard so concurrent requests for a month don't race.
 */
export async function ensureNonTradePlansForMonth(targetMonth) {
  if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) return;

  if (ensureMonthPromises.has(targetMonth)) {
    return ensureMonthPromises.get(targetMonth);
  }

  const taskPromise = (async () => {
    try {
      const existing = await dbGet('SELECT COUNT(*) as c FROM nontrade_plans WHERE period_month = ?', [targetMonth]);
      if (existing?.c === 0) {
        const baseline = await dbGet(`
          SELECT period_month, COUNT(*) as c 
          FROM nontrade_plans 
          GROUP BY period_month 
          ORDER BY (period_month = '2026-09') DESC, c DESC 
          LIMIT 1
        `);
        const sourceMonth = baseline?.period_month || '2026-09';
        await rollForwardNonTradePlans(sourceMonth, targetMonth, true);
      } else {
        // Ensure baseline execution logs exist for this month
        const cvrExisting = await dbGet('SELECT COUNT(*) as c FROM nontrade_customer_visit_reports WHERE period_month = ?', [targetMonth]);
        if (cvrExisting?.c === 0) {
          const baseline = await dbGet(`
            SELECT period_month, COUNT(*) as c 
            FROM nontrade_customer_visit_reports 
            GROUP BY period_month 
            ORDER BY (period_month = '2026-09') DESC, c DESC 
            LIMIT 1
          `);
          const sourceMonth = baseline?.period_month || '2026-09';
          await copyBaselineVisitsToMonth(sourceMonth, targetMonth);
        }
      }
    } finally {
      ensureMonthPromises.delete(targetMonth);
    }
  })();

  ensureMonthPromises.set(targetMonth, taskPromise);
  return taskPromise;
}

