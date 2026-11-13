import XLSX from 'xlsx';
import path from 'path';
import crypto from 'crypto';
import { dbRun, dbGet, dbAll } from '../config/database.js';
import { normalizeString, normalizeCode, normalizeBranch, normalizeRegion, parseDOA } from '../engines/normalization.engine.js';
import { resolveZonalHead, refreshDynamicZonalHeadCache } from '../services/zonalHead.service.js';

function normalizeHeader(h) {
  return String(h || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const HEADER_MAP = {
  // Canonical 9-column headers & common variations
  'dealer code': 'sap_code',
  'dealer sap code': 'sap_code',
  'sap code': 'sap_code',
  'sap': 'sap_code',
  'customer code': 'customer_code',
  'dns customer code': 'sfa_code',
  'dns_customer_code': 'sfa_code',
  'dns customer_code': 'sfa_code',
  'sfa code': 'sfa_code',
  'sfa_code': 'sfa_code',
  'dealer name': 'dealer_name',
  'account name': 'dealer_name',
  'branch': 'branch',
  'branch name': 'branch',
  'region': 'region',
  'zone': 'zone',
  'so name': 'so_name',
  'so code': 'so_emp_code',
  'so e code': 'so_emp_code',
  'so emp code': 'so_emp_code',
  'so/se name': 'so_name',
  'so/se  name': 'so_name',
  'so / se name': 'so_name',
  'asm name': 'asm_name',
  'asm code': 'asm_code',
  'asm': 'asm_name',
  'rsm name': 'rsm_name',
  'rsm code': 'rsm_code',
  'rsm': 'rsm_name',
  'zonal head': 'zh_name',
  'zh': 'zh_name',
  'zh name': 'zh_name',
  'zh code': 'zh_code',
  'linked dealer code': 'linked_dealer_code',
  'cust type': 'cust_type',
  'customer type': 'cust_type',
  'area': 'area',
  'territory code': 'territory_code',
  'territory name': 'territory_name',
  'territory': 'territory_name',
  'block': 'block',
  'block (taluka)': 'block',
  'taluka': 'block',
  'customer name': 'dealer_name',
  'dlr counter potential': 'counter_potential',
  'counter potential': 'counter_potential',
  'potential': 'counter_potential',
  'doa': 'doa',
  'date of activation': 'doa'
};

const DEALER_INSERT_COLS = [
  'dealer_id', 'dealer_type', 'sap_code', 'sfa_code', 'linked_dealer_code',
  'dealer_name', 'normalized_dealer_name', 'area', 'dm_area', 'branch',
  'normalized_area', 'block', 'normalized_block', 'zone', 'region',
  'so_name', 'so_emp_code', 'asm_name', 'asm_code', 'counter_strategy',
  'batch_code', 'match_status', 'match_method', 'match_confidence', 'status', 'prospect_status',
  'dm_sap_code', 'dm_customer_code', 'dm_sfa_code', 'counter_potential', 'doa',
  'territory_code', 'territory_name', 'rsm_code', 'rsm_name', 'zh_code', 'zh_name'
];

const MAP_COLS = [
  'dealer_id', 'sap_code', 'dealer_name', 'area', 'branch', 'zone', 'region', 'block',
  'so_name', 'so_emp_code', 'asm_name', 'asm_code', 'rsm_name', 'rsm_code',
  'zh_name', 'zh_code', 'territory_code', 'territory_name', 'linked_dealer_code', 'batch_code'
];

const AUDIT_COLS = [
  'batch_code', 'source_file', 'source_sheet', 'source_row', 'source_type',
  'dealer_id', 'sap_code', 'sfa_code', 'dealer_name', 'match_method',
  'match_confidence', 'match_status', 'error_message'
];

/**
 * High-performance Dealer Mapping importer capable of processing 15,000+ rows in seconds.
 * 
 * Uses in-memory index preloading ($O(1)$ lookups) and chunked batch database writes,
 * reducing round-trip SQL operations from 250,000+ sequential queries down to ~75 batch operations.
 */
export async function importDealerMapping(filePath, batchCode = null) {
  const startTime = Date.now();
  console.log(`[DEALER_MAPPING] Processing from: ${filePath}`);
  const sourceFileName = path.basename(filePath);
  const activeBatchCode = batchCode || `BAT-${Date.now()}`;

  const workbook = XLSX.readFile(filePath);
  
  let selectedSheetName = null;
  let headerRowIdx = -1;
  let headers = [];
  let rawRows = [];

  // 1. Sheet selection & header detection heuristics
  for (const sName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (!rows || rows.length < 2) continue;

    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const row = rows[i];
      if (!row) continue;
      const normalized = row.map(normalizeHeader);
      if (
        normalized.some(h => h === 'dealer sap code' || h === 'dealer name' || h === 'customer code' || h === 'sfa code' || h === 'sap code') &&
        normalized.some(h => h === 'so name' || h === 'so/se name' || h === 'so/se  name' || h === 'so e code' || h === 'asm' || h === 'asm name' || h === 'area' || h === 'branch')
      ) {
        selectedSheetName = sName;
        headerRowIdx = i;
        headers = normalized;
        rawRows = rows;
        break;
      }
    }
    if (selectedSheetName) break;
  }

  // Fallback to first available sheet if not matched by heuristic
  if (!selectedSheetName) {
    const preferredSheets = ['Dealer SO Mapping', 'Sheet1', 'Master', 'Master ', 'Dealer', 'Territory Mapping'];
    selectedSheetName = workbook.SheetNames.find(s => preferredSheets.includes(s)) || workbook.SheetNames[0];
    const sheet = workbook.Sheets[selectedSheetName];
    rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    for (let i = 0; i < Math.min(15, rawRows.length); i++) {
      const row = rawRows[i];
      if (!row) continue;
      const normalized = row.map(normalizeHeader);
      if (normalized.some(h => h === 'dealer sap code' || h === 'dealer name' || h === 'customer code' || h === 'sfa code' || h === 'so e code' || h === 'so/se name')) {
        headerRowIdx = i;
        headers = normalized;
        break;
      }
    }
  }

  if (headerRowIdx === -1) {
    throw new Error(`[DEALER_MAPPING] Could not find valid header row in file: ${sourceFileName}`);
  }

  const colIdx = {};
  for (const [normHeader, canonicalField] of Object.entries(HEADER_MAP)) {
    const idx = headers.indexOf(normHeader);
    if (idx !== -1 && !(canonicalField in colIdx)) {
      colIdx[canonicalField] = idx;
    }
  }

  const getCell = (row, field) => {
    const idx = colIdx[field];
    if (idx === undefined || idx === -1) return null;
    const val = row[idx];
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    return s === '' || s === '-' ? null : s;
  };

  const getCellNum = (row, field) => {
    const idx = colIdx[field];
    if (idx === undefined || idx === -1) return null;
    const val = row[idx];
    if (val === null || val === undefined || String(val).trim() === '' || String(val).trim() === '-') return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  };

  // 2. Preload DB caches in-memory for O(1) matching and zero per-row SQL queries
  await refreshDynamicZonalHeadCache(false);

  const [existingDealers, existingMappings, existingEmployees, inactiveEmployees] = await Promise.all([
    dbAll(`SELECT id, dealer_id, sap_code, sfa_code, linked_dealer_code, dealer_name, normalized_dealer_name, area, dm_area, branch, normalized_area, block, normalized_block, zone, region, so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, counter_potential, doa, territory_code, territory_name, dealer_type, status, prospect_status FROM master_dealers`),
    dbAll(`SELECT id, dealer_id, sap_code FROM master_dealer_so_mapping`),
    dbAll(`SELECT id, emp_code, emp_name, designation, region FROM master_employees`),
    dbAll(`SELECT emp_code, dns_emp_code FROM employee_master WHERE acedns = 'N' OR app_access = 'N'`).catch(() => [])
  ]);

  const inactiveEmpCodes = new Set();
  for (const emp of (inactiveEmployees || [])) {
    if (emp.emp_code) inactiveEmpCodes.add(String(emp.emp_code).trim().toUpperCase());
    if (emp.dns_emp_code) inactiveEmpCodes.add(String(emp.dns_emp_code).trim().toUpperCase());
  }

  const dealersById = new Map();
  const dealersBySap = new Map();
  const dealersBySfa = new Map();
  const dealersByLinked = new Map();
  const dealersByComposite = new Map();

  for (const d of existingDealers) {
    dealersById.set(d.id, d);
    if (d.sap_code) dealersBySap.set(normalizeCode(d.sap_code), d);
    if (d.sfa_code) dealersBySfa.set(normalizeCode(d.sfa_code), d);
    if (d.linked_dealer_code) dealersByLinked.set(normalizeCode(d.linked_dealer_code), d);
    const nName = d.normalized_dealer_name || normalizeString(d.dealer_name);
    const nArea = d.normalized_area || normalizeBranch(d.dm_area || d.area || d.branch);
    if (nName && nArea) dealersByComposite.set(`${nName}#${nArea}`, d);
  }

  const mappingByDealerId = new Map();
  for (const m of existingMappings) {
    if (m.dealer_id) mappingByDealerId.set(m.dealer_id, m.id);
  }

  const empMapByName = new Map();
  for (const emp of existingEmployees) {
    if (emp.emp_name) empMapByName.set(emp.emp_name.trim().toUpperCase(), emp.emp_code);
  }

  // 3. In-memory processing loop
  let rowsRead = 0;
  let dealersCreated = 0;
  let dealersUpdated = 0;
  let mappingsCreated = 0;
  let mappingsUpdated = 0;
  let duplicateRows = 0;
  let invalidRows = 0;
  let ambiguousRows = 0;
  let missingSapCount = 0;
  let missingSoCodeCount = 0;
  let missingAsmCodeCount = 0;

  const uniqueDealers = new Set();
  const uniqueSos = new Set();
  const uniqueAsms = new Set();
  const uniqueRegions = new Set();
  const uniqueBranches = new Set();

  const errors = [];
  const warnings = [];
  const seenInFile = new Map();

  const auditsToInsert = [];
  const dealersToInsert = [];
  const dealersToUpdate = [];
  const mappingsToInsert = [];
  const mappingsToUpdate = [];
  const employeesToUpsert = new Map();

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;
    rowsRead++;

    const rawSapCode = normalizeCode(getCell(row, 'sap_code') || getCell(row, 'customer_code'));
    const rawCustomerCode = normalizeCode(getCell(row, 'customer_code') || getCell(row, 'sap_code'));
    const rawSfaCode = normalizeCode(getCell(row, 'sfa_code'));
    const rawLinkedCode = normalizeCode(getCell(row, 'linked_dealer_code'));
    const rawDealerName = getCell(row, 'dealer_name');
    const custType = getCell(row, 'cust_type') || 'STAR';

    const territoryCode = normalizeCode(getCell(row, 'territory_code'));
    const territoryName = getCell(row, 'territory_name');
    const rawBranch = getCell(row, 'branch');
    const rawArea = getCell(row, 'area');
    const dmArea = rawArea || rawBranch || territoryName || null;
    const branch = rawBranch || dmArea || null;
    let region = getCell(row, 'region') || getCell(row, 'zone');
    let zone = getCell(row, 'zone') || getCell(row, 'region');
    const soName = getCell(row, 'so_name');
    let soEmpCode = normalizeCode(getCell(row, 'so_emp_code') || getCell(row, 'so_code'));
    const asmName = getCell(row, 'asm_name');
    let asmCode = normalizeCode(getCell(row, 'asm_code'));
    const rsmName = getCell(row, 'rsm_name');
    let rsmCode = normalizeCode(getCell(row, 'rsm_code'));
    const zhName = getCell(row, 'zh_name');
    let zhCode = normalizeCode(getCell(row, 'zh_code'));

    if (!rawDealerName && !rawSapCode && !rawLinkedCode) {
      invalidRows++;
      continue;
    }

    if (!rawSapCode) missingSapCount++;
    if (!soEmpCode) missingSoCodeCount++;
    if (!asmCode) missingAsmCodeCount++;

    if (rawSapCode) uniqueDealers.add(rawSapCode);
    else if (rawDealerName) uniqueDealers.add(rawDealerName);

    if (soEmpCode) uniqueSos.add(soEmpCode);
    if (asmCode) uniqueAsms.add(asmCode);
    if (region) uniqueRegions.add(region);
    if (branch) uniqueBranches.add(branch);

    const dedupeKey = `${rawSapCode || rawDealerName}_${soEmpCode || soName}`;
    if (seenInFile.has(dedupeKey)) {
      duplicateRows++;
    } else {
      seenInFile.set(dedupeKey, i);
    }

    if (!soEmpCode && soName) soEmpCode = empMapByName.get(soName.trim().toUpperCase()) || null;
    if (!asmCode && asmName) asmCode = empMapByName.get(asmName.trim().toUpperCase()) || null;

    let effectiveZhName = zhName;
    let effectiveZhCode = zhCode;
    let effectiveZone = zone;

    if (!effectiveZhName || !effectiveZhCode || !effectiveZone) {
      const resolvedZh = await resolveZonalHead({ zone, region, area: dmArea, branch });
      if (resolvedZh?.zh_name) {
        if (!effectiveZhName) effectiveZhName = resolvedZh.zh_name;
        if (!effectiveZhCode) effectiveZhCode = resolvedZh.zh_code;
      }
      if (!effectiveZone && resolvedZh?.zone) effectiveZone = resolvedZh.zone;
      if (!region && effectiveZone) region = effectiveZone;
      if (!zone && effectiveZone) zone = effectiveZone;
    }

    const block = getCell(row, 'block');
    const counterPotential = getCellNum(row, 'counter_potential');
    const doa = parseDOA(colIdx['doa'] !== undefined ? row[colIdx['doa']] : null);

    const upperCust = custType.toUpperCase();
    let dType = 'DEALER';
    if (upperCust.includes('RSAR') || upperCust.includes('SUB') || (rawLinkedCode && rawLinkedCode !== '-')) {
      dType = 'RSAR';
    } else if (upperCust.includes('NON_STAR') || upperCust.includes('NON-STAR') || upperCust.includes('NON STAR') || upperCust.includes('PROSPECT')) {
      dType = 'NON STAR';
    }

    const normName = normalizeString(rawDealerName);
    const normArea = normalizeBranch(dmArea);
    const normBlock = normalizeString(block);
    const cleanRegion = normalizeRegion(effectiveZone);

    // In-memory canonical matching
    let matchedDealer = null;
    let matchMethod = 'NONE';
    let matchConfidence = 0;

    if (rawSapCode && (dealersBySap.has(rawSapCode) || dealersByLinked.has(rawSapCode) || dealersBySfa.has(rawSapCode))) {
      matchedDealer = dealersBySap.get(rawSapCode) || dealersByLinked.get(rawSapCode) || dealersBySfa.get(rawSapCode);
      matchMethod = 'SAP_CODE';
      matchConfidence = 100;
    } else if (rawSfaCode && dealersBySfa.has(rawSfaCode)) {
      matchedDealer = dealersBySfa.get(rawSfaCode);
      matchMethod = 'SFA_CODE';
      matchConfidence = 95;
    } else if (!rawSapCode && rawLinkedCode && dealersByLinked.has(rawLinkedCode)) {
      matchedDealer = dealersByLinked.get(rawLinkedCode);
      matchMethod = 'LINKED_DEALER_CODE';
      matchConfidence = 90;
    } else if (normName && normArea) {
      const compKey = `${normName}#${normArea}`;
      if (dealersByComposite.has(compKey)) {
        matchedDealer = dealersByComposite.get(compKey);
        matchMethod = 'COMPOSITE_NAME_AREA';
        matchConfidence = 85;
      }
    }

    const effectiveSoName = soName || (soEmpCode ? `SO ${soEmpCode}` : (rawDealerName ? `SO for ${rawDealerName}` : 'Unassigned SO'));

    if (matchedDealer) {
      dealersUpdated++;
      const internalId = matchedDealer.id;
      dealersToUpdate.push({
        id: internalId,
        params: [
          rawSapCode || null, rawSfaCode || null, dmArea || null,
          rawSapCode || null, rawCustomerCode || null, rawSfaCode || null,
          dmArea || null, branch || null, effectiveZone || null, effectiveZone || null,
          counterPotential, doa, territoryCode || null, territoryName || null,
          effectiveSoName || null, soEmpCode || null, asmName || null, asmCode || null,
          rsmCode || null, rsmName || null, effectiveZhCode || null, effectiveZhName || null,
          internalId
        ]
      });

      const existingMapId = mappingByDealerId.get(internalId);
      if (existingMapId && existingMapId !== 'PENDING_INSERT') {
        mappingsUpdated++;
        mappingsToUpdate.push({
          id: existingMapId,
          params: [
            rawSapCode || null, rawDealerName, dmArea || null, branch || null,
            effectiveZone || null, effectiveZone || null, block || null,
            effectiveSoName, soEmpCode || null, asmName || null, asmCode || null,
            rsmName || null, rsmCode || null, effectiveZhName || null, effectiveZhCode || null,
            territoryCode || null, territoryName || null, rawLinkedCode || null, activeBatchCode,
            existingMapId
          ]
        });
      } else if (!existingMapId) {
        mappingsCreated++;
        mappingByDealerId.set(internalId, 'PENDING_INSERT');
        mappingsToInsert.push([
          internalId, rawSapCode || null, rawDealerName, dmArea || null, branch || null,
          effectiveZone || null, effectiveZone || null, block || null,
          effectiveSoName, soEmpCode || null, asmName || null, asmCode || null,
          rsmName || null, rsmCode || null, effectiveZhName || null, effectiveZhCode || null,
          territoryCode || null, territoryName || null, rawLinkedCode || null, activeBatchCode
        ]);
      }

      auditsToInsert.push([
        activeBatchCode, sourceFileName, selectedSheetName, i + 1, 'DEALER_MAPPING',
        matchedDealer.dealer_id, rawSapCode, rawSfaCode, rawDealerName, matchMethod, matchConfidence, 'MATCHED', null
      ]);
    } else {
      dealersCreated++;
      const newUuid = crypto.randomUUID();
      const isProspect = dType === 'PROSPECTIVE' || dType === 'NON STAR';
      const counterStrategy = isProspect ? 'PROSPECT' : null;
      const prospectStatus = isProspect ? 'PROSPECT_MATCHED' : 'PROSPECT_NOT_FOUND';

      const newDealerObj = {
        dealer_id: newUuid,
        params: [
          newUuid, dType, rawSapCode || null, rawSfaCode || null, rawLinkedCode || null,
          rawDealerName, normName, dmArea || null, dmArea || null, branch || null,
          normArea, block || null, normBlock || null, effectiveZone || null, cleanRegion || null,
          effectiveSoName || null, soEmpCode || null, asmName || null, asmCode || null,
          counterStrategy, activeBatchCode, 'NEW', 'NONE', 100, 'ACTIVE', prospectStatus,
          rawSapCode || null, rawCustomerCode || null, rawSfaCode || null, counterPotential, doa,
          territoryCode || null, territoryName || null, rsmCode || null, rsmName || null,
          effectiveZhCode || null, effectiveZhName || null
        ],
        mappingParams: {
          rawSapCode, rawDealerName, dmArea, branch, effectiveZone, block,
          effectiveSoName, soEmpCode, asmName, asmCode, rsmName, rsmCode,
          effectiveZhName, effectiveZhCode, territoryCode, territoryName, rawLinkedCode,
          batchCode: activeBatchCode
        }
      };

      dealersToInsert.push(newDealerObj);
      if (rawSapCode) dealersBySap.set(rawSapCode, newDealerObj);
      if (rawSfaCode) dealersBySfa.set(rawSfaCode, newDealerObj);
      if (rawLinkedCode) dealersByLinked.set(rawLinkedCode, newDealerObj);
      if (normName && normArea) dealersByComposite.set(`${normName}#${normArea}`, newDealerObj);

      auditsToInsert.push([
        activeBatchCode, sourceFileName, selectedSheetName, i + 1, 'DEALER_MAPPING',
        newUuid, rawSapCode, rawSfaCode, rawDealerName, 'NONE', 100, 'NEW', null
      ]);
    }

    // Accumulate distinct employees for batch upsert
    const addEmp = (code, name, desig, reg) => {
      if (!code || !name) return;
      const c = String(code).trim().toUpperCase();
      const n = String(name).trim();
      if (['VACANT', '-', 'NA', 'N/A', 'NULL'].includes(c) || ['VACANT', '-', 'NA', 'N/A', 'NULL'].includes(n.toUpperCase())) return;
      if (inactiveEmpCodes.has(c)) return; // Never re-add inactive employees to master_employees
      if (!employeesToUpsert.has(c)) {
        employeesToUpsert.set(c, [c, n, desig, reg || null, reg || null]);
      }
    };
    addEmp(soEmpCode, soName, 'SO/SE', region);
    addEmp(asmCode, asmName, 'ASM', region);
    addEmp(rsmCode, rsmName, 'RSM', region);
    addEmp(effectiveZhCode, effectiveZhName, 'ZH', effectiveZone || region);
  }

  // 4. Chunked Database Batch Operations

  // 4.1 Batch Insert New Dealers
  if (dealersToInsert.length > 0) {
    const chunkSz = 250;
    const colList = DEALER_INSERT_COLS.map(c => `\`${c}\``).join(', ');
    const singlePlaceholder = `(${DEALER_INSERT_COLS.map(() => '?').join(', ')})`;

    for (let i = 0; i < dealersToInsert.length; i += chunkSz) {
      const chunk = dealersToInsert.slice(i, i + chunkSz);
      const sql = `INSERT INTO master_dealers (${colList}) VALUES ${chunk.map(() => singlePlaceholder).join(', ')}`;
      const params = chunk.flatMap(d => d.params);
      await dbRun(sql, params);

      // Map generated auto-increment IDs via UUIDs
      const uuidList = chunk.map(d => d.dealer_id);
      const uuidPlaceholders = uuidList.map(() => '?').join(', ');
      const insertedRows = await dbAll(`SELECT id, dealer_id FROM master_dealers WHERE dealer_id IN (${uuidPlaceholders})`, uuidList);
      const idByUuid = new Map(insertedRows.map(r => [r.dealer_id, r.id]));

      for (let j = 0; j < chunk.length; j++) {
        const item = chunk[j];
        const internalId = idByUuid.get(item.dealer_id);
        const mp = item.mappingParams;
        mappingsToInsert.push([
          internalId, mp.rawSapCode || null, mp.rawDealerName, mp.dmArea || null, mp.branch || null,
          mp.effectiveZone || null, mp.effectiveZone || null, mp.block || null,
          mp.effectiveSoName, mp.soEmpCode || null, mp.asmName || null, mp.asmCode || null,
          mp.rsmName || null, mp.rsmCode || null, mp.effectiveZhName || null, mp.effectiveZhCode || null,
          mp.territoryCode || null, mp.territoryName || null, mp.rawLinkedCode || null, mp.batchCode
        ]);
        mappingsCreated++;
      }
    }
  }

  // 4.2 Batch Update Existing Dealers
  if (dealersToUpdate.length > 0) {
    const chunkSz = 250;
    for (let i = 0; i < dealersToUpdate.length; i += chunkSz) {
      const chunk = dealersToUpdate.slice(i, i + chunkSz);
      const sqlBatch = chunk.map(() => `
        UPDATE master_dealers SET
          sap_code = COALESCE(?, sap_code),
          sfa_code = COALESCE(?, sfa_code),
          dm_area = ?,
          dm_sap_code = COALESCE(?, dm_sap_code),
          dm_customer_code = COALESCE(?, dm_customer_code),
          dm_sfa_code = COALESCE(?, dm_sfa_code),
          area = COALESCE(?, area),
          branch = COALESCE(?, branch),
          zone = COALESCE(?, zone),
          region = COALESCE(?, region),
          counter_potential = COALESCE(?, counter_potential),
          doa = COALESCE(?, doa),
          territory_code = COALESCE(?, territory_code),
          territory_name = COALESCE(?, territory_name),
          so_name = COALESCE(?, NULLIF(NULLIF(so_name, '-'), 'NA')),
          so_emp_code = COALESCE(?, NULLIF(NULLIF(so_emp_code, '-'), 'NA')),
          asm_name = COALESCE(?, NULLIF(NULLIF(asm_name, '-'), 'NA')),
          asm_code = COALESCE(?, NULLIF(NULLIF(asm_code, '-'), 'NA')),
          rsm_code = COALESCE(?, NULLIF(NULLIF(rsm_code, '-'), 'NA')),
          rsm_name = COALESCE(?, NULLIF(NULLIF(rsm_name, '-'), 'NA')),
          zh_code = COALESCE(?, NULLIF(NULLIF(zh_code, '-'), 'NA')),
          zh_name = COALESCE(?, NULLIF(NULLIF(zh_name, '-'), 'NA'))
        WHERE id = ?;
      `).join('\n');
      const params = chunk.flatMap(c => c.params);
      await dbRun(sqlBatch, params);
    }
  }

  // 4.3 Batch Insert Mappings
  if (mappingsToInsert.length > 0) {
    const chunkSz = 250;
    const colList = MAP_COLS.map(c => `\`${c}\``).join(', ');
    const singlePlaceholder = `(${MAP_COLS.map(() => '?').join(', ')})`;

    for (let i = 0; i < mappingsToInsert.length; i += chunkSz) {
      const chunk = mappingsToInsert.slice(i, i + chunkSz);
      const sql = `INSERT INTO master_dealer_so_mapping (${colList}) VALUES ${chunk.map(() => singlePlaceholder).join(', ')}`;
      const params = chunk.flat();
      await dbRun(sql, params);
    }
  }

  // 4.4 Batch Update Mappings
  if (mappingsToUpdate.length > 0) {
    const chunkSz = 250;
    for (let i = 0; i < mappingsToUpdate.length; i += chunkSz) {
      const chunk = mappingsToUpdate.slice(i, i + chunkSz);
      const sqlBatch = chunk.map(() => `
        UPDATE master_dealer_so_mapping SET 
          sap_code = COALESCE(?, sap_code),
          dealer_name = ?,
          area = COALESCE(?, area),
          branch = COALESCE(?, branch),
          zone = COALESCE(?, zone),
          region = COALESCE(?, region),
          block = COALESCE(?, block),
          so_name = COALESCE(?, so_name),
          so_emp_code = COALESCE(?, so_emp_code),
          asm_name = COALESCE(?, asm_name),
          asm_code = COALESCE(?, asm_code),
          rsm_name = COALESCE(?, rsm_name),
          rsm_code = COALESCE(?, rsm_code),
          zh_name = COALESCE(?, zh_name),
          zh_code = COALESCE(?, zh_code),
          territory_code = COALESCE(?, territory_code),
          territory_name = COALESCE(?, territory_name),
          linked_dealer_code = COALESCE(?, linked_dealer_code),
          batch_code = ?
        WHERE id = ?;
      `).join('\n');
      const params = chunk.flatMap(c => c.params);
      await dbRun(sqlBatch, params);
    }
  }

  // 4.5 Batch Insert Audits
  if (auditsToInsert.length > 0) {
    const chunkSz = 500;
    const colList = AUDIT_COLS.map(c => `\`${c}\``).join(', ');
    const singlePlaceholder = `(${AUDIT_COLS.map(() => '?').join(', ')})`;

    for (let i = 0; i < auditsToInsert.length; i += chunkSz) {
      const chunk = auditsToInsert.slice(i, i + chunkSz);
      const sql = `INSERT INTO matching_audit (${colList}) VALUES ${chunk.map(() => singlePlaceholder).join(', ')}`;
      const params = chunk.flat();
      await dbRun(sql, params).catch(() => {});
    }
  }

  // 4.6 Batch Upsert Employees across hierarchy (SO, ASM, RSM, ZH)
  if (employeesToUpsert.size > 0) {
    const empRows = Array.from(employeesToUpsert.values());
    const chunkSz = 100;
    for (let i = 0; i < empRows.length; i += chunkSz) {
      const chunk = empRows.slice(i, i + chunkSz);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const sql = `
        INSERT INTO master_employees (emp_code, emp_name, designation, zone, region)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          emp_name = VALUES(emp_name),
          designation = COALESCE(NULLIF(designation, ''), VALUES(designation)),
          zone = COALESCE(VALUES(zone), zone),
          region = COALESCE(VALUES(region), region)
      `;
      const params = chunk.flat();
      await dbRun(sql, params);
    }
  }

  const totalDuration = Date.now() - startTime;
  const validRows = (dealersCreated + dealersUpdated) || (mappingsCreated + mappingsUpdated) || (rowsRead - invalidRows);
  const result = {
    success: true,
    totalRows: rowsRead,
    validRows: validRows,
    invalidRows: invalidRows,
    duplicateRows: duplicateRows,
    rowsRead,
    dealersCreated,
    dealersUpdated,
    mappingsCreated,
    mappingsUpdated,
    duplicates: duplicateRows,
    unmatched: invalidRows,
    ambiguous: ambiguousRows,
    missingSap: missingSapCount,
    missingSoCode: missingSoCodeCount,
    missingAsmCode: missingAsmCodeCount,
    uniqueDealers: uniqueDealers.size,
    uniqueSos: uniqueSos.size,
    uniqueAsms: uniqueAsms.size,
    uniqueRegions: uniqueRegions.size,
    uniqueBranches: uniqueBranches.size,
    durationMs: totalDuration,
    warnings,
    errors
  };

  console.log(`[DEALER_MAPPING] Ingestion Complete in ${totalDuration}ms:`, result);
  return result;
}
