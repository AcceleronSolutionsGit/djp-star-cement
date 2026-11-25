import ExcelJS from 'exceljs';
import { analyseAdherence } from '../engines/sfa-adherence.engine.js';

const ROLES = ['SO', 'ASM', 'RSM', 'ZH'];

// Reference Excel palette (matching Trade DJP Zone wise - 12-10-2026.xlsx)
const COLOR_BLUE_BANNER  = 'FFD9E1F2'; // Light blue banner & officer total fill
const COLOR_GOLD_DATE    = 'FFFFC000'; // Amber/gold As-on Date highlight
const COLOR_NEUTRAL_HDR  = 'FFF2F2F2'; // Neutral gray header for dimension cols
const COLOR_YELLOW       = 'FFFFFF00'; // Planned / MTD Due yellow + Category Total highlight
const COLOR_GREEN_DARK   = 'FF00B050'; // Adhered & Adherence % dark green header (white text)
const COLOR_RED_DARK     = 'FFFF0000'; // Pending red header (white text)
const COLOR_RED_FILL     = 'FFFFC7CE';
const COLOR_RED_TEXT     = 'FF9C0006';
const COLOR_GREEN_FILL   = 'FFC6EFCE';
const COLOR_GREEN_TEXT   = 'FF006100';
const COLOR_BORDER_DARK  = 'FF808080';
const COLOR_BORDER_LIGHT = 'FFD9D9D9';

function applyHeaderStyle(cell, fillArgb, fontColor = 'FF000000', fontSize = 10) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
  cell.font = { bold: true, size: fontSize, name: 'Calibri', color: { argb: fontColor } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = {
    top:    { style: 'thin', color: { argb: COLOR_BORDER_DARK } },
    left:   { style: 'thin', color: { argb: COLOR_BORDER_DARK } },
    bottom: { style: 'thin', color: { argb: COLOR_BORDER_DARK } },
    right:  { style: 'thin', color: { argb: COLOR_BORDER_DARK } }
  };
}

function applyDataStyle(cell, isNumber = false, format = null, bold = false) {
  cell.font = { size: 10, name: 'Calibri', bold };
  cell.alignment = { vertical: 'middle', horizontal: isNumber ? 'center' : 'left' };
  cell.border = {
    top:    { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } },
    left:   { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } },
    bottom: { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } },
    right:  { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } }
  };
  if (format) cell.numFmt = format;
}

function applyPctAndPendingStyles(pctCell, pendingCell, pctVal, pendingVal, bold = false) {
  if (pctVal < 0.7) {
    pctCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
    pctCell.font = { color: { argb: COLOR_RED_TEXT }, size: 10, name: 'Calibri', bold };
  } else if (pctVal >= 1.0) {
    pctCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GREEN_FILL } };
    pctCell.font = { color: { argb: COLOR_GREEN_TEXT }, size: 10, name: 'Calibri', bold };
  }
  if (pendingVal > 0) {
    pendingCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_RED_FILL } };
    pendingCell.font = { color: { argb: COLOR_RED_TEXT }, size: 10, name: 'Calibri', bold };
  }
}

