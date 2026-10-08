import { generateFullPjpDjpSolution } from '../engines/djp-generator.engine.js';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { generateDealerTrace } from '../engines/pjp/pjp-validator.engine.js';
import { reconcileUniverse } from '../engines/pjp/reconciliation.service.js';
import { checkAllExcelInputsAvailable } from '../engines/pjp/data-loader.engine.js';
import { AutoPlanGenerator } from '../engines/autoPlanGenerator.js';
import { dbAll, dbGet } from '../config/database.js';
import XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
  COLUMNS as MASTER_COLUMNS, SHEET_NAME as MASTER_SHEET_NAME,
  HEADER_ROW, FIRST_DATA_ROW, buildHeaders, buildSources,
  buildRow, rowToArray, anchorDate, dedupeTargets
} from '../services/masterSheet.service.js';

/**
 * Run canonical PJP calculation only (without DJP allocation).
 */
export async function calculatePjp(req, res) {
  try {
    const planMonth = req.body.planMonth || req.body.periodMonth;
    const cycleCode = req.body.cycleCode || 'C1';

    if (!planMonth || typeof planMonth !== 'string') {
      return res.status(400).json({ error: 'planMonth is required. Please specify the planning month in YYYY-MM format.' });
    }
    const match = planMonth.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return res.status(400).json({ error: `Invalid planMonth: '${planMonth}'. Expected format is YYYY-MM.` });
    }
    const mNum = parseInt(match[2], 10);
    if (mNum < 1 || mNum > 12) {
      return res.status(400).json({ error: `Invalid planMonth: '${planMonth}'. Month must be between 01 and 12.` });
    }
    const periodMonth = planMonth;

    // Verify all 5 Excel files are available before calculating
    const inputCheck = await checkAllExcelInputsAvailable();
    if (!inputCheck.allAvailable) {
      return res.status(400).json({
        error: `Cannot generate DJP: All 5 Excel input files must be uploaded and validated first. Currently missing: ${inputCheck.missing.join(', ')}.`
      });
    }

    const result = await calculatePJP(periodMonth, cycleCode, { persist: true });

    res.json({
      message: 'PJP Calculation Complete',
      periodMonth,
      cycleCode,
      stats: result.stats,
      validation: {
        valid: result.validation.valid,
        totalErrors: result.validation.totalErrors,
        totalDuplicates: result.validation.totalDuplicates,
        // Only return first 50 errors to avoid huge payloads
        errors: result.validation.errors.slice(0, 50)
      }
    });
  } catch (err) {
    console.error('Error calculating PJP:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Generate PJP + DJP for all roles.
 */
export async function generateAllRolePlans(req, res) {
  try {
    const planMonth = req.body.planMonth || req.body.periodMonth;
    const cycleCode = req.body.cycleCode || 'C1';

    if (!planMonth || typeof planMonth !== 'string') {
      return res.status(400).json({ error: 'planMonth is required. Please specify the planning month in YYYY-MM format.' });
    }
    const match = planMonth.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return res.status(400).json({ error: `Invalid planMonth: '${planMonth}'. Expected format is YYYY-MM.` });
    }
    const mNum = parseInt(match[2], 10);
    if (mNum < 1 || mNum > 12) {
      return res.status(400).json({ error: `Invalid planMonth: '${planMonth}'. Month must be between 01 and 12.` });
    }
    const periodMonth = planMonth;

    // Verify all 5 Excel files are available before calculating
    const inputCheck = await checkAllExcelInputsAvailable();
    if (!inputCheck.allAvailable) {
      return res.status(400).json({
        error: `Cannot generate DJP: All 5 Excel input files must be uploaded and validated first. Currently missing: ${inputCheck.missing.join(', ')}.`
      });
    }

    const result = await generateFullPjpDjpSolution(periodMonth, cycleCode);

    // Auto-generate plans for all roles in the hierarchy
    console.log(`[generateAllRolePlans] Auto-generating sales_plans for all hierarchy levels...`);
    const autoGen = new AutoPlanGenerator();

    const sos = await dbAll('SELECT DISTINCT so_emp_code as emp_code FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ? AND so_emp_code IS NOT NULL AND TRIM(so_emp_code) != ""', [periodMonth, cycleCode]);
    for (const s of sos) await autoGen.generatePlan(s.emp_code, periodMonth, 'SO', cycleCode).catch(e => console.warn(`SO plan gen error [${s.emp_code}]:`, e.message));

    const asms = await dbAll('SELECT DISTINCT asm_code as emp_code FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ? AND asm_code IS NOT NULL AND TRIM(asm_code) != ""', [periodMonth, cycleCode]);
    for (const a of asms) await autoGen.generatePlan(a.emp_code, periodMonth, 'ASM', cycleCode).catch(e => console.warn(`ASM plan gen error [${a.emp_code}]:`, e.message));

    const rsms = await dbAll('SELECT DISTINCT rsm_code as emp_code FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ? AND rsm_code IS NOT NULL AND TRIM(rsm_code) != ""', [periodMonth, cycleCode]);
    for (const r of rsms) await autoGen.generatePlan(r.emp_code, periodMonth, 'RSM', cycleCode).catch(e => console.warn(`RSM plan gen error [${r.emp_code}]:`, e.message));

    const zhs = await dbAll('SELECT DISTINCT zh_code as emp_code FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ? AND zh_code IS NOT NULL AND TRIM(zh_code) != ""', [periodMonth, cycleCode]);
    for (const z of zhs) await autoGen.generatePlan(z.emp_code, periodMonth, 'ZH', cycleCode).catch(e => console.warn(`ZH plan gen error [${z.emp_code}]:`, e.message));

    console.log(`[generateAllRolePlans] Finished auto-generating plans.`);

    res.json({
      message: 'Multi-Role PJP & DJP Solution Generated Successfully, and all Employee Plans were auto-generated.',
      periodMonth,
      cycleCode,
      ...result
    });
  } catch (err) {
    console.error('Error generating multi-role DJP:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get PJP debug trace for a specific dealer.
 */
export async function getPjpDebug(req, res) {
  try {
    const { dealerCode } = req.params;
    const { periodMonth, cycleCode } = req.query;

    if (!dealerCode) {
      return res.status(400).json({ error: 'dealerCode is required' });
    }

    const pm = periodMonth || req.query.planMonth;
    if (!pm || !/^\d{4}-\d{2}$/.test(pm)) {
      return res.status(400).json({ error: 'periodMonth query parameter is required (YYYY-MM)' });
    }
    const cc = cycleCode || 'C1';

    const pjp = await calculatePJP(pm, cc, { persist: false, debug: true });
    const dealer = pjp.results.find(r =>
      r.dealerCode === dealerCode ||
      r.dealerCode === dealerCode.toUpperCase()
    );

    if (!dealer) {
      return res.status(404).json({ error: `Dealer ${dealerCode} not found in PJP results` });
    }

    const trace = generateDealerTrace(dealer);
    res.json({ dealer, trace });
  } catch (err) {
    console.error('Error getting PJP debug:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get dealer visit targets with pagination.
 */
export async function getDealerVisitTargets(req, res) {
  try {
    const { soEmpCode, soName, category, dealerStatus, custType, search, periodMonth, cycleCode, zone, area, limit, offset } = req.query;

    let sql = 'SELECT dvt.*, md.dealer_type FROM dealer_visit_targets dvt LEFT JOIN master_dealers md ON dvt.dealer_id = md.id WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM dealer_visit_targets dvt LEFT JOIN master_dealers md ON dvt.dealer_id = md.id WHERE 1=1';
    const params = [];
    const countParams = [];

    let targetPeriod = periodMonth && periodMonth !== 'ALL' ? periodMonth : null;
    let targetCycle = cycleCode && cycleCode !== 'ALL' ? cycleCode : null;

    // Check if targetPeriod has records, if not fallback to latest period
    if (targetPeriod) {
      const exists = await dbGet('SELECT COUNT(*) as cnt FROM dealer_visit_targets WHERE period_month = ?', [targetPeriod]);
      if (!exists || exists.cnt === 0) {
        const latest = await dbGet('SELECT period_month, cycle_code FROM dealer_visit_targets ORDER BY period_month DESC LIMIT 1');
        if (latest) {
          targetPeriod = latest.period_month;
          if (!targetCycle) targetCycle = latest.cycle_code;
        }
      }
    } else {
      const latest = await dbGet('SELECT period_month, cycle_code FROM dealer_visit_targets ORDER BY period_month DESC LIMIT 1');
      if (latest) {
        targetPeriod = latest.period_month;
        if (!targetCycle) targetCycle = latest.cycle_code;
      }
    }

    if (custType && custType !== 'ALL') {
      if (custType === 'NON-STAR' || custType === 'NON_STAR') {
        sql += " AND (md.dealer_type = 'NON_STAR' OR md.dealer_type = 'NON-STAR')";
        countSql += " AND (md.dealer_type = 'NON_STAR' OR md.dealer_type = 'NON-STAR')";
      } else {
        sql += " AND md.dealer_type = ?";
        countSql += " AND md.dealer_type = ?";
        params.push(custType);
        countParams.push(custType);
      }
    }
    if (targetPeriod) {
      sql += ' AND dvt.period_month = ?';
      countSql += ' AND dvt.period_month = ?';
      params.push(targetPeriod);
      countParams.push(targetPeriod);
    }
    if (targetCycle) {
      sql += ' AND dvt.cycle_code = ?';
      countSql += ' AND dvt.cycle_code = ?';
      params.push(targetCycle);
      countParams.push(targetCycle);
    }
    if (zone && zone !== 'ALL') {
      sql += ' AND dvt.zone = ?';
      countSql += ' AND dvt.zone = ?';
      params.push(zone);
      countParams.push(zone);
    }
    if (area && area !== 'ALL') {
      sql += ' AND dvt.area = ?';
      countSql += ' AND dvt.area = ?';
      params.push(area);
      countParams.push(area);
    }
    if (soEmpCode && soEmpCode !== 'ALL') {
      sql += ' AND dvt.so_emp_code = ?';
      countSql += ' AND dvt.so_emp_code = ?';
      params.push(soEmpCode);
      countParams.push(soEmpCode);
    }
    if (soName && soName !== 'ALL') {
      sql += ' AND dvt.so_name = ?';
      countSql += ' AND dvt.so_name = ?';
      params.push(soName);
      countParams.push(soName);
    }
    if (category && category !== 'ALL') {
      sql += ' AND dvt.category = ?';
      countSql += ' AND dvt.category = ?';
      params.push(category);
      countParams.push(category);
    }
    if (dealerStatus && dealerStatus !== 'ALL') {
      sql += ' AND dvt.dealer_status = ?';
      countSql += ' AND dvt.dealer_status = ?';
      params.push(dealerStatus);
      countParams.push(dealerStatus);
    }
    if (search) {
      sql += ' AND (dvt.dealer_name LIKE ? OR dvt.sap_code LIKE ? OR dvt.area LIKE ? OR dvt.so_name LIKE ? OR dvt.zone LIKE ?)';
      countSql += ' AND (dvt.dealer_name LIKE ? OR dvt.sap_code LIKE ? OR dvt.area LIKE ? OR dvt.so_name LIKE ? OR dvt.zone LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
      countParams.push(s, s, s, s, s);
    }

    sql += ' ORDER BY dvt.category ASC, dvt.dealer_name ASC';

    const pageLimit = parseInt(limit || '50', 10);
    const pageOffset = parseInt(offset || '0', 10);
    sql += ' LIMIT ? OFFSET ?';
    params.push(pageLimit, pageOffset);

    const [targets, countObj] = await Promise.all([
      dbAll(sql, params),
      dbGet(countSql, countParams)
    ]);

    const formattedTargets = targets.map(t => {
      const soVisits = parseFloat(t.so_visits) || 0;
      const asmVisits = parseFloat(t.asm_visits) || 0;
      const rsmVisits = parseFloat(t.rsm_visits) || 0;
      const zhVisits = parseFloat(t.zh_visits) || 0;
      const totalVisits = t.total_visits !== undefined && t.total_visits !== null
        ? parseFloat(t.total_visits)
        : (soVisits + asmVisits + rsmVisits + zhVisits);

      const soVisitsPct = t.so_visits_pct !== undefined && t.so_visits_pct !== null
        ? parseFloat(t.so_visits_pct)
        : (totalVisits > 0 ? Math.round((soVisits / totalVisits) * 10000) / 100 : 0);

      const asmVisitsPct = t.asm_visits_pct !== undefined && t.asm_visits_pct !== null
        ? parseFloat(t.asm_visits_pct)
        : (totalVisits > 0 ? Math.round((asmVisits / totalVisits) * 10000) / 100 : 0);

      const rsmVisitsPct = t.rsm_visits_pct !== undefined && t.rsm_visits_pct !== null
        ? parseFloat(t.rsm_visits_pct)
        : (totalVisits > 0 ? Math.round((rsmVisits / totalVisits) * 10000) / 100 : 0);

      const zhVisitsPct = t.zh_visits_pct !== undefined && t.zh_visits_pct !== null
        ? parseFloat(t.zh_visits_pct)
        : (totalVisits > 0 ? Math.round((zhVisits / totalVisits) * 10000) / 100 : 0);

      return {
        ...t,
        total_visits: totalVisits,
        so_visits_pct: soVisitsPct,
        asm_visits_pct: asmVisitsPct,
        rsm_visits_pct: rsmVisitsPct,
        zh_visits_pct: zhVisitsPct
      };
    });

    res.json({ total: countObj?.total || formattedTargets.length, targets: formattedTargets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getDjpPlan(req, res) {
  try {
    const { roleType, soEmpCode, empCode, periodMonth, cycleCode } = req.query;

    let sql = 'SELECT * FROM djp_recommendations WHERE 1=1';
    const params = [];

    if (roleType) {
      sql += ' AND role_type = ?';
      params.push(roleType);
    }
    if (soEmpCode) {
      sql += ' AND emp_code = ?';
      params.push(soEmpCode);
    }
    if (empCode) {
      sql += ' AND emp_code = ?';
      params.push(empCode);
    }
    if (periodMonth) {
      sql += ' AND period_month = ?';
      params.push(periodMonth);
    }
    if (cycleCode) {
      sql += ' AND cycle_code = ?';
      params.push(cycleCode);
    }

    sql += ' ORDER BY visit_date ASC, visit_sequence ASC';

    const plan = await dbAll(sql, params);
    res.json({ total: plan.length, plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Export the generated PJP_TRADE output as an Excel file with EXACTLY 16 columns.
 */
export async function exportPjpTradeExcel(req, res) {
  try {
    const { periodMonth, cycleCode } = req.query;

    let targetPeriod = periodMonth && periodMonth !== 'ALL' ? periodMonth : null;
    let targetCycle = cycleCode && cycleCode !== 'ALL' ? cycleCode : null;

    if (!targetPeriod) {
      const latest = await dbGet('SELECT period_month, cycle_code FROM dealer_visit_targets WHERE period_month IS NOT NULL ORDER BY period_month DESC LIMIT 1');
      if (latest) {
        targetPeriod = latest.period_month;
        if (!targetCycle) targetCycle = latest.cycle_code || 'C1';
      }
    }

    let sql = `
      SELECT 
        dvt.*,
        dvt.sbg_block,
        dvt.dm_area,
        dvt.cust_type,
        dvt.priority_label,
        md.dealer_type,
        md.block as md_block
      FROM dealer_visit_targets dvt
      LEFT JOIN master_dealers md ON dvt.dealer_id = md.id
      WHERE 1=1
    `;
    const params = [];

    if (targetPeriod) {
      sql += ' AND dvt.period_month = ?';
      params.push(targetPeriod);
    }
    if (targetCycle) {
      sql += ' AND dvt.cycle_code = ?';
      params.push(targetCycle);
    }
    sql += ' ORDER BY dvt.zone ASC, dvt.category ASC, dvt.dealer_name ASC';

    let targets = await dbAll(sql, params);

    // Fallback: If nothing matched specific period/cycle, fetch all available targets
    if (!targets || targets.length === 0) {
      targets = await dbAll(`
        SELECT dvt.*, md.dealer_type, md.block
        FROM dealer_visit_targets dvt
        LEFT JOIN master_dealers md ON dvt.dealer_id = md.id
        ORDER BY dvt.zone ASC, dvt.category ASC, dvt.dealer_name ASC
      `);
    }

    if (!targets || targets.length === 0) {
      return res.status(404).json({ error: 'No PJP_TRADE data found. Please run DJP generation first.' });
    }

    // 2. Map strictly to the 16 requested columns
    const exportData = targets.map(t => {
      // Resolve Cust Type: Title Case ('Dealer' or 'Prospective')
      let rawType = String(t.cust_type || t.dealer_type || 'DEALER').toUpperCase();
      let custType = 'Dealer';
      if (rawType === 'PROSPECTIVE' || rawType === 'PROSPECT') {
        custType = 'Prospective';
      } else if (rawType === 'NON_STAR' || rawType === 'NON-STAR') {
        custType = 'Non-Star';
      }

      // Customer CODE: SAP if available, else SFA, else '-'.
      let custCode = t.sap_code || t.sfa_code || '-';

      // Block: MUST come from sbg_block (SBG authoritative) or prospect block, fallback '-'
      const block = t.sbg_block || t.block || '-';

      // Area: MUST come from dm_area (Dealer Mapping authoritative), fallback '-'
      const area = t.dm_area || t.area || '-';

      // Priority: numeric SO-wise priority rank (matching reference output)
      const priority = t.priority !== null && t.priority !== undefined ? Number(t.priority) : 1;

      const soVisits = parseFloat(t.so_visits) || 0;
      const asmVisits = parseFloat(t.asm_visits) || 0;
      const rsmVisits = parseFloat(t.rsm_visits) || 0;
      const zhVisits = parseFloat(t.zh_visits) || 0;

      return {
        'Zone': t.zone || '-',
        'Cust Type': custType,
        'Area': area,
        'Block': block,
        'ZONAL HEAD': t.zh_name || '-',
        'RSM': t.rsm_name || '-',
        'ASM': t.asm_name || '-',
        'SO/SE NAME': t.so_name || '-',
        'DEALER NAME': t.dealer_name || '-',
        'Customer CODE': custCode,
        'Priority': priority,
        'Category': t.dealer_status || '-',
        'No. of visits by SO': soVisits,
        'No. of visits by ASM': asmVisits,
        'Number of Visit by RSM': rsmVisits,
        'Number of Visit by ZH': zhVisits
      };
    });

    // 3. Create Workbook and Worksheet
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'PJP_TRADE');

    // 4. Generate buffer
    const buf = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // 5. Send as download
    const filename = `PJP_TRADE_${targetPeriod || '2026-06'}_${targetCycle || 'C1'}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);

  } catch (err) {
    console.error('Error exporting PJP_TRADE:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Export Master Report matching M_SAMPLE_EXPECTED.xlsx exactly (22 columns, sheet 'Report')
 */
export async function exportMasterExcel(req, res) {
  try {
    const { periodMonth, cycleCode } = req.query;
    let targetPeriod = periodMonth && periodMonth !== 'ALL' ? periodMonth : null;
    let targetCycle  = cycleCode && cycleCode !== 'ALL' ? cycleCode : 'C1';

    if (!targetPeriod) {
      const latest = await dbGet(
        `SELECT period_month, cycle_code FROM dealer_visit_targets
          WHERE period_month IS NOT NULL ORDER BY period_month DESC LIMIT 1`);
      if (latest) {
        targetPeriod = latest.period_month;
        if (latest.cycle_code) targetCycle = latest.cycle_code;
      } else {
        targetPeriod = '2026-06';
      }
    }

    let targets = await dbAll(
      `SELECT * FROM dealer_visit_targets
        WHERE period_month = ? AND cycle_code = ?
        ORDER BY sap_code ASC, id ASC`, [targetPeriod, targetCycle]);

    if (!targets || targets.length === 0) {
      targets = await dbAll(
        `SELECT * FROM dealer_visit_targets WHERE period_month = ? ORDER BY sap_code ASC, id ASC`,
        [targetPeriod]);
    }

    if (!targets || targets.length === 0) {
      return res.status(400).json({
        error: `No PJP Master data found for period ${targetPeriod}. Please upload all 5 Excel files and click 'Generate DJP Plans' first.`
      });
    }

    const buf = await buildMasterWorkbook(dedupeTargets(targets), targetPeriod);

    const filename = `M_${targetPeriod}_${targetCycle}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('Error exporting Master report:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Write the Master workbook so it opens looking like the client's own M.xlsx.
 *
 * Layout, transcribed from M.xlsx -> sheet `Master ` (trailing space is real):
 *   row 1   blank
 *   row 2   B2 = planning anchor, a real date  (M.xlsx: 46174 = 2026-06-01)
 *   row 3   source-of-truth annotations
 *   row 4   headers, frozen
 *   row 5+  data
 *
 * Written with ExcelJS rather than SheetJS because the community build of SheetJS
 * cannot write fonts, fills or borders — and without those this is a spreadsheet that
 * merely contains the right values rather than one that looks like the client's.
 *
 * Exported for the verification test, which reads the bytes back and compares them
 * against the real M.xlsx.
 */
export async function buildMasterWorkbook(uniqueTargets, targetPeriod) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Star Cement PJP/DJP';
  wb.created = new Date();

  const ws = wb.addWorksheet(MASTER_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }]     // freeze through the header row
  });

  ws.columns = MASTER_COLUMNS.map(c => ({
    width: c.width,
    hidden: !!c.hidden,
    style: c.fmt ? { numFmt: c.fmt } : undefined
  }));

  // ── row 1: blank ──────────────────────────────────────────────────────────
  ws.getRow(1).height = 15;

  // ── row 2: the planning anchor in B2 ──────────────────────────────────────
  const anchor = anchorDate(targetPeriod);
  if (anchor) {
    const b2 = ws.getCell('B2');
    b2.value  = anchor;
    b2.numFmt = '[$-409]dd-mmm-yy';
    b2.font   = { bold: true, size: 11 };
    b2.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  // ── row 3: source annotations ─────────────────────────────────────────────
  const sourceRow = ws.getRow(3);
  buildSources().forEach((src, i) => {
    if (!src) return;
    const cell = sourceRow.getCell(i + 1);
    cell.value = src;
    cell.font  = { italic: true, size: 9, color: { argb: 'FF7F7F7F' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  sourceRow.height = 22;

  // ── row 4: headers ────────────────────────────────────────────────────────
  const headerRow = ws.getRow(HEADER_ROW);
  buildHeaders(targetPeriod).forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font  = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top:    { style: 'thin', color: { argb: 'FF17375E' } },
      left:   { style: 'thin', color: { argb: 'FF17375E' } },
      bottom: { style: 'thin', color: { argb: 'FF17375E' } },
      right:  { style: 'thin', color: { argb: 'FF17375E' } }
    };
  });
  headerRow.height = 58;   // the header text wraps to three lines in places

  // ── row 5+: data ──────────────────────────────────────────────────────────
  const EDGE = { style: 'thin', color: { argb: 'FFD9D9D9' } };
  uniqueTargets.forEach((t, idx) => {
    const values = rowToArray(buildRow(t, idx));
    const row = ws.getRow(FIRST_DATA_ROW + idx);
    values.forEach((v, i) => {
      const def  = MASTER_COLUMNS[i];
      const cell = row.getCell(i + 1);
      cell.value = v;                                  // real numbers and real Dates
      if (def.fmt) cell.numFmt = def.fmt;
      cell.alignment = { horizontal: def.align || 'left', vertical: 'middle' };
      cell.border = { top: EDGE, left: EDGE, bottom: EDGE, right: EDGE };
      cell.font = { size: 10 };
    });
  });

  // Autofilter over the header row, so the sheet is usable the moment it opens.
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to:   { row: HEADER_ROW + uniqueTargets.length, column: MASTER_COLUMNS.length }
  };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled visits — the diary behind the visit counts
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_ORDER = { SO: 0, ASM: 1, RSM: 2, ZH: 3 };
const normCode = v => String(v ?? '').trim().toUpperCase();
const isoDay   = v => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

/**
 * Every visit put in a diary for this period and cycle, indexed by dealer code.
 *
 * Plans of all statuses are read. An officer whose plan is still DRAFT has real dates
 * in it, and leaving them out would make the file look emptier than the plan actually
 * is; the status travels with each visit instead, so the reader can tell.
 *
 * @returns {Promise<{byDealer: Map<string, Array>, all: Array}>}
 */
async function loadScheduledVisits(periodMonth, cycleCode) {
  let rows = [];
  try {
    rows = await dbAll(
      `SELECT d.visit_date, d.dealer_sap_code, d.dealer_name, d.sequence, d.purpose_of_visit,
              p.emp_code, p.emp_name, p.emp_role, p.status, p.cycle_code
         FROM sales_plan_details d
         JOIN sales_plans p ON p.id = d.plan_id
        WHERE p.period_month = ? AND p.cycle_code = ?
        ORDER BY d.visit_date ASC, p.emp_code ASC, d.sequence ASC`,
      [periodMonth, cycleCode]
    );
  } catch (e) {
    // emp_role arrives with migrate-app-plan-workflow.js. Without it the plans are
    // still readable — the role is simply unknown, and every visit lands under SO.
    console.warn('[exportVisits] full plan read failed, falling back:', e.message);
    rows = await dbAll(
      `SELECT d.visit_date, d.dealer_sap_code, d.dealer_name, d.sequence, d.purpose_of_visit,
              p.emp_code, p.emp_name, p.status, p.cycle_code
         FROM sales_plan_details d
         JOIN sales_plans p ON p.id = d.plan_id
        WHERE p.period_month = ? AND p.cycle_code = ?
        ORDER BY d.visit_date ASC, p.emp_code ASC, d.sequence ASC`,
      [periodMonth, cycleCode]
    ).catch(() => []);
  }

  const all = rows.map(r => ({
    date: isoDay(r.visit_date),
    code: normCode(r.dealer_sap_code),
    dealerName: r.dealer_name || '',
    empCode: r.emp_code || '',
    empName: r.emp_name || '',
    role: String(r.emp_role || 'SO').toUpperCase(),
    status: r.status || '',
    cycle: r.cycle_code || cycleCode,
    purpose: r.purpose_of_visit || ''
  }));

  const byDealer = new Map();
  for (const v of all) {
    if (!v.code) continue;
    if (!byDealer.has(v.code)) byDealer.set(v.code, []);
    byDealer.get(v.code).push(v);
  }
  return { byDealer, all };
}

/** Visits scheduled against this target, under either of its codes. */
function visitsForTarget(scheduled, t) {
  const seen = new Set();
  const out = [];
  for (const code of [normCode(t.sap_code), normCode(t.sfa_code)]) {
    if (!code) continue;
    for (const v of scheduled.byDealer.get(code) || []) {
      const key = `${v.date}|${v.empCode}`;
      if (seen.has(key)) continue;       // same visit reachable by both codes
      seen.add(key);
      out.push(v);
    }
  }
  return out.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    ((ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)));
}

/** The client's Cust Type vocabulary: DEALER, NON STAR, Prospective. */
function custTypeLabel(raw) {
  const v = String(raw || 'DEALER').toUpperCase();
  if (v === 'NON_STAR' || v === 'NON-STAR' || v === 'NON STAR') return 'NON STAR';
  if (v === 'PROSPECTIVE') return 'Prospective';
  if (v === 'STAR') return 'DEALER';
  return raw || 'DEALER';
}

/** The minimum number of "Date of Visit" columns the sheet always carries. */
export const MIN_VISIT_DATE_COLUMNS = 5;

/**
 * Every distinct day this dealer is scheduled to be visited, by ANY role, earliest
 * first. Not just the SO's: a dealer owed 3 SO visits, 3 ASM and 2 RSM has more days
 * than one role's worth, and hiding the rest would make the sheet under-report its
 * own plan. Sheet 2 says who each day belongs to.
 */
function visitDatesFor(scheduled, t) {
  const days = visitsForTarget(scheduled, t).map(v => v.date).filter(Boolean);
  return [...new Set(days)].sort();
}

/** How every date in this workbook is displayed. */
export const VISIT_DATE_FORMAT = 'dd-mm-yyyy';

/**
 * An ISO day as a REAL Excel date, built at UTC midnight.
 *
 * Written as a date rather than as "05-06-2026" text so the column sorts and filters
 * as a date in Excel. ExcelJS converts with `25569 + d.getTime() / 86400000` — pure
 * UTC, no local offset — so a UTC-midnight date lands on a whole serial and cannot
 * slip a day for a reader in another timezone. The display format is applied to the
 * column, so what the client sees is DD-MM-YYYY.
 */
function toExcelDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

/** Pad (or extend) a dealer's dates to exactly `width` date cells. */
function padDates(dates, width) {
  const out = new Array(width).fill(null);
  for (let i = 0; i < dates.length && i < width; i++) out[i] = toExcelDate(dates[i]);
  return out;
}

/**
 * Write the Visits workbook.
 *
 *   Sheet 'Visits'          the client's format, unchanged: row 1 blank, row 2 headers,
 *                           row 3+ data, with the three date columns now filled.
 *   Sheet 'SFA Report'      one row per visit — every role, every officer, every day —
 *                           in the client's own SFA Report columns, ready to be filled
 *                           in and uploaded back as the execution log.
 *
 * ExcelJS rather than SheetJS so the dates carry a real date format and the columns
 * come out readable instead of needing to be widened by hand.
 */
async function buildVisitsWorkbook({ headers, rows, scheduled, targets, targetPeriod, targetCycle }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Star Cement PJP/DJP';
  wb.created = new Date();

  // ── Sheet 1 — the client's sheet ───────────────────────────────────────────
  const ws = wb.addWorksheet('Visits', { views: [{ state: 'frozen', ySplit: 2 }] });
  const FIXED_WIDTHS = [12, 11, 18, 16, 20, 20, 22, 22, 30, 15, 9, 14, 9, 9, 9, 9];
  const dateColumns = headers.length - FIXED_WIDTHS.length;
  ws.columns = [...FIXED_WIDTHS, ...new Array(dateColumns).fill(14)].map(w => ({ width: w }));

  ws.addRow(new Array(headers.length).fill(null));
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', wrapText: true };
  for (const r of rows) ws.addRow(r);

  // The trailing columns hold real dates, shown as DD-MM-YYYY and centred so a run of
  // them scans as a row of days.
  for (let c = FIXED_WIDTHS.length + 1; c <= headers.length; c++) {
    ws.getColumn(c).numFmt = VISIT_DATE_FORMAT;
    ws.getColumn(c).alignment = { horizontal: 'center' };
  }

  // ── Sheet 2 — the diary, in the client's own SFA Report format ─────────────
  //
  // Same sheet name and same 14 columns as the SFA Report they upload, in the same
  // order, so the planned visits and the executed ones can be read side by side — and
  // so this sheet can be handed to the field team as the form to fill in and send
  // back. The importer reads by header name, so a filled copy of this sheet uploads
  // as an SFA report with no reshaping.
  //
  // Check In Time, Check Out Time, Duration and Visit Status are deliberately EMPTY:
  // a planned visit has not happened yet, and inventing a time would turn a plan into
  // a fake execution record.
  const sched = wb.addWorksheet('SFA Report', { views: [{ state: 'frozen', ySplit: 1 }] });
  sched.columns = [
    { header: 'Date of Visit',   key: 'date',     width: 14, style: { numFmt: VISIT_DATE_FORMAT } },
    { header: 'Customer Code',   key: 'code',     width: 15 },
    { header: 'Customer Name',   key: 'cname',    width: 32 },
    { header: 'Type',            key: 'ctype',    width: 12 },
    { header: 'Route',           key: 'route',    width: 16 },
    { header: 'Branch',          key: 'branch',   width: 16 },
    { header: 'Employee Code',   key: 'emp',      width: 14 },
    { header: 'Employee Name',   key: 'ename',    width: 26 },
    { header: 'Check In Time',   key: 'cin',      width: 14 },
    { header: 'Check Out Time',  key: 'cout',     width: 14 },
    { header: 'Duration',        key: 'duration', width: 13 },
    { header: 'Visit Status(Productive / Non productive)', key: 'vstatus', width: 34 },
    { header: 'Purpose Of Visit', key: 'purpose', width: 26 },
    { header: 'Remarks',         key: 'remarks',  width: 22 }
  ];
  sched.getRow(1).font = { bold: true };
  sched.getRow(1).alignment = { vertical: 'middle', wrapText: true };

  // Look up each visit's dealer in the targets, so the sheet carries the customer type
  // and branch the SFA report expects rather than a bare name.
  const byCode = new Map();
  for (const t of targets) {
    for (const code of [normCode(t.sap_code), normCode(t.sfa_code)]) {
      if (code && !byCode.has(code)) byCode.set(code, t);
    }
  }

  const ordered = [...scheduled.all].sort((a, b) =>
    a.date.localeCompare(b.date) ||
    ((ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)) ||
    String(a.empName).localeCompare(String(b.empName)) ||
    String(a.dealerName).localeCompare(String(b.dealerName)));

  for (const v of ordered) {
    const t = byCode.get(v.code) || {};
    sched.addRow({
      date:    toExcelDate(v.date),
      code:    t.sfa_code || t.sap_code || v.code,
      cname:   v.dealerName || t.dealer_name || '',
      ctype:   custTypeLabel(t.cust_type),
      route:   t.territory_name || t.dm_area || t.area || '',
      branch:  t.branch || t.sbg_block || t.block || '',
      emp:     v.empCode,
      ename:   v.empName || v.empCode,
      cin:     null,
      cout:    null,
      duration: null,
      vstatus: null,
      purpose: v.purpose || 'Routine Visit',
      remarks: null
    });
  }

  if (ordered.length === 0) {
    sched.addRow({ date: null, cname: `No visits are scheduled for ${targetPeriod} ${targetCycle}. ` +
                                      `Run Generate Plans for this cycle.` });
  }

  return wb.xlsx.writeBuffer();
}

/**
 * Export Visits Report matching visits-To Be Achieved.xlsx reference format.
 * 
 * Reference format (verified from actual visits-To Be Achieved.xlsx):
 *   Sheet name: 'Visits'
 *   Row 1: blank
 *   Row 2: headers
 *   Row 3+: data
 * 
 * Columns (16 fixed + 5 or more date columns):
 *   Zone | Cust Type | Area | Block | ZONAL HEAD | RSM | ASM | SO/SE  NAME |
 *   DEALER NAME | Customer CODE (= SFA CODE) | Priority (numeric SO-wise rank) | Category |
 *   No. of visits by SO | No. of visits by ASM | Number of Visit by RSM | Number of Visit by ZH |
 *   Date of Visit 1 … Date of Visit 5  (more if any dealer needs them)
 * 
 * Rules:
 *   - Churn dealers EXCLUDED (no visits assigned)
 *   - Customer CODE = SFA CODE (not SAP code)
 *   - Priority = numeric priorityRank (SO-wise rank, e.g. 1, 2, 3...)
 *
 * THE DATES
 * ---------
 * "No. of visits by SO" is what the PJP engine decided is OWED. The dates are what
 * the DJP scheduler actually put in a diary — they live in sales_plan_details, one
 * row per officer per dealer per day. This export reads them rather than leaving the
 * three date columns blank, which is all it used to do.
 *
 * The date columns carry EVERY day the dealer is scheduled to be visited, by any role,
 * earliest first — SO, ASM, RSM and ZH together, one column per distinct day. Five
 * columns as standard; if a dealer somewhere in the cycle needs more, the sheet widens
 * for everyone rather than truncating him, because a row that silently drops a day
 * looks complete and is not. WHICH officer each day belongs to is on sheet 2, which
 * carries one row per visit in the client's own 'SFA Report' format.
 *
 * Plans of EVERY status are included (DRAFT, SUBMITTED, RECTIFY, APPROVED) and each
 * row carries its plan's status, so an unapproved plan is visible rather than missing.
 */
export async function exportVisitsExcel(req, res) {
  try {
    const { periodMonth, cycleCode } = req.query;
    let targetPeriod = periodMonth && periodMonth !== 'ALL' ? periodMonth : null;
    let targetCycle = cycleCode && cycleCode !== 'ALL' ? cycleCode : 'C1';

    if (!targetPeriod) {
      const latest = await dbGet('SELECT period_month, cycle_code FROM dealer_visit_targets WHERE period_month IS NOT NULL ORDER BY period_month DESC LIMIT 1');
      if (latest) {
        targetPeriod = latest.period_month;
        if (latest.cycle_code) targetCycle = latest.cycle_code;
      } else {
        targetPeriod = '2026-06';
      }
    }

    let targets = await dbAll(
      'SELECT * FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ? ORDER BY zone ASC, area ASC, so_name ASC, dealer_name ASC',
      [targetPeriod, targetCycle]
    );

    if (!targets || targets.length === 0) {
      targets = await dbAll(
        'SELECT * FROM dealer_visit_targets WHERE period_month = ? ORDER BY zone ASC, area ASC, so_name ASC, dealer_name ASC',
        [targetPeriod]
      );
    }

    if (!targets || targets.length === 0) {
      return res.status(400).json({ error: `No PJP Visits data found for period ${targetPeriod}. Please upload all 5 Excel files and click 'Generate DJP Plans' first.` });
    }

    const uniqueTargetsMap = new Map();
    for (const t of targets) {
      const code = t.sfa_code || t.sap_code;
      if (code) uniqueTargetsMap.set(code, t);
    }
    const uniqueTargets = [...uniqueTargetsMap.values()];

    // What was actually scheduled. sales_plan_details.dealer_sap_code holds whichever
    // code identified the dealer when the visit was created — a SAP code normally, an
    // SFA code for a prospect (prospects have no SAP code) — so index by both.
    const scheduled = await loadScheduledVisits(targetPeriod, targetCycle);

    // 'concat' was the client's own helper column — a formula key they used to VLOOKUP
    // between their workbooks. It is always empty here, so it is not written.
    const FIXED_HEADERS = [
      'Zone', 'Cust Type', 'Area', 'Block', 'ZONAL HEAD', 'RSM', 'ASM', 'SO/SE  NAME',
      'DEALER NAME', 'Customer CODE', 'Priority', 'Category',
      'No. of visits by SO', 'No. of visits by ASM', 'Number of Visit by RSM', 'Number of Visit by ZH'
    ];

    // Five date columns as standard. If any dealer in this cycle is scheduled on more
    // than five days, the sheet widens to fit him rather than dropping the rest —
    // "Date of Visit 6", "7", and so on. A truncated schedule is worse than a wide
    // sheet, because nothing on the row says anything is missing.
    const widest = uniqueTargets.reduce(
      (m, t) => Math.max(m, visitDatesFor(scheduled, t).length), 0);
    const DATE_COLUMNS = Math.max(MIN_VISIT_DATE_COLUMNS, widest);
    const VISIT_HEADERS = [
      ...FIXED_HEADERS,
      ...Array.from({ length: DATE_COLUMNS }, (_, i) => `Date of Visit ${i + 1}`)
    ];

    const reportRows = [];

    for (const t of uniqueTargets) {
      const dealerStatus = t.dealer_status || '';
      if (dealerStatus === 'Churn') continue;

      const soVisits = parseFloat(t.so_visits) || 0;
      const asmVisits = parseFloat(t.asm_visits) || 0;
      const rsmVisits = parseFloat(t.rsm_visits) || 0;
      const zhVisits = parseFloat(t.zh_visits) || 0;

      if (soVisits === 0 && asmVisits === 0 && rsmVisits === 0 && zhVisits === 0) continue;

      const customerCode = t.sfa_code || t.sap_code || '';

      const custType = custTypeLabel(t.cust_type);

      const priority = t.priority || 0;

      reportRows.push([
        t.zone || '',
        custType,
        t.dm_area || t.area || '',
        t.sbg_block || t.block || '',
        t.zh_name || '',
        t.rsm_name || '',
        t.asm_name || '',
        t.so_name || '',
        t.dealer_name || '',
        customerCode,
        priority,
        dealerStatus,
        soVisits,
        asmVisits,
        rsmVisits,
        zhVisits,
        ...padDates(visitDatesFor(scheduled, t), DATE_COLUMNS)
      ]);
    }

    const exportBuf = await buildVisitsWorkbook({
      headers: VISIT_HEADERS,
      rows: reportRows,
      scheduled,
      targets: uniqueTargets,
      targetPeriod,
      targetCycle
    });
    const visitsFilename = `visits-To_Be_Achieved_${targetPeriod}_${targetCycle}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${visitsFilename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(exportBuf);
  } catch (err) {
    console.error('Error exporting Visits report:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Return internal multi-source reconciliation report and diagnostics
 */
export async function getReconciliationDiagnostics(req, res) {
  try {
    const reportMonth = req.query.periodMonth || '2026-06';
    const cycleCode = req.query.cycleCode || 'C1';
    const result = await reconcileUniverse({ reportMonth, cycleCode });
    res.json(result);
  } catch (err) {
    console.error('Error getting reconciliation:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Check readiness of all 5 required Excel input documents.
 */
export async function getInputReadiness(req, res) {
  try {
    const status = await checkAllExcelInputsAvailable();
    res.json(status);
  } catch (err) {
    console.error('Error getting input readiness:', err);
    res.status(500).json({ error: err.message });
  }
}


/**
 * The Master sheet as JSON, for the on-screen view.
 * GET /api/djp/master-view?periodMonth=YYYY-MM&cycleCode=C1&page=1&pageSize=100
 *
 * Same 42 columns, same order, same values as the Excel download — both are built from
 * masterSheet.service.js, so the screen and the file cannot disagree.
 *
 * Paged, because the real master runs to ~12,600 rows and shipping that in one response
 * would stall the browser. `search` filters on dealer name, either code, area or SO.
 */
export async function getMasterView(req, res) {
  try {
    const { periodMonth, cycleCode, search } = req.query;
    const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(500, Math.max(10, parseInt(req.query.pageSize, 10) || 100));

    let targetPeriod = periodMonth && periodMonth !== 'ALL' ? periodMonth : null;
    let targetCycle  = cycleCode && cycleCode !== 'ALL' ? cycleCode : 'C1';

    if (!targetPeriod) {
      const latest = await dbGet(
        `SELECT period_month, cycle_code FROM dealer_visit_targets
          WHERE period_month IS NOT NULL ORDER BY period_month DESC LIMIT 1`);
      if (!latest) {
        return res.status(400).json({
          error: 'No PJP Master data yet.',
          fix: "Upload the input files and click Generate Plans first."
        });
      }
      targetPeriod = latest.period_month;
      if (latest.cycle_code) targetCycle = latest.cycle_code;
    }

    let targets = await dbAll(
      `SELECT * FROM dealer_visit_targets
        WHERE period_month = ? AND cycle_code = ?
        ORDER BY sap_code ASC, id ASC`, [targetPeriod, targetCycle]);

    if (!targets || targets.length === 0) {
      targets = await dbAll(
        `SELECT * FROM dealer_visit_targets WHERE period_month = ? ORDER BY sap_code ASC, id ASC`,
        [targetPeriod]);
    }

    if (!targets || targets.length === 0) {
      return res.status(400).json({
        error: `No Master data for ${targetPeriod}.`,
        fix: "Upload the input files and click Generate Plans for this month."
      });
    }

    // Build every row first — Sl.No. must number the whole sheet, not the page.
    const all = dedupeTargets(targets).map((t, i) => buildRow(t, i));

    const q = String(search || '').trim().toLowerCase();
    const filtered = q
      ? all.filter(r =>
          String(r.dealer_name).toLowerCase().includes(q) ||
          String(r.customer_code).toLowerCase().includes(q) ||
          String(r.sfa_code).toLowerCase().includes(q) ||
          String(r.area).toLowerCase().includes(q) ||
          String(r.so_name).toLowerCase().includes(q))
      : all;

    const start = (page - 1) * pageSize;
    const rows  = filtered.slice(start, start + pageSize).map(r => {
      // Dates cross JSON as YYYY-MM-DD; the view formats them for display.
      const out = { ...r };
      // A real DOA crosses as YYYY-MM-DD; a prospect's marker ("NEW") is text and must
      // survive as text — nulling it would blank the cell the master fills in.
      out.doa = r.doa instanceof Date ? r.doa.toISOString().slice(0, 10)
              : (r.doa ? String(r.doa) : null);
      return out;
    });

    res.json({
      period_month: targetPeriod,
      cycle_code: targetCycle,
      sheet_name: MASTER_SHEET_NAME,
      header_row: HEADER_ROW,
      first_data_row: FIRST_DATA_ROW,
      anchor: anchorDate(targetPeriod)?.toISOString().slice(0, 10) || null,
      columns: MASTER_COLUMNS.map((c, i) => ({
        col: c.col, key: c.key, header: buildHeaders(targetPeriod)[i],
        source: c.source, align: c.align || 'left', fmt: c.fmt,
        hidden: !!c.hidden, width: c.width
      })),
      total: filtered.length,
      total_unfiltered: all.length,
      page, page_size: pageSize,
      pages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      rows
    });
  } catch (err) {
    console.error('Error building Master view:', err);
    res.status(500).json({ error: err.message });
  }
}

export async function exportSfaLogsExcel(req, res) {
  try {
    const rows = await dbAll(`
      SELECT 
        v.visit_date, 
        v.customer_code AS sfa_code, 
        d.sap_code AS mapped_sap_code, 
        v.customer_name, 
        v.customer_type, 
        v.route, 
        v.branch, 
        v.employee_code, 
        v.employee_name, 
        v.check_in_time, 
        v.check_out_time, 
        v.duration, 
        v.visit_status, 
        v.purpose_of_visit, 
        v.remarks 
      FROM visit_execution_logs v
      LEFT JOIN master_dealers d ON d.sfa_code = v.customer_code
      ORDER BY v.visit_date DESC LIMIT 50000
    `);
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(rows.map(r => ({
      'Date of Visit': r.visit_date,
      'SFA Customer Code': r.sfa_code,
      'Mapped SAP Code': r.mapped_sap_code || 'Unmapped',
      'Customer Name': r.customer_name,
      'Type': r.customer_type,
      'Route': r.route,
      'Branch': r.branch,
      'Employee Code': r.employee_code,
      'Employee Name': r.employee_name,
      'Check In Time': r.check_in_time,
      'Check Out Time': r.check_out_time,
      'Duration': r.duration,
      'Visit Status': r.visit_status,
      'Purpose Of Visit': r.purpose_of_visit,
      'Remarks': r.remarks
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'SFA Logs');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="SFA_Logs_Export_Mapped.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Error exporting SFA Logs:', err);
    res.status(500).json({ error: 'Failed to export SFA Logs' });
  }
}
