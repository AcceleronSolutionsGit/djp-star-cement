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
    { header: 'Officers', key: 'officers', width: 14 },
    { header: 'Dealers', key: 'dealers', width: 14 },
    { header: 'Planned Visits', key: 'planned', width: 16 },
    { header: 'MTD Due', key: 'mtd', width: 14 },
    { header: 'Adhered', key: 'adhered', width: 14 },
    { header: 'Adhered (Capped)', key: 'capped', width: 16 },
    { header: 'Adherence %', key: 'pct', width: 16 },
    { header: 'Pending', key: 'pending', width: 14 }
  ];

  summarySheet.getRow(1).eachCell(cell => applyHeaderStyle(cell, COLOR_BLUE));

  // Overall Total row
  summarySheet.addRow([
    'Overall Total',
    a.byEmployee.length || 0,
    a.totals.dealers || 0,
    a.totals.planned || 0,
    Math.round((a.totals.mtd_planned || a.totals.mtd_due || 0) * 10) / 10,
    a.totals.adhered || 0,
    a.totals.adhered_capped || 0,
    Math.round((a.totals.adherence_pct || 0) * 1000) / 10 + '%',
    Math.round((a.totals.pending || 0) * 10) / 10
  ]);
  summarySheet.lastRow.font = { bold: true };
  summarySheet.addRow([]);

  // Role Breakdown Table
  summarySheet.addRow(['Role Breakdown', '', '', '', '', '', '', '', '']);
  summarySheet.lastRow.font = { bold: true, size: 11 };

  for (const r of ROLES) {
    const isZh = r.toUpperCase() === 'ZH';
    const roleOfficers = a.byEmployee.filter(e => {
      const rStr = (e.role || 'SO').toUpperCase();
      return isZh ? ['ZH', 'ZM', 'ZSH', 'ZONAL HEAD'].includes(rStr) : rStr === r.toUpperCase();
    });
    const roleData = a.byRole[r] || { dealers: 0, planned: 0, mtd_planned: 0, adhered: 0, adhered_capped: 0, adherence_pct: 0, pending: 0 };
    summarySheet.addRow([
      r,
      roleOfficers.length,
      roleData.dealers || 0,
      roleData.planned || 0,
      Math.round((roleData.mtd_planned || roleData.mtd_due || 0) * 10) / 10,
      roleData.adhered || 0,
      roleData.adhered_capped || 0,
      Math.round((roleData.adherence_pct || 0) * 1000) / 10 + '%',
      Math.round((roleData.pending || 0) * 10) / 10
    ]);
  }

  // Zone Breakdown Table
  summarySheet.addRow([]);
  summarySheet.addRow(['Zone Breakdown', '', '', '', '', '', '', '', '']);
  summarySheet.lastRow.font = { bold: true, size: 11 };

  const zoneHeaderRow = summarySheet.addRow([
    'Zone',
    'Officers',
    'Dealers',
    'Planned Visits',
    'MTD Due',
    'Adhered',
    'Adhered (Capped)',
    'Adherence %',
    'Pending'
  ]);
  zoneHeaderRow.eachCell(cell => applyHeaderStyle(cell, COLOR_BLUE));

  const zones = Object.keys(a.byZone || {}).sort();
  let sumZoneOfficers = 0, sumZoneDealers = 0, sumZonePlanned = 0, sumZoneMtd = 0, sumZoneAdhered = 0, sumZoneCapped = 0, sumZonePending = 0;

  for (const z of zones) {
    const zData = a.byZone[z];
    sumZoneOfficers += (zData.officers || 0);
    sumZoneDealers += (zData.dealers || 0);
    sumZonePlanned += (zData.planned || 0);
    sumZoneMtd += (zData.mtd_planned || zData.mtd_due || 0);
    sumZoneAdhered += (zData.adhered || 0);
    sumZoneCapped += (zData.adhered_capped || 0);
    sumZonePending += (zData.pending || 0);

    summarySheet.addRow([
      z,
      zData.officers || 0,
      zData.dealers || 0,
      zData.planned || 0,
      Math.round((zData.mtd_planned || zData.mtd_due || 0) * 10) / 10,
      zData.adhered || 0,
      zData.adhered_capped || 0,
      Math.round((zData.adherence_pct || 0) * 1000) / 10 + '%',
      Math.round((zData.pending || 0) * 10) / 10
    ]);
  }

  // Zone Total Row
  const zoneTotRow = summarySheet.addRow([
    `Total (${zones.length} Zones)`,
    sumZoneOfficers,
    sumZoneDealers,
    sumZonePlanned,
    Math.round(sumZoneMtd * 10) / 10,
    sumZoneAdhered,
    sumZoneCapped,
    Math.round((sumZoneMtd > 0 ? (sumZoneAdhered / sumZoneMtd) : 0) * 1000) / 10 + '%',
    Math.round(sumZonePending * 10) / 10
  ]);
  zoneTotRow.font = { bold: true };
  zoneTotRow.eachCell(cell => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF94A3B8' } },
      bottom: { style: 'double', color: { argb: 'FF0F172A' } }
    };
  });

  // Apply data style to summary sheet rows
  summarySheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.eachCell((cell, colNumber) => {
        if (colNumber > 1 && typeof cell.value === 'number') {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        }
      });
    }
  });

  // 2. Individual Role Sheets: ZH, RSM, ASM, SO
  for (const role of ROLES) {
    const sheet = wb.addWorksheet(role, { views: [{ showGridLines: true }] });

    // Filter officers and dealers for this role dynamically
    const isZh = role.toUpperCase() === 'ZH';
    const roleOfficers = a.byEmployee.filter(e => {
      const r = (e.role || 'SO').toUpperCase();
      return isZh ? ['ZH', 'ZM', 'ZSH', 'ZONAL HEAD'].includes(r) : r === role.toUpperCase();
    });
    const roleDealers = a.byDealer.filter(d => {
      const r = (d.role || 'SO').toUpperCase();
      return isZh ? ['ZH', 'ZM', 'ZSH', 'ZONAL HEAD'].includes(r) : r === role.toUpperCase();
    });

    // Row 2: Title / info header
    sheet.getCell(2, 2).value = `Trade DJP - ${role} Adherence Report (${month} - ${cycle || 'Full Month'})`;
    sheet.getCell(2, 2).font = { bold: true, size: 13, color: { argb: 'FF1E293B' } };
    sheet.getCell(2, 13).value = `As on Date: ${a.asOnDate}`;
    sheet.getCell(2, 13).font = { italic: true, size: 10, color: { argb: 'FF64748B' } };

    // Row 3: Zone Filter context banner & Officers count summary
    sheet.getCell(3, 2).value = `Zone Filter: All Zones (Use AutoFilter dropdowns on Row 4 headers below to filter by Zone, Area, Category, or Officer)`;
    sheet.getCell(3, 2).font = { bold: true, size: 9, color: { argb: 'FF1E40AF' } };
    sheet.getCell(3, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE } };
    sheet.getCell(3, 2).alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(3).height = 24;

    sheet.getCell(3, 13).value = `Total ${role} Officers: ${roleOfficers.length}`;
    sheet.getCell(3, 13).font = { bold: true, size: 9.5, color: { argb: 'FF1E40AF' } };
    sheet.getCell(3, 13).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE } };
    sheet.getCell(3, 13).alignment = { vertical: 'middle', horizontal: 'center' };

    // Row 4 Detailed Headers (Cols B-K: cols 2-11)
    const detailedHeaders = [
      { col: 2, text: `${role}/SE NAME`, bg: COLOR_PEACH },
      { col: 3, text: 'Zone', bg: COLOR_BLUE },
      { col: 4, text: 'Area', bg: COLOR_BLUE },
      { col: 5, text: 'Category', bg: COLOR_BLUE },
      { col: 6, text: 'DEALER NAME', bg: COLOR_BLUE },
      { col: 7, text: `No. of visits Planned by ${role} in DJP`, bg: COLOR_YELLOW },
      { col: 8, text: `MTD No: of visits Planned by ${role} in DJP`, bg: COLOR_YELLOW },
      { col: 9, text: `No. of visits Adhered by ${role}`, bg: COLOR_GREEN },
      { col: 10, text: `MTD ${role} % of Visit Adherence`, bg: COLOR_GREEN },
      { col: 11, text: `${role} Pending to visit as per DJP`, bg: COLOR_SALMON }
    ];

    // Row 4 Summary Headers (Cols M-S: cols 13-19)
    const summaryHeaders = [
      { col: 13, text: `${role}/SE NAME`, bg: COLOR_PEACH },
      { col: 14, text: 'Zone', bg: COLOR_BLUE },
      { col: 15, text: `No. of visits Planned by ${role} in DJP`, bg: COLOR_YELLOW },
      { col: 16, text: `MTD No: of visits Planned by ${role} in DJP`, bg: COLOR_YELLOW },
      { col: 17, text: `No. of visits Adhered by ${role}`, bg: COLOR_GREEN },
      { col: 18, text: `MTD ${role} % of Visit Adherence`, bg: COLOR_GREEN },
      { col: 19, text: `${role} Pending to visit as per DJP`, bg: COLOR_SALMON }
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
    let sumOffPlanned = 0;
    let sumOffMtd = 0;
    let sumOffAdhered = 0;
    let sumOffPending = 0;

    for (const off of roleOfficers) {
      const planned = Number(off.planned ?? off.planned_visits ?? 0);
      const mtdPlanned = Number(off.mtd_planned ?? off.mtd_due ?? 0);
      const adhered = Number(off.adhered ?? 0);
      const pending = Number(off.pending ?? (mtdPlanned - adhered));
      const pctVal = Number.isFinite(off.adherence_pct)
        ? off.adherence_pct
        : (mtdPlanned > 0 ? adhered / (mtdPlanned < 1 ? (planned || 1) : mtdPlanned) : 0);

      sumOffPlanned += planned;
      sumOffMtd += mtdPlanned;
      sumOffAdhered += adhered;
      sumOffPending += pending;

      const r = sheet.getRow(sRowIdx);
      r.getCell(13).value = off.emp_name || off.emp_code || '';
      r.getCell(14).value = off.zone || 'ALL';
      r.getCell(15).value = planned;
      r.getCell(16).value = Math.round(mtdPlanned * 10) / 10;
      r.getCell(17).value = adhered;
      r.getCell(18).value = Math.round((pctVal || 0) * 100) + '%';
      r.getCell(19).value = Math.round(pending * 10) / 10;

      applyDataStyle(r.getCell(13));
      applyDataStyle(r.getCell(14));
      applyDataStyle(r.getCell(15), true, '#,##0');
      applyDataStyle(r.getCell(16), true, '#,##0.0');
      applyDataStyle(r.getCell(17), true, '#,##0');
      applyDataStyle(r.getCell(18), true);
      applyDataStyle(r.getCell(19), true, '#,##0.0');

      // Conditional formatting on %
      if (pctVal < 0.7) {
        r.getCell(18).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
        r.getCell(18).font = { color: { argb: COLOR_RED_TEXT }, size: 9 };
      } else if (pctVal >= 1.0) {
        r.getCell(18).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GREEN_FILL } };
        r.getCell(18).font = { color: { argb: COLOR_GREEN_TEXT }, size: 9 };
      }

      // Conditional formatting on pending
      if (pending > 0) {
        r.getCell(19).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
        r.getCell(19).font = { color: { argb: COLOR_RED_TEXT }, size: 9 };
      }

      sRowIdx++;
    }

    // Total Row with Descriptions for Summary Table (Right Side)
    const totSumRow = sheet.getRow(sRowIdx);
    totSumRow.getCell(13).value = `${role} Total (${roleOfficers.length} Officers)`;
    totSumRow.getCell(14).value = 'ALL';
    totSumRow.getCell(15).value = sumOffPlanned;
    totSumRow.getCell(16).value = Math.round(sumOffMtd * 10) / 10;
    totSumRow.getCell(17).value = sumOffAdhered;
    const totOffPct = sumOffMtd > 0 ? (sumOffAdhered / sumOffMtd) : 0;
    totSumRow.getCell(18).value = Math.round(totOffPct * 100) + '%';
    totSumRow.getCell(19).value = Math.round(sumOffPending * 10) / 10;

    for (let col = 13; col <= 19; col++) {
      const c = totSumRow.getCell(col);
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE } };
      c.font = { bold: true, size: 9, name: 'Calibri' };
      c.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'double', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
      };
      if (col >= 15) c.alignment = { horizontal: 'right', vertical: 'middle' };
    }
    sRowIdx++;

    // Populate Left Table: Detailed Dealers grouped by Officer & Category
    let dRowIdx = 5;
    let totDlrPlanned = 0;
    let totDlrMtd = 0;
    let totDlrAdhered = 0;
    let totDlrPending = 0;

    // Group dealers by Officer first, then Category
    const dealersByOfficer = new Map();
    for (const d of roleDealers) {
      const empKey = d.emp_name || d.emp_code || 'Unknown';
      if (!dealersByOfficer.has(empKey)) dealersByOfficer.set(empKey, []);
      dealersByOfficer.get(empKey).push(d);
    }

    for (const [officerName, dList] of dealersByOfficer.entries()) {
      let isFirstRowForOfficer = true;
      let offTotalPlanned = 0;
      let offTotalMtd = 0;
      let offTotalAdhered = 0;

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
          const planned = Number(dl.planned ?? dl.planned_visits ?? 0);
          const mtdPlanned = Number(dl.mtd_planned ?? dl.mtd_due ?? 0);
          const adhered = Number(dl.adhered ?? 0);
          const pending = Number(dl.pending ?? (mtdPlanned - adhered));
          const dlPct = Number.isFinite(dl.adherence_pct)
            ? dl.adherence_pct
            : (mtdPlanned > 0 ? adhered / (mtdPlanned < 1 ? (planned || 1) : mtdPlanned) : 0);

          totDlrPlanned += planned;
          totDlrMtd += mtdPlanned;
          totDlrAdhered += adhered;
          totDlrPending += pending;

          catPlanned += planned;
          catMtd += mtdPlanned;
          catAdhered += adhered;

          offTotalPlanned += planned;
          offTotalMtd += mtdPlanned;
          offTotalAdhered += adhered;

          const r = sheet.getRow(dRowIdx);
          // Show officer name ONCE ONLY on the first row of this officer
          r.getCell(2).value = isFirstRowForOfficer ? (officerName || '') : '';
          isFirstRowForOfficer = false;

          r.getCell(3).value = dl.zone || dl.emp_zone || '';
          r.getCell(4).value = dl.area || '';
          r.getCell(5).value = catName || 'Other';
          r.getCell(6).value = dl.dealer_name || dl.sap_code || '';
          r.getCell(7).value = planned;
          r.getCell(8).value = Math.round(mtdPlanned * 10) / 10;
          r.getCell(9).value = adhered;
          r.getCell(10).value = Math.round((dlPct || 0) * 100) + '%';
          r.getCell(11).value = Math.round(pending * 10) / 10;

          applyDataStyle(r.getCell(2));
          applyDataStyle(r.getCell(3));
          applyDataStyle(r.getCell(4));
          applyDataStyle(r.getCell(5));
          applyDataStyle(r.getCell(6));
          applyDataStyle(r.getCell(7), true, '#,##0');
          applyDataStyle(r.getCell(8), true, '#,##0.0');
          applyDataStyle(r.getCell(9), true, '#,##0');
          applyDataStyle(r.getCell(10), true);
          applyDataStyle(r.getCell(11), true, '#,##0.0');

          if (dlPct < 0.7) {
            r.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
            r.getCell(10).font = { color: { argb: COLOR_RED_TEXT }, size: 9 };
          } else if (dlPct >= 1.0) {
            r.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GREEN_FILL } };
            r.getCell(10).font = { color: { argb: COLOR_GREEN_TEXT }, size: 9 };
          }

          if (pending > 0) {
            r.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
            r.getCell(11).font = { color: { argb: COLOR_RED_TEXT }, size: 9 };
          }

          dRowIdx++;
        }

        // Category Subtotal Row
        const subRow = sheet.getRow(dRowIdx);
        subRow.getCell(2).value = ''; // Officer name shown once only
        subRow.getCell(3).value = '';
        subRow.getCell(4).value = '';
        subRow.getCell(5).value = `${catName} Total`;
        subRow.getCell(6).value = '';
        subRow.getCell(7).value = catPlanned;
        subRow.getCell(8).value = Math.round(catMtd * 10) / 10;
        subRow.getCell(9).value = catAdhered;
        const subPct = catMtd > 0 ? catAdhered / (catMtd < 1 ? (catPlanned || 1) : catMtd) : 0;
        subRow.getCell(10).value = Math.round((subPct || 0) * 100) + '%';
        subRow.getCell(11).value = Math.round((catMtd - catAdhered) * 10) / 10;

        for (let col = 2; col <= 11; col++) {
          const c = subRow.getCell(col);
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GRAY_BG } };
          c.font = { bold: true, size: 9, name: 'Calibri' };
          c.border = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            bottom: { style: 'thin', color: { argb: 'FF94A3B8' } }
          };
          if (col >= 7) c.alignment = { horizontal: 'right', vertical: 'middle' };
        }
        dRowIdx++;
      }

      // Add another row to show total adherence like on the right side of the excel
      const offTotRow = sheet.getRow(dRowIdx);
      offTotRow.getCell(2).value = ''; // Officer name shown once only
      offTotRow.getCell(3).value = '';
      offTotRow.getCell(4).value = '';
      offTotRow.getCell(5).value = 'Total';
      offTotRow.getCell(6).value = '';
      offTotRow.getCell(7).value = offTotalPlanned;
      offTotRow.getCell(8).value = Math.round(offTotalMtd * 10) / 10;
      offTotRow.getCell(9).value = offTotalAdhered;
      const offPct = offTotalMtd > 0 ? (offTotalAdhered / (offTotalMtd < 1 ? (offTotalPlanned || 1) : offTotalMtd)) : 0;
      offTotRow.getCell(10).value = Math.round((offPct || 0) * 100) + '%';
      const offPending = Math.round((offTotalMtd - offTotalAdhered) * 10) / 10;
      offTotRow.getCell(11).value = offPending;

      for (let col = 2; col <= 11; col++) {
        const c = offTotRow.getCell(col);
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GRAY_BG } };
        c.font = { bold: true, size: 9, name: 'Calibri' };
        c.border = {
          top: { style: 'thin', color: { argb: 'FF94A3B8' } },
          bottom: { style: 'thin', color: { argb: 'FF0F172A' } }
        };
        if (col >= 7) c.alignment = { horizontal: 'right', vertical: 'middle' };
      }

      // Conditional formatting on % and pending matching the right side of the excel
      if (offPct < 0.7) {
        offTotRow.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
        offTotRow.getCell(10).font = { color: { argb: COLOR_RED_TEXT }, size: 9, bold: true };
      } else if (offPct >= 1.0) {
        offTotRow.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GREEN_FILL } };
        offTotRow.getCell(10).font = { color: { argb: COLOR_GREEN_TEXT }, size: 9, bold: true };
      }
      if (offPending > 0) {
        offTotRow.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
        offTotRow.getCell(11).font = { color: { argb: COLOR_RED_TEXT }, size: 9, bold: true };
      }
      dRowIdx++;
    }

    // Grand Total Row with Descriptions for Detailed Table (Left Side)
    const totDlrRow = sheet.getRow(dRowIdx);
    totDlrRow.getCell(2).value = '';
    totDlrRow.getCell(3).value = 'ALL';
    totDlrRow.getCell(4).value = '';
    totDlrRow.getCell(5).value = `${role} Grand Total`;
    totDlrRow.getCell(6).value = `(${roleDealers.length} Dealer Visits)`;
    totDlrRow.getCell(7).value = totDlrPlanned;
    totDlrRow.getCell(8).value = Math.round(totDlrMtd * 10) / 10;
    totDlrRow.getCell(9).value = totDlrAdhered;
    const totDlrPct = totDlrMtd > 0 ? (totDlrAdhered / totDlrMtd) : 0;
    totDlrRow.getCell(10).value = Math.round(totDlrPct * 100) + '%';
    totDlrRow.getCell(11).value = Math.round(totDlrPending * 10) / 10;

    for (let col = 2; col <= 11; col++) {
      const c = totDlrRow.getCell(col);
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE } };
      c.font = { bold: true, size: 9, name: 'Calibri' };
      c.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'double', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
      };
      if (col >= 7) c.alignment = { horizontal: 'right', vertical: 'middle' };
    }
    dRowIdx++;

    // AutoFilter on row 4 headers across both Detailed and Summary tables
    sheet.autoFilter = {
      from: 'B4',
      to: 'S4'
    };

    // Balance empty cells between summary and detailed sides to eliminate nulls
    const maxRow = Math.max(sRowIdx, dRowIdx);
    for (let rIdx = 5; rIdx < maxRow; rIdx++) {
      const r = sheet.getRow(rIdx);
      if (rIdx >= dRowIdx) {
        for (let col = 2; col <= 11; col++) {
          const c = r.getCell(col);
          if (c.value === null || c.value === undefined) {
            c.value = '';
            applyDataStyle(c);
          }
        }
      }
      if (rIdx >= sRowIdx) {
        for (let col = 13; col <= 19; col++) {
          const c = r.getCell(col);
          if (c.value === null || c.value === undefined) {
            c.value = '';
            applyDataStyle(c);
          }
        }
      }
    }

    // Set Column Widths
    sheet.getColumn(1).width = 2;   // Spacer
    sheet.getColumn(2).width = 24;  // Officer Name
    sheet.getColumn(3).width = 12;  // Zone
    sheet.getColumn(4).width = 18;  // Area
    sheet.getColumn(5).width = 16;  // Category
    sheet.getColumn(6).width = 32;  // Dealer Name
    sheet.getColumn(7).width = 14;  // Planned
    sheet.getColumn(8).width = 14;  // MTD Planned
    sheet.getColumn(9).width = 14;  // Adhered
    sheet.getColumn(10).width = 14; // MTD %
    sheet.getColumn(11).width = 14; // Pending
    sheet.getColumn(12).width = 4;   // Spacer between Detailed and Summary tables
    sheet.getColumn(13).width = 24; // Officer Name (Summary)
    sheet.getColumn(14).width = 12; // Zone (Summary)
    sheet.getColumn(15).width = 14; // Planned (Summary)
    sheet.getColumn(16).width = 14; // MTD Planned (Summary)
    sheet.getColumn(17).width = 14; // Adhered (Summary)
    sheet.getColumn(18).width = 14; // MTD % (Summary)
    sheet.getColumn(19).width = 14; // Pending (Summary)
  }

  return wb;
}
