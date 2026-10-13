import ExcelJS from 'exceljs';
import { analyseAdherence, defaultAsOnDate } from '../engines/sfa-adherence.engine.js';

const ROLES = ['SO', 'ASM', 'RSM', 'ZH'];

// Color palette matching the client's Excel
const COLOR_PEACH  = 'FFFDE9D9';
const COLOR_BLUE   = 'FFDCE6F1';
const COLOR_YELLOW = 'FFFFFF00';
const COLOR_GREEN  = 'FFC6EFCE';
const COLOR_SALMON = 'FFF8CBAD';
const COLOR_HEADER_DARK_GREEN = 'FF00B050';
const COLOR_GRAY_BG = 'FFF2F2F2';
const COLOR_RED_FILL = 'FFFFC7CE';
const COLOR_RED_TEXT = 'FF9C0006';
const COLOR_GREEN_FILL = 'FFC6EFCE';
const COLOR_GREEN_TEXT = 'FF006100';

function applyHeaderStyle(cell, fillArgb, fontColor = 'FF000000') {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
  cell.font = { bold: true, size: 9, name: 'Calibri', color: { argb: fontColor } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    right: { style: 'thin', color: { argb: 'FFBFBFBF' } }
  };
}

function applyDataStyle(cell, isNumber = false, format = null) {
  cell.font = { size: 9, name: 'Calibri' };
  cell.alignment = { vertical: 'middle', horizontal: isNumber ? 'right' : 'left' };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
  };
  if (format) cell.numFmt = format;
}