export async function buildAdherenceWorkbook({ periodMonth, cycleCode = 'ALL', asOnDate = null }) {
  const cleanCycle = String(cycleCode || '').trim();
  const isCombined = !cleanCycle || cleanCycle.toUpperCase() === 'ALL' || cleanCycle.includes('Object') || !['C1', 'C2'].includes(cleanCycle.toUpperCase()) || cleanCycle === 'Whole_Month' || cleanCycle === 'WHOLE_MONTH' || cleanCycle === 'BOTH' || cleanCycle === 'C1_C2' || cleanCycle === 'COMBINED';
  const month = periodMonth || '2026-10';
  const cycle = isCombined ? null : cleanCycle.toUpperCase();
  const cycleLabel = isCombined ? 'Full Month (C1+C2)' : (cycle || 'Full Month');

  const a = await analyseAdherence({
    periodMonth: month,
    cycleCode: isCombined ? 'ALL' : cycle,
    asOnDate: asOnDate || null
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Star Cement DJP Engine';
  wb.created = new Date();

  // ── 1. Summary Sheet ────────────────────────────────────────────────────────
  const summarySheet = wb.addWorksheet('Summary', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 4, topLeftCell: 'A5', showGridLines: false }]
  });

  // Top Metadata Banner
  summarySheet.getCell(1, 1).value = `Trade DJP Adherence Summary — ${month} (${cycleLabel})`;
  summarySheet.getCell(1, 1).font = { bold: true, size: 14, name: 'Calibri', color: { argb: 'FF1E293B' } };
  summarySheet.mergeCells('A1:G1');

  summarySheet.getCell(1, 8).value = 'MTD as on';
  summarySheet.getCell(1, 8).font = { bold: true, size: 11, name: 'Calibri' };
  summarySheet.getCell(1, 8).alignment = { horizontal: 'right', vertical: 'middle' };

  summarySheet.getCell(1, 9).value = a.asOnDate;
  summarySheet.getCell(1, 9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GOLD_DATE } };
  summarySheet.getCell(1, 9).font = { bold: true, size: 11, name: 'Calibri' };
  summarySheet.getCell(1, 9).alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getRow(1).height = 24;

  summarySheet.getCell(2, 1).value = 'ZONE: (All)';
  summarySheet.getCell(2, 1).font = { size: 10, name: 'Calibri', bold: true };
  summarySheet.getCell(2, 2).value = `Total Officers: ${a.byEmployee.length} | Total Dealers: ${a.totals.dealers || 0}`;
  summarySheet.getCell(2, 2).font = { size: 10, name: 'Calibri' };

  // Row 4: Overall & Role Breakdown Header
  const sumHeaders = [
    { col: 1, text: 'Dimension',        bg: COLOR_BLUE_BANNER, fg: 'FF000000' },
    { col: 2, text: 'Officers',         bg: COLOR_BLUE_BANNER, fg: 'FF000000' },
    { col: 3, text: 'Dealers',          bg: COLOR_BLUE_BANNER, fg: 'FF000000' },
    { col: 4, text: 'Planned Visits',   bg: COLOR_YELLOW,      fg: 'FF000000' },
    { col: 5, text: 'MTD Due',          bg: COLOR_YELLOW,      fg: 'FF000000' },
    { col: 6, text: 'Adhered',          bg: COLOR_GREEN_DARK,  fg: 'FFFFFFFF' },
    { col: 7, text: 'Adhered (Capped)', bg: COLOR_GREEN_DARK,  fg: 'FFFFFFFF' },
    { col: 8, text: 'Adherence %',      bg: COLOR_GREEN_DARK,  fg: 'FFFFFFFF' },
    { col: 9, text: 'Pending',          bg: COLOR_RED_DARK,    fg: 'FFFFFFFF' }
  ];
  sumHeaders.forEach(h => {
    const c = summarySheet.getCell(4, h.col);
    c.value = h.text;
    applyHeaderStyle(c, h.bg, h.fg, 10);
  });
  summarySheet.getRow(4).height = 28;

  const addSummaryDataRow = (rowIdx, label, officers, dealers, planned, mtd, adhered, capped, pct, pending, bold = false, fillArgb = null) => {
    const r = summarySheet.getRow(rowIdx);
    r.getCell(1).value = label;
    r.getCell(2).value = officers;
    r.getCell(3).value = dealers;
    r.getCell(4).value = planned;
    r.getCell(5).value = Math.round(mtd * 10) / 10;
    r.getCell(6).value = adhered;
    r.getCell(7).value = capped;
    r.getCell(8).value = pct;
    r.getCell(9).value = Math.round(pending * 10) / 10;

    applyDataStyle(r.getCell(1), false, null, bold);
    applyDataStyle(r.getCell(2), true, '#,##0', bold);
    applyDataStyle(r.getCell(3), true, '#,##0', bold);
    applyDataStyle(r.getCell(4), true, '#,##0', bold);
    applyDataStyle(r.getCell(5), true, '#,##0.0', bold);
    applyDataStyle(r.getCell(6), true, '#,##0', bold);
    applyDataStyle(r.getCell(7), true, '#,##0', bold);
    applyDataStyle(r.getCell(8), true, '0.0%', bold);
    applyDataStyle(r.getCell(9), true, '#,##0.0', bold);
    if (fillArgb) {
      for (let col = 1; col <= 9; col++) {
        r.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
      }
    }
    return rowIdx + 1;
  };

  let curSumRow = 5;
  curSumRow = addSummaryDataRow(
    curSumRow, 'Overall Total',
    a.byEmployee.length || 0,
    a.totals.dealers || 0,
    a.totals.planned || 0,
    a.totals.mtd_planned || a.totals.mtd_due || 0,
    a.totals.adhered || 0,
    a.totals.adhered_capped || 0,
    a.totals.adherence_pct || 0,
    a.totals.pending || 0,
    true, COLOR_BLUE_BANNER
  );
  curSumRow++;

  summarySheet.getCell(curSumRow, 1).value = 'Role Breakdown';
  summarySheet.getCell(curSumRow, 1).font = { bold: true, size: 11, name: 'Calibri' };
  curSumRow++;

  for (const r of ROLES) {
    const isZh = r.toUpperCase() === 'ZH';
    const roleOfficers = a.byEmployee.filter(e => {
      const rStr = (e.role || 'SO').toUpperCase();
      return isZh ? ['ZH', 'ZM', 'ZSH', 'ZONAL HEAD'].includes(rStr) : rStr === r.toUpperCase();
    });
    const roleData = a.byRole[r] || { dealers: 0, planned: 0, mtd_planned: 0, adhered: 0, adhered_capped: 0, adherence_pct: 0, pending: 0 };
    curSumRow = addSummaryDataRow(
      curSumRow, r,
      roleOfficers.length,
      roleData.dealers || 0,
      roleData.planned || 0,
      roleData.mtd_planned || roleData.mtd_due || 0,
      roleData.adhered || 0,
      roleData.adhered_capped || 0,
      roleData.adherence_pct || 0,
      roleData.pending || 0
    );
  }
  curSumRow++;

  // Category Breakdown Table (matching Ref Summary R8..R15)
  summarySheet.getCell(curSumRow, 1).value = 'Category Breakdown';
  summarySheet.getCell(curSumRow, 1).font = { bold: true, size: 11, name: 'Calibri' };
  curSumRow++;

  sumHeaders.forEach(h => {
    const c = summarySheet.getCell(curSumRow, h.col);
    c.value = h.col === 1 ? 'Category' : (h.col === 2 ? 'Rows' : h.text);
    applyHeaderStyle(c, h.bg, h.fg, 10);
  });
  summarySheet.getRow(curSumRow).height = 26;
  curSumRow++;

  const catBuckets = new Map();
  for (const d of a.byDealer) {
    const cat = d.category || 'Growing';
    if (!catBuckets.has(cat)) {
      catBuckets.set(cat, { rows: 0, dealerKeys: new Set(), planned: 0, mtd: 0, adhered: 0, capped: 0 });
    }
    const b = catBuckets.get(cat);
    b.rows += 1;
    b.dealerKeys.add(`${d.role}|${d.emp_code}|${d.sap_code || d.dealer_name}`);
    b.planned += Number(d.planned ?? d.planned_visits ?? 0);
    b.mtd += Number(d.mtd_planned ?? d.mtd_due ?? 0);
    b.adhered += Number(d.adhered ?? 0);
    b.capped += Number(d.adhered_capped ?? 0);
  }

  const catOrderList = ['De-growing', 'Growing', 'Need to Grow', 'Zero Lifter', 'Prospective', 'Churn'];
  const sortedCatKeys = Array.from(catBuckets.keys()).sort((x, y) => {
    const ix = catOrderList.indexOf(x);
    const iy = catOrderList.indexOf(y);
    if (ix !== -1 && iy !== -1) return ix - iy;
    if (ix !== -1) return -1;
    if (iy !== -1) return 1;
    return x.localeCompare(y);
  });

  let catTotRows = 0, catTotDealers = 0, catTotPlanned = 0, catTotMtd = 0, catTotAdh = 0, catTotCap = 0;
  for (const catKey of sortedCatKeys) {
    const b = catBuckets.get(catKey);
    const den = b.mtd < 1 ? (b.planned || 1) : b.mtd;
    const pct = den > 0 ? b.adhered / den : 0;
    const pend = b.mtd - b.adhered;
    catTotRows += b.rows;
    catTotDealers += b.dealerKeys.size;
    catTotPlanned += b.planned;
    catTotMtd += b.mtd;
    catTotAdh += b.adhered;
    catTotCap += b.capped;
    curSumRow = addSummaryDataRow(
      curSumRow, catKey, b.rows, b.dealerKeys.size, b.planned, b.mtd, b.adhered, b.capped, pct, pend
    );
  }
  const catTotDen = catTotMtd < 1 ? (catTotPlanned || 1) : catTotMtd;
  curSumRow = addSummaryDataRow(
    curSumRow, 'Category Grand Total', catTotRows, catTotDealers, catTotPlanned, catTotMtd, catTotAdh, catTotCap,
    catTotDen > 0 ? catTotAdh / catTotDen : 0, catTotMtd - catTotAdh, true, COLOR_BLUE_BANNER
  );
  curSumRow++;

  // Zone Breakdown Table
  summarySheet.getCell(curSumRow, 1).value = 'Zone Breakdown';
  summarySheet.getCell(curSumRow, 1).font = { bold: true, size: 11, name: 'Calibri' };
  curSumRow++;

  sumHeaders.forEach(h => {
    const c = summarySheet.getCell(curSumRow, h.col);
    c.value = h.col === 1 ? 'Zone' : h.text;
    applyHeaderStyle(c, h.bg, h.fg, 10);
  });
  summarySheet.getRow(curSumRow).height = 26;
  curSumRow++;

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

    curSumRow = addSummaryDataRow(
      curSumRow, z,
      zData.officers || 0,
      zData.dealers || 0,
      zData.planned || 0,
      zData.mtd_planned || zData.mtd_due || 0,
      zData.adhered || 0,
      zData.adhered_capped || 0,
      zData.adherence_pct || 0,
      zData.pending || 0
    );
  }
  addSummaryDataRow(
    curSumRow, `Total (${zones.length} Zones)`,
    sumZoneOfficers, sumZoneDealers, sumZonePlanned, sumZoneMtd, sumZoneAdhered, sumZoneCapped,
    sumZoneMtd > 0 ? (sumZoneAdhered / sumZoneMtd) : 0, sumZonePending, true, COLOR_BLUE_BANNER
  );

  summarySheet.getColumn(1).width = 28;
  summarySheet.getColumn(2).width = 14;
  summarySheet.getColumn(3).width = 14;
  summarySheet.getColumn(4).width = 16;
  summarySheet.getColumn(5).width = 14;
  summarySheet.getColumn(6).width = 14;
  summarySheet.getColumn(7).width = 17;
  summarySheet.getColumn(8).width = 15;
  summarySheet.getColumn(9).width = 14;

  // ── 2. Individual Role Sheets: SO, ASM, RSM, ZH ─────────────────────────────
  for (const role of ROLES) {
    const sheet = wb.addWorksheet(role, {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 5, topLeftCell: 'A6', showGridLines: false }]
    });

    const isZh = role.toUpperCase() === 'ZH';
    const roleOfficers = a.byEmployee.filter(e => {
      const r = (e.role || 'SO').toUpperCase();
      return isZh ? ['ZH', 'ZM', 'ZSH', 'ZONAL HEAD'].includes(r) : r === role.toUpperCase();
    }).sort((x, y) => String(x.emp_name || x.emp_code || '').localeCompare(String(y.emp_name || y.emp_code || '')));

    const roleDealers = a.byDealer.filter(d => {
      const r = (d.role || 'SO').toUpperCase();
      return isZh ? ['ZH', 'ZM', 'ZSH', 'ZONAL HEAD'].includes(r) : r === role.toUpperCase();
    });

    // Group dealers by Officer first
    const dealersByOfficer = new Map();
    for (const d of roleDealers) {
      const empKey = d.emp_name || d.emp_code || 'Unknown';
      if (!dealersByOfficer.has(empKey)) dealersByOfficer.set(empKey, []);
      dealersByOfficer.get(empKey).push(d);
    }

    // Consolidate C1+C2 rows per dealer in combined/full-month mode
    let totalConsolidatedDealers = 0;
    const sortedOfficerEntries = Array.from(dealersByOfficer.entries()).sort((x, y) => x[0].localeCompare(y[0]));
    for (const [empKey, dList] of sortedOfficerEntries) {
      let processedList = dList;
      if (isCombined) {
        const consolidatedMap = new Map();
        for (const dl of dList) {
          const dKey = `${dl.sap_code || dl.dealer_sap_code || dl.dealer_name}`;
          if (!consolidatedMap.has(dKey)) {
            consolidatedMap.set(dKey, {
              ...dl,
              sap_code: dl.sap_code || dl.dealer_sap_code || '',
              sfa_code: dl.sfa_code || '',
              planned: Number(dl.planned ?? dl.planned_visits ?? 0),
              mtd_planned: Number(dl.mtd_planned ?? dl.mtd_due ?? 0),
              adhered: Number(dl.adhered ?? 0),
              adhered_capped: Number(dl.adhered_capped ?? 0),
            });
          } else {
            const existing = consolidatedMap.get(dKey);
            if (!existing.sfa_code && dl.sfa_code) existing.sfa_code = dl.sfa_code;
            if (!existing.sap_code && (dl.sap_code || dl.dealer_sap_code)) existing.sap_code = dl.sap_code || dl.dealer_sap_code;
            existing.planned += Number(dl.planned ?? dl.planned_visits ?? 0);
            existing.mtd_planned += Number(dl.mtd_planned ?? dl.mtd_due ?? 0);
            existing.adhered += Number(dl.adhered ?? 0);
            existing.adhered_capped += Number(dl.adhered_capped ?? 0);
          }
        }
        processedList = Array.from(consolidatedMap.values()).map(dl => {
          const mtdPlanned = dl.mtd_planned;
          const planned = dl.planned;
          const adhered = dl.adhered;
          const pending = mtdPlanned - adhered;
          const denominator = mtdPlanned < 1 ? (planned || 1) : mtdPlanned;
          const adherence_pct = denominator > 0 ? adhered / denominator : 0;
          return { ...dl, planned_visits: planned, mtd_due: mtdPlanned, pending, adherence_pct };
        });
      }
      totalConsolidatedDealers += processedList.length;
      dealersByOfficer.set(empKey, processedList);
    }

    // Rows 1-3: Top Filter Context Metadata (matching Reference sheet structure)
    sheet.getCell(1, 2).value = `MTD No. of visits Planned by ${role} in (DJP)`;
    sheet.getCell(1, 3).value = '> 0 (All Active)';
    sheet.getCell(1, 15).value = `MTD No. of visits Planned by ${role} in (DJP)`;
    sheet.getCell(1, 16).value = '> 0 (All Active)';

    sheet.getCell(2, 2).value = 'ZONE';
    sheet.getCell(2, 3).value = '(All) — Use Row 5 filter dropdowns below';
    sheet.getCell(2, 15).value = 'ZONE';
    sheet.getCell(2, 16).value = '(All)';

    sheet.getCell(3, 2).value = 'Period / Cycle';
    sheet.getCell(3, 3).value = `${month} — ${cycleLabel}`;
    sheet.getCell(3, 15).value = `Total ${role} Officers`;
    sheet.getCell(3, 16).value = `${roleOfficers.length} Officers / ${totalConsolidatedDealers} Customers`;

    for (const rNum of [1, 2, 3]) {
      for (const cNum of [2, 3, 15, 16]) {
        sheet.getCell(rNum, cNum).font = { size: 10, name: 'Calibri', bold: cNum === 2 || cNum === 15 };
      }
    }

    // Row 4: Section Banners (matching Ref D4/E4:I4 & L4:P4)
    sheet.getRow(4).height = 24;
    sheet.getCell(4, 2).value = 'MTD as on';
    sheet.getCell(4, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_BANNER } };
    sheet.getCell(4, 2).font = { bold: true, size: 11, name: 'Calibri' };
    sheet.getCell(4, 2).alignment = { horizontal: 'right', vertical: 'middle' };

    sheet.getCell(4, 3).value = a.asOnDate;
    sheet.getCell(4, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GOLD_DATE } };
    sheet.getCell(4, 3).font = { bold: true, size: 11, name: 'Calibri' };
    sheet.getCell(4, 3).alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.mergeCells('D4:M4');
    sheet.getCell(4, 4).value = `${role} DJP - Customer Wise Visit Report (${month} • ${cycleLabel})`;
    sheet.getCell(4, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_BANNER } };
    sheet.getCell(4, 4).font = { bold: true, size: 14, name: 'Calibri' };
    sheet.getCell(4, 4).alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.getCell(4, 15).value = a.asOnDate;
    sheet.getCell(4, 15).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GOLD_DATE } };
    sheet.getCell(4, 15).font = { bold: true, size: 11, name: 'Calibri' };
    sheet.getCell(4, 15).alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.mergeCells('P4:U4');
    sheet.getCell(4, 16).value = `${role} DJP - Summary Report`;
    sheet.getCell(4, 16).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_BANNER } };
    sheet.getCell(4, 16).font = { bold: true, size: 14, name: 'Calibri' };
    sheet.getCell(4, 16).alignment = { horizontal: 'center', vertical: 'middle' };

    // Row 5: Detailed & Summary Headers
    const detailedHeaders = [
      { col: 2,  text: `${role}/SE NAME`, bg: COLOR_NEUTRAL_HDR, fg: 'FF000000' },
      { col: 3,  text: 'Zone', bg: COLOR_NEUTRAL_HDR, fg: 'FF000000' },
      { col: 4,  text: 'Area', bg: COLOR_NEUTRAL_HDR, fg: 'FF000000' },
      { col: 5,  text: 'Category', bg: COLOR_NEUTRAL_HDR, fg: 'FF000000' },
      { col: 6,  text: 'DEALER NAME', bg: COLOR_NEUTRAL_HDR, fg: 'FF000000' },
      { col: 7,  text: 'SAP Code', bg: COLOR_NEUTRAL_HDR, fg: 'FF000000' },
      { col: 8,  text: 'SFA Code', bg: COLOR_NEUTRAL_HDR, fg: 'FF000000' },
      { col: 9,  text: `No. of visits Planned by ${role} in (DJP)`, bg: COLOR_YELLOW, fg: 'FF000000' },
      { col: 10, text: `MTD Nos of visits Planned by ${role} in (DJP)`, bg: COLOR_YELLOW, fg: 'FF000000' },
      { col: 11, text: `No. of visits Adhered by ${role}`, bg: COLOR_GREEN_DARK, fg: 'FFFFFFFF' },
      { col: 12, text: `MTD ${role} % of Visit Adherence`, bg: COLOR_GREEN_DARK, fg: 'FFFFFFFF' },
      { col: 13, text: `${role} Pending to visit as per DJP`, bg: COLOR_RED_DARK, fg: 'FFFFFFFF' }
    ];

    const summaryHeaders = [
      { col: 15, text: `${role}/SE NAME`, bg: COLOR_NEUTRAL_HDR, fg: 'FF000000' },
      { col: 16, text: 'Zone', bg: COLOR_NEUTRAL_HDR, fg: 'FF000000' },
      { col: 17, text: `No. of visits Planned by ${role} in (DJP)`, bg: COLOR_YELLOW, fg: 'FF000000' },
      { col: 18, text: `MTD Nos of visits Planned by ${role} in (DJP)`, bg: COLOR_YELLOW, fg: 'FF000000' },
      { col: 19, text: `No. of visits Adhered by ${role}`, bg: COLOR_GREEN_DARK, fg: 'FFFFFFFF' },
      { col: 20, text: `MTD ${role} % of Visit Adherence`, bg: COLOR_GREEN_DARK, fg: 'FFFFFFFF' },
      { col: 21, text: `${role} Pending to visit as per DJP`, bg: COLOR_RED_DARK, fg: 'FFFFFFFF' }
    ];

    detailedHeaders.forEach(h => {
      const c = sheet.getCell(5, h.col);
      c.value = h.text;
      applyHeaderStyle(c, h.bg, h.fg, 10);
    });
    summaryHeaders.forEach(h => {
      const c = sheet.getCell(5, h.col);
      c.value = h.text;
      applyHeaderStyle(c, h.bg, h.fg, 10);
    });
    sheet.getRow(5).height = 38;

    // Populate Right Table: Officer Summary (Rows 6+)
    let sRowIdx = 6;
    let sumOffPlanned = 0, sumOffMtd = 0, sumOffAdhered = 0, sumOffPending = 0;

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
      r.getCell(15).value = off.emp_name || off.emp_code || '';
      r.getCell(16).value = off.zone || 'ALL';
      r.getCell(17).value = planned;
      r.getCell(18).value = Math.round(mtdPlanned * 10) / 10;
      r.getCell(19).value = adhered;
      r.getCell(20).value = pctVal || 0;
      r.getCell(21).value = Math.round(pending * 10) / 10;

      applyDataStyle(r.getCell(15));
      applyDataStyle(r.getCell(16));
      applyDataStyle(r.getCell(17), true, '#,##0');
      applyDataStyle(r.getCell(18), true, '#,##0.0');
      applyDataStyle(r.getCell(19), true, '#,##0');
      applyDataStyle(r.getCell(20), true, '0%');
      applyDataStyle(r.getCell(21), true, '#,##0.0');
      applyPctAndPendingStyles(r.getCell(20), r.getCell(21), pctVal, pending);

      sRowIdx++;
    }

    const totSumRow = sheet.getRow(sRowIdx);
    totSumRow.getCell(15).value = `Grand Total (${roleOfficers.length} Officers)`;
    totSumRow.getCell(16).value = 'ALL';
    totSumRow.getCell(17).value = sumOffPlanned;
    totSumRow.getCell(18).value = Math.round(sumOffMtd * 10) / 10;
    totSumRow.getCell(19).value = sumOffAdhered;
    const totOffPct = sumOffMtd > 0 ? (sumOffAdhered / sumOffMtd) : 0;
    totSumRow.getCell(20).value = totOffPct;
    totSumRow.getCell(21).value = Math.round(sumOffPending * 10) / 10;

    for (let col = 15; col <= 21; col++) {
      const c = totSumRow.getCell(col);
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_BANNER } };
      c.font = { bold: true, size: 10, name: 'Calibri' };
      c.border = {
        top: { style: 'thin', color: { argb: COLOR_BORDER_DARK } },
        bottom: { style: 'double', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } },
        right: { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } }
      };
      if (col >= 17) c.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    totSumRow.getCell(17).numFmt = '#,##0';
    totSumRow.getCell(18).numFmt = '#,##0.0';
    totSumRow.getCell(19).numFmt = '#,##0';
    totSumRow.getCell(20).numFmt = '0%';
    totSumRow.getCell(21).numFmt = '#,##0.0';
    sRowIdx++;

    // Populate Left Table: Customer-Wise Report (Rows 6+)
    let dRowIdx = 6;
    let totDlrPlanned = 0, totDlrMtd = 0, totDlrAdhered = 0, totDlrPending = 0;

    for (const [officerName] of sortedOfficerEntries) {
      const dList = dealersByOfficer.get(officerName) || [];
      let offTotalPlanned = 0, offTotalMtd = 0, offTotalAdhered = 0;
      const offZone = dList[0]?.zone || dList[0]?.emp_zone || '';

      const byCat = new Map();
      for (const d of dList) {
        const cat = d.category || 'Growing';
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(d);
      }

      const catOrder = {
        'De-growing': 1,
        'Growing': 2,
        'Need to Grow': 3,
        'Need to grow': 3,
        'Zero Lifter': 4,
        'Zero lifter': 4,
        'Prospective': 5,
        'Churn': 6
      };
      const sortedCatNames = Array.from(byCat.keys()).sort((x, y) => {
        const ox = catOrder[x] || 99;
        const oy = catOrder[y] || 99;
        if (ox !== oy) return ox - oy;
        return x.localeCompare(y);
      });

      for (const catName of sortedCatNames) {
        const cDealers = byCat.get(catName).sort((x, y) => String(x.dealer_name || '').localeCompare(String(y.dealer_name || '')));
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
          // Repeat Officer Name, Zone, Area on every row so Excel AutoFilter works on every column!
          r.getCell(2).value = officerName || '';
          r.getCell(3).value = dl.zone || dl.emp_zone || '';
          r.getCell(4).value = dl.area || '';
          r.getCell(5).value = catName || 'Growing';
          r.getCell(6).value = dl.dealer_name || dl.sap_code || '';
          r.getCell(7).value = dl.sap_code || dl.dealer_sap_code || '';
          r.getCell(8).value = dl.sfa_code || '';
          r.getCell(9).value = planned;
          r.getCell(10).value = Math.round(mtdPlanned * 10) / 10;
          r.getCell(11).value = adhered;
          r.getCell(12).value = dlPct || 0;
          r.getCell(13).value = Math.round(pending * 10) / 10;

          applyDataStyle(r.getCell(2));
          applyDataStyle(r.getCell(3));
          applyDataStyle(r.getCell(4));
          applyDataStyle(r.getCell(5), false, null, true); // Bold Category like Ref
          applyDataStyle(r.getCell(6));
          applyDataStyle(r.getCell(7));
          applyDataStyle(r.getCell(8));
          applyDataStyle(r.getCell(9), true, '#,##0');
          applyDataStyle(r.getCell(10), true, '#,##0.0');
          applyDataStyle(r.getCell(11), true, '#,##0');
          applyDataStyle(r.getCell(12), true, '0%');
          applyDataStyle(r.getCell(13), true, '#,##0.0');
          applyPctAndPendingStyles(r.getCell(12), r.getCell(13), dlPct, pending);

          dRowIdx++;
        }

        // Category Subtotal Row (matching Ref Yellow highlight on numeric cols)
        const subRow = sheet.getRow(dRowIdx);
        subRow.getCell(2).value = officerName || '';
        subRow.getCell(3).value = offZone;
        subRow.getCell(4).value = '';
        subRow.getCell(5).value = `${catName} Total`;
        subRow.getCell(6).value = `(${cDealers.length} Customers)`;
        subRow.getCell(7).value = '';
        subRow.getCell(8).value = '';
        subRow.getCell(9).value = catPlanned;
        subRow.getCell(10).value = Math.round(catMtd * 10) / 10;
        subRow.getCell(11).value = catAdhered;
        const subPct = catMtd > 0 ? catAdhered / (catMtd < 1 ? (catPlanned || 1) : catMtd) : 0;
        subRow.getCell(12).value = subPct || 0;
        subRow.getCell(13).value = Math.round((catMtd - catAdhered) * 10) / 10;

        for (let col = 2; col <= 13; col++) {
          const c = subRow.getCell(col);
          c.font = { bold: true, size: 10, name: 'Calibri' };
          c.border = {
            top: { style: 'thin', color: { argb: COLOR_BORDER_DARK } },
            bottom: { style: 'thin', color: { argb: COLOR_BORDER_DARK } },
            left: { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } },
            right: { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } }
          };
          if (col >= 9) {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_YELLOW } };
            c.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        }
        subRow.getCell(9).numFmt = '#,##0';
        subRow.getCell(10).numFmt = '#,##0.0';
        subRow.getCell(11).numFmt = '#,##0';
        subRow.getCell(12).numFmt = '0%';
        subRow.getCell(13).numFmt = '#,##0.0';
        dRowIdx++;
      }

      // Officer Total Row (matching Ref Blue fill across row)
      const offTotRow = sheet.getRow(dRowIdx);
      offTotRow.getCell(2).value = officerName || '';
      offTotRow.getCell(3).value = offZone;
      offTotRow.getCell(4).value = '';
      offTotRow.getCell(5).value = 'Officer Total';
      offTotRow.getCell(6).value = `(${dList.length} Customers)`;
      offTotRow.getCell(7).value = '';
      offTotRow.getCell(8).value = '';
      offTotRow.getCell(9).value = offTotalPlanned;
      offTotRow.getCell(10).value = Math.round(offTotalMtd * 10) / 10;
      offTotRow.getCell(11).value = offTotalAdhered;
      const offPct = offTotalMtd > 0 ? (offTotalAdhered / (offTotalMtd < 1 ? (offTotalPlanned || 1) : offTotalMtd)) : 0;
      offTotRow.getCell(12).value = offPct || 0;
      const offPending = Math.round((offTotalMtd - offTotalAdhered) * 10) / 10;
      offTotRow.getCell(13).value = offPending;

      for (let col = 2; col <= 13; col++) {
        const c = offTotRow.getCell(col);
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_BANNER } };
        c.font = { bold: true, size: 10, name: 'Calibri' };
        c.border = {
          top: { style: 'thin', color: { argb: COLOR_BORDER_DARK } },
          bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
          left: { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } },
          right: { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } }
        };
        if (col >= 9) c.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      offTotRow.getCell(9).numFmt = '#,##0';
      offTotRow.getCell(10).numFmt = '#,##0.0';
      offTotRow.getCell(11).numFmt = '#,##0';
      offTotRow.getCell(12).numFmt = '0%';
      offTotRow.getCell(13).numFmt = '#,##0.0';
      applyPctAndPendingStyles(offTotRow.getCell(12), offTotRow.getCell(13), offPct, offPending, true);
      dRowIdx++;
    }

    // Grand Total Row for Detailed Table
    const totDlrRow = sheet.getRow(dRowIdx);
    totDlrRow.getCell(2).value = 'Grand Total';
    totDlrRow.getCell(3).value = 'ALL';
    totDlrRow.getCell(4).value = '';
    totDlrRow.getCell(5).value = `${role} Grand Total`;
    totDlrRow.getCell(6).value = `(${roleOfficers.length} Officers, ${totalConsolidatedDealers} Customers)`;
    totDlrRow.getCell(7).value = '';
    totDlrRow.getCell(8).value = '';
    totDlrRow.getCell(9).value = totDlrPlanned;
    totDlrRow.getCell(10).value = Math.round(totDlrMtd * 10) / 10;
    totDlrRow.getCell(11).value = totDlrAdhered;
    const totDlrPct = totDlrMtd > 0 ? (totDlrAdhered / totDlrMtd) : 0;
    totDlrRow.getCell(12).value = totDlrPct || 0;
    totDlrRow.getCell(13).value = Math.round(totDlrPending * 10) / 10;

    for (let col = 2; col <= 13; col++) {
      const c = totDlrRow.getCell(col);
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BLUE_BANNER } };
      c.font = { bold: true, size: 10, name: 'Calibri' };
      c.border = {
        top: { style: 'thin', color: { argb: COLOR_BORDER_DARK } },
        bottom: { style: 'double', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } },
        right: { style: 'thin', color: { argb: COLOR_BORDER_LIGHT } }
      };
      if (col >= 9) c.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    totDlrRow.getCell(9).numFmt = '#,##0';
    totDlrRow.getCell(10).numFmt = '#,##0.0';
    totDlrRow.getCell(11).numFmt = '#,##0';
    totDlrRow.getCell(12).numFmt = '0%';
    totDlrRow.getCell(13).numFmt = '#,##0.0';

    // Enable Excel AutoFilter on Row 5 covering ALL Detailed Table rows (B5:M{lastRow})
    sheet.autoFilter = {
      from: { row: 5, column: 2 },
      to:   { row: Math.max(5, dRowIdx), column: 13 }
    };

    // Column Widths matching Ref sheet readability
    sheet.getColumn(1).width = 2;
    sheet.getColumn(2).width = 26;
    sheet.getColumn(3).width = 12;
    sheet.getColumn(4).width = 22;
    sheet.getColumn(5).width = 18;
    sheet.getColumn(6).width = 40;
    sheet.getColumn(7).width = 14;
    sheet.getColumn(8).width = 14;
    sheet.getColumn(9).width = 15;
    sheet.getColumn(10).width = 15;
    sheet.getColumn(11).width = 14;
    sheet.getColumn(12).width = 14;
    sheet.getColumn(13).width = 14;
    sheet.getColumn(14).width = 4;
    sheet.getColumn(15).width = 26;
    sheet.getColumn(16).width = 12;
    sheet.getColumn(17).width = 15;
    sheet.getColumn(18).width = 15;
    sheet.getColumn(19).width = 14;
    sheet.getColumn(20).width = 14;
    sheet.getColumn(21).width = 14;
  }

  return wb;
}