export async function buildAdherenceWorkbook({ periodMonth, cycleCode = 'C1', asOnDate = null }) {
  const month = periodMonth || '2026-06';
  const cycle = cycleCode && cycleCode !== 'ALL' ? cycleCode : null;

  const a = await analyseAdherence({
    periodMonth: month,
    cycleCode: cycle,
    asOnDate: asOnDate || null
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Star Cement DJP Engine';
  wb.created = new Date();

  // 1. Overall Summary Sheet
  const summarySheet = wb.addWorksheet('Summary', { views: [{ showGridLines: true }] });
  summarySheet.columns = [
    { header: 'Dimension', key: 'dim', width: 28 },
    { header: 'Dealers', key: 'dealers', width: 14 },
    { header: 'Planned Visits', key: 'planned', width: 16 },
    { header: 'MTD Due', key: 'mtd', width: 14 },
    { header: 'Adhered', key: 'adhered', width: 14 },
    { header: 'Adhered (Capped)', key: 'capped', width: 16 },
    { header: 'Adherence %', key: 'pct', width: 16 },
    { header: 'Pending', key: 'pending', width: 14 }
  ];

  summarySheet.getRow(1).eachCell(cell => applyHeaderStyle(cell, COLOR_BLUE));

  // Role rollups
  summarySheet.addRow(['Overall Total', a.totals.dealers, a.totals.planned, Math.round(a.totals.mtd_planned * 10) / 10, a.totals.adhered, a.totals.adhered_capped, Math.round(a.totals.adherence_pct * 1000) / 10 + '%', Math.round(a.totals.pending * 10) / 10]);
  summarySheet.addRow([]);
  summarySheet.addRow(['Role Breakdown', '', '', '', '', '', '', '']);
  summarySheet.lastRow.font = { bold: true };

  for (const r of ROLES) {
    const roleData = a.byRole[r] || { dealers: 0, planned: 0, mtd_planned: 0, adhered: 0, adhered_capped: 0, adherence_pct: 0, pending: 0 };
    summarySheet.addRow([
      r,
      roleData.dealers,
      roleData.planned,
      Math.round(roleData.mtd_planned * 10) / 10,
      roleData.adhered,
      roleData.adhered_capped,
      Math.round(roleData.adherence_pct * 1000) / 10 + '%',
      Math.round(roleData.pending * 10) / 10
    ]);
  }

  // 2. Individual Role Sheets: ZH, RSM, ASM, SO
  for (const role of ROLES) {
    const sheet = wb.addWorksheet(role, { views: [{ showGridLines: true }] });

    // Filter officers and dealers for this role
    const roleOfficers = a.byEmployee.filter(e => (e.role || 'SO').toUpperCase() === role.toUpperCase());
    const roleDealers = a.byDealer.filter(d => (d.role || 'SO').toUpperCase() === role.toUpperCase());

    // Row 4 header setup matching the client's Excel layout
    // Detailed on Left (Cols B-J: cols 2-10)
    // Summary on Right (Cols L-Q: cols 12-17)

    // Title / info header
    sheet.getCell(2, 2).value = `Trade DJP - ${role} Adherence Report (${month} - ${cycle || 'Full Month'})`;
    sheet.getCell(2, 2).font = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
    sheet.getCell(2, 12).value = `As on Date: ${a.asOnDate}`;
    sheet.getCell(2, 12).font = { italic: true, size: 10, color: { argb: 'FF64748B' } };

    // Row 4 Detailed Headers (Cols B-J)
    const detailedHeaders = [
      { col: 2, text: `${role}/SE NAME`, bg: COLOR_PEACH },
      { col: 3, text: 'Category', bg: COLOR_BLUE },
      { col: 4, text: 'Area', bg: COLOR_BLUE },
      { col: 5, text: 'DEALER NAME', bg: COLOR_BLUE },
      { col: 6, text: `No. of visits Planned by ${role} in DJP`, bg: COLOR_YELLOW },
      { col: 7, text: `MTD No: of visits Planned by ${role} in DJP`, bg: COLOR_YELLOW },
      { col: 8, text: `No. of visits Adhered by ${role}`, bg: COLOR_GREEN },
      { col: 9, text: `MTD ${role} % of Visit Adherence`, bg: COLOR_GREEN },
      { col: 10, text: `${role} Pending to visit as per DJP`, bg: COLOR_SALMON }
    ];

    // Row 4 Summary Headers (Cols L-Q)
    const summaryHeaders = [
      { col: 12, text: `${role}/SE NAME`, bg: COLOR_PEACH },
      { col: 13, text: `No. of visits Planned by ${role} in DJP`, bg: COLOR_YELLOW },
      { col: 14, text: `MTD No: of visits Planned by ${role} in DJP`, bg: COLOR_YELLOW },
      { col: 15, text: `No. of visits Adhered by ${role}`, bg: COLOR_GREEN },
      { col: 16, text: `MTD ${role} % of Visit Adherence`, bg: COLOR_GREEN },
      { col: 17, text: `${role} Pending to visit as per DJP`, bg: COLOR_SALMON }
    ];

    detailedHeaders.forEach(h => {
      const c = sheet.getCell(4, h.col);
      c.value = h.text;
      applyHeaderStyle(c, h.bg);
    });

    summaryHeaders.forEach(h => {
      const c = sheet.getCell(4, h.col);
      c.value = h.text;
      applyHeaderStyle(c, h.bg);
    });

    sheet.getRow(4).height = 42;

    // Populate Right Table: Summary of Officers
    let sRowIdx = 5;
    for (const off of roleOfficers) {
      const r = sheet.getRow(sRowIdx);
      r.getCell(12).value = off.emp_name || off.emp_code;
      r.getCell(13).value = off.planned_visits;
      r.getCell(14).value = off.mtd_due;
      r.getCell(15).value = off.adhered;
      const pctVal = off.mtd_due > 0 ? off.adhered / (off.mtd_due < 1 ? off.planned_visits : off.mtd_due) : 0;
      r.getCell(16).value = Math.round(pctVal * 100) + '%';
      r.getCell(17).value = Math.round((off.mtd_due - off.adhered) * 10) / 10;

      applyDataStyle(r.getCell(12));
      applyDataStyle(r.getCell(13), true, '#,##0');
      applyDataStyle(r.getCell(14), true, '#,##0.0');
      applyDataStyle(r.getCell(15), true, '#,##0');
      applyDataStyle(r.getCell(16), true);
      applyDataStyle(r.getCell(17), true, '#,##0.0');

      // Conditional formatting on %
      if (pctVal < 0.7) {
        r.getCell(16).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
        r.getCell(16).font = { color: { argb: COLOR_RED_TEXT }, size: 9 };
      } else if (pctVal >= 1.0) {
        r.getCell(16).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GREEN_FILL } };
        r.getCell(16).font = { color: { argb: COLOR_GREEN_TEXT }, size: 9 };
      }

      // Conditional formatting on pending
      const pend = off.mtd_due - off.adhered;
      if (pend > 0) {
        r.getCell(17).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
        r.getCell(17).font = { color: { argb: COLOR_RED_TEXT }, size: 9 };
      }

      sRowIdx++;
    }

    // Populate Left Table: Detailed Dealers grouped by Officer & Category
    let dRowIdx = 5;
    // Group dealers by Officer first, then Category
    const dealersByOfficer = new Map();
    for (const d of roleDealers) {
      const empKey = d.emp_name || d.emp_code || 'Unknown';
      if (!dealersByOfficer.has(empKey)) dealersByOfficer.set(empKey, []);
      dealersByOfficer.get(empKey).push(d);
    }

    for (const [officerName, dList] of dealersByOfficer.entries()) {
      // Group by Category (with Need to Grow prioritized)
      const byCat = new Map();
      for (const d of dList) {
        const cat = d.category || 'Other';
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(d);
      }

      const catOrder = {
        'Need to Grow': 1,
        'Need to grow': 1,
        'De-growing': 2,
        'Growing': 3,
        'Zero lifter': 4,
        'Zero Lifter': 4,
        'Prospective': 5,
        'New / Other': 6,
        'Retain': 7,
        'Churn': 8
      };
      const sortedCatNames = Array.from(byCat.keys()).sort((a, b) => {
        const oa = catOrder[a] || 99;
        const ob = catOrder[b] || 99;
        if (oa !== ob) return oa - ob;
        return a.localeCompare(b);
      });

      for (const catName of sortedCatNames) {
        const cDealers = byCat.get(catName);
        let catPlanned = 0, catMtd = 0, catAdhered = 0;

        for (const dl of cDealers) {
          const r = sheet.getRow(dRowIdx);
          r.getCell(2).value = officerName;
          r.getCell(3).value = catName;
          r.getCell(4).value = dl.area || '';
          r.getCell(5).value = dl.dealer_name;
          r.getCell(6).value = dl.planned;
          r.getCell(7).value = Math.round(dl.mtd_due * 10) / 10;
          r.getCell(8).value = dl.adhered;
          const dlPct = dl.mtd_due > 0 ? dl.adhered / (dl.mtd_due < 1 ? dl.planned : dl.mtd_due) : 0;
          r.getCell(9).value = Math.round(dlPct * 100) + '%';
          r.getCell(10).value = Math.round(dl.pending * 10) / 10;

          catPlanned += dl.planned;
          catMtd += dl.mtd_due;
          catAdhered += dl.adhered;

          applyDataStyle(r.getCell(2));
          applyDataStyle(r.getCell(3));
          applyDataStyle(r.getCell(4));
          applyDataStyle(r.getCell(5));
          applyDataStyle(r.getCell(6), true, '#,##0');
          applyDataStyle(r.getCell(7), true, '#,##0.0');
          applyDataStyle(r.getCell(8), true, '#,##0');
          applyDataStyle(r.getCell(9), true);
          applyDataStyle(r.getCell(10), true, '#,##0.0');

          if (dlPct < 0.7) {
            r.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
            r.getCell(9).font = { color: { argb: COLOR_RED_TEXT }, size: 9 };
          } else if (dlPct >= 1.0) {
            r.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GREEN_FILL } };
            r.getCell(9).font = { color: { argb: COLOR_GREEN_TEXT }, size: 9 };
          }

          if (dl.pending > 0) {
            r.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
            r.getCell(10).font = { color: { argb: COLOR_RED_TEXT }, size: 9 };
          }

          dRowIdx++;
        }

        // Category Subtotal Row
        const subRow = sheet.getRow(dRowIdx);
        subRow.getCell(3).value = `${catName} Total`;
        subRow.getCell(6).value = catPlanned;
        subRow.getCell(7).value = Math.round(catMtd * 10) / 10;
        subRow.getCell(8).value = catAdhered;
        const subPct = catMtd > 0 ? catAdhered / (catMtd < 1 ? catPlanned : catMtd) : 0;
        subRow.getCell(9).value = Math.round(subPct * 100) + '%';
        subRow.getCell(10).value = Math.round((catMtd - catAdhered) * 10) / 10;

        for (let col = 2; col <= 10; col++) {
          const c = subRow.getCell(col);
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GRAY_BG } };
          c.font = { bold: true, size: 9, name: 'Calibri' };
          c.border = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            bottom: { style: 'thin', color: { argb: 'FF94A3B8' } }
          };
          if (col >= 6) c.alignment = { horizontal: 'right', vertical: 'middle' };
        }
        dRowIdx++;
      }
    }

    // Set Column Widths
    sheet.getColumn(2).width = 24; // Officer Name
    sheet.getColumn(3).width = 16; // Category
    sheet.getColumn(4).width = 20; // Area
    sheet.getColumn(5).width = 30; // Dealer Name
    sheet.getColumn(6).width = 14; // Planned
    sheet.getColumn(7).width = 14; // MTD Planned
    sheet.getColumn(8).width = 14; // Adhered
    sheet.getColumn(9).width = 14; // MTD %
    sheet.getColumn(10).width = 14; // Pending
    sheet.getColumn(11).width = 4;  // Spacer
    sheet.getColumn(12).width = 24; // Officer Name (Summary)
    sheet.getColumn(13).width = 14; // Planned (Summary)
    sheet.getColumn(14).width = 14; // MTD Planned (Summary)
    sheet.getColumn(15).width = 14; // Adhered (Summary)
    sheet.getColumn(16).width = 14; // MTD % (Summary)
    sheet.getColumn(17).width = 14; // Pending (Summary)
  }

  return wb;
}
