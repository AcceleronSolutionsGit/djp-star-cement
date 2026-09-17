import { dbGet, dbRun, dbAll } from '../config/database.js';
import { normalizeString, normalizeCode, normalizeBranch, normalizeRegion } from './normalization.engine.js';
import crypto from 'crypto';

/**
 * Canonical Dealer Identity Matching Engine
 * 
 * Rules:
 * - STAR dealers primarily match by exact SAP Code.
 * - If SAP is absent, match by SFA Code or Linked Dealer Code.
 * - Fallback: Composite (Name + Branch/Area).
 * - Never invent fake SAP codes.
 * - Never set sapCode = linkedDealerCode.
 * - Returns match details to be audited.
 */

export async function matchAndUpsertCanonicalDealer({
  dealerType, // 'STAR' or 'NON_STAR'
  rawSapCode,
  rawSfaCode,
  rawLinkedDealerCode,
  rawDealerName,
  rawArea,
  rawBranch,
  rawBlock,
  zone,
  region,
  soName,
  soEmpCode,
  asmName,
  asmCode,
  batchCode,
  sourceType = 'DEALER_MAPPING'
}) {
  const sapCode = normalizeCode(rawSapCode);
  const sfaCode = normalizeCode(rawSfaCode);
  const linkedDealerCode = normalizeCode(rawLinkedDealerCode);
  const cleanEmpCode = normalizeCode(soEmpCode);
  const cleanAsmCode = normalizeCode(asmCode);

  const dealerName = normalizeString(rawDealerName);
  const effectiveArea = rawBranch || rawArea || null;
  const area = normalizeBranch(effectiveArea);
  const block = normalizeString(rawBlock);
  const effectiveZone = region || zone || null;
  const cleanRegion = normalizeRegion(effectiveZone);
  let dType = 'STAR';
  if (dealerType === 'PROSPECTIVE') {
    dType = 'PROSPECTIVE';
  } else if (dealerType === 'NON_STAR' || dealerType === 'NON-STAR') {
    dType = 'NON_STAR';
  }

  let matchMethod = 'NONE';
  let matchConfidence = 0;
  let matchStatus = 'UNMATCHED';
  let matchedDealer = null;
  let ambiguousCandidates = [];

  // 1. Try Exact Customer/SAP Code Match (STAR / Canonical)
  if (sapCode) {
    const sapMatches = await dbAll('SELECT * FROM master_dealers WHERE sap_code = ? OR linked_dealer_code = ? OR sfa_code = ?', [sapCode, sapCode, sapCode]);
    if (sapMatches.length === 1) {
      matchedDealer = sapMatches[0];
      matchMethod = 'SAP_CODE';
      matchConfidence = 100;
      matchStatus = 'MATCHED';
    } else if (sapMatches.length > 1) {
      ambiguousCandidates = sapMatches;
      matchStatus = 'AMBIGUOUS';
    }
  }

  // 2. Try SFA Code Match
  if (!matchedDealer && matchStatus !== 'AMBIGUOUS' && sfaCode) {
    const sfaMatches = await dbAll('SELECT * FROM master_dealers WHERE sfa_code = ?', [sfaCode]);
    if (sfaMatches.length === 1) {
      matchedDealer = sfaMatches[0];
      matchMethod = 'SFA_CODE';
      matchConfidence = 95;
      matchStatus = 'MATCHED';
    } else if (sfaMatches.length > 1) {
      ambiguousCandidates = sfaMatches;
      matchStatus = 'AMBIGUOUS';
    }
  }

  // 3. Try Linked Dealer Code Match (When SAP is unavailable)
  if (!matchedDealer && matchStatus !== 'AMBIGUOUS' && !sapCode && linkedDealerCode) {
    const linkMatches = await dbAll('SELECT * FROM master_dealers WHERE linked_dealer_code = ?', [linkedDealerCode]);
    if (linkMatches.length === 1) {
      matchedDealer = linkMatches[0];
      matchMethod = 'LINKED_DEALER_CODE';
      matchConfidence = 90;
      matchStatus = 'MATCHED';
    } else if (linkMatches.length > 1) {
      ambiguousCandidates = linkMatches;
      matchStatus = 'AMBIGUOUS';
    }
  }

  // 4. Try Composite Match (Name + Area/Branch)
  if (!matchedDealer && matchStatus !== 'AMBIGUOUS' && dealerName && area) {
    let query = 'SELECT * FROM master_dealers WHERE normalized_dealer_name = ? AND (normalized_area = ? OR area = ? OR branch = ?)';
    let params = [dealerName, area, effectiveArea, effectiveArea];
    
    if (block) {
      query += ' AND normalized_block = ?';
      params.push(block);
    }
    
    const compositeMatches = await dbAll(query, params);
    
    if (compositeMatches.length === 1) {
      matchedDealer = compositeMatches[0];
      matchMethod = 'COMPOSITE_NAME_AREA';
      matchConfidence = 85;
      matchStatus = 'MATCHED';
    } else if (compositeMatches.length > 1) {
      ambiguousCandidates = compositeMatches;
      matchStatus = 'AMBIGUOUS';
    }
  }

  // Decide what to do
  if (matchStatus === 'AMBIGUOUS' || matchStatus === 'NEEDS_REVIEW') {
    return {
      success: false,
      dealerId: null,
      internalId: null,
      matchStatus,
      matchMethod,
      matchConfidence,
      message: `Multiple candidates (${ambiguousCandidates.length}) found. Ambiguous record.`,
    };
  }

  if (matchStatus === 'UNMATCHED') {
    if (sourceType === 'SALES_HISTORY') {
      return {
        success: false,
        dealerId: null,
        internalId: null,
        matchStatus,
        matchMethod,
        matchConfidence,
        message: 'Unmatched dealer in Sales History. Not creating.',
      };
    }
    
    const dealerId = crypto.randomUUID();
    const counterStrategy = dType === 'PROSPECTIVE' ? 'PROSPECT' : null;
    const res = await dbRun(
      `INSERT INTO master_dealers 
      (dealer_id, dealer_type, sap_code, sfa_code, linked_dealer_code, dealer_name, normalized_dealer_name, 
       area, branch, normalized_area, block, normalized_block, zone, region,
       so_name, so_emp_code, asm_name, asm_code, counter_strategy,
       batch_code, match_status, match_method, match_confidence) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dealerId, dType, sapCode || null, sfaCode || null, linkedDealerCode || null,
        rawDealerName, dealerName,
        effectiveArea || null, rawBranch || effectiveArea || null, area,
        rawBlock || null, block || null,
        effectiveZone || null, cleanRegion || null,
        soName || null, cleanEmpCode || null,
        asmName || null, cleanAsmCode || null,
        counterStrategy,
        batchCode, 'NEW', 'NONE', 100
      ]
    );
    return {
      success: true,
      dealerId: dealerId,
      internalId: res.insertId,
      matchStatus: 'NEW',
      matchMethod: 'NONE',
      matchConfidence: 100,
      isNew: true
    };
  }

  // MATCHED -> Update
  if (matchStatus === 'MATCHED') {
    if (sourceType !== 'SALES_HISTORY') {
      await dbRun(
        `UPDATE master_dealers SET 
        sap_code = COALESCE(?, sap_code),
        sfa_code = COALESCE(?, sfa_code),
        linked_dealer_code = COALESCE(?, linked_dealer_code),
        dealer_name = ?,
        normalized_dealer_name = ?,
        area = COALESCE(?, area),
        branch = COALESCE(?, branch),
        normalized_area = COALESCE(?, normalized_area),
        block = COALESCE(?, block),
        normalized_block = COALESCE(?, normalized_block),
        zone = COALESCE(?, zone),
        region = COALESCE(?, region),
        so_name = COALESCE(?, so_name),
        so_emp_code = COALESCE(?, so_emp_code),
        asm_name = COALESCE(?, asm_name),
        asm_code = COALESCE(?, asm_code),
        match_status = ?,
        match_method = ?,
        match_confidence = ?,
        batch_code = ?
        WHERE id = ?`,
        [
          sapCode || null, sfaCode || null, linkedDealerCode || null,
          rawDealerName, dealerName,
          effectiveArea || null, rawBranch || effectiveArea || null, area,
          rawBlock || null, block || null,
          effectiveZone || null, cleanRegion || null,
          soName || null, cleanEmpCode || null,
          asmName || null, cleanAsmCode || null,
          matchStatus, matchMethod, matchConfidence, batchCode, matchedDealer.id
        ]
      );
    }
    return {
      success: true,
      dealerId: matchedDealer.dealer_id,
      internalId: matchedDealer.id,
      matchStatus,
      matchMethod,
      matchConfidence,
      isNew: false
    };
  }

  return { success: false, matchStatus: 'UNKNOWN', message: 'Unhandled matching state.' };
}

/**
 * Log to matching_audit
 */
export async function logMatchingAudit({
  batchCode,
  sourceFile,
  sourceSheet,
  sourceRow,
  sourceType,
  dealerId,
  sapCode,
  sfaCode,
  dealerName,
  matchMethod,
  matchConfidence,
  matchStatus,
  errorMessage
}) {
  try {
    await dbRun(
      `INSERT INTO matching_audit 
      (batch_code, source_file, source_sheet, source_row, source_type, dealer_id, sap_code, sfa_code, dealer_name, match_method, match_confidence, match_status, error_message) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batchCode,
        sourceFile,
        sourceSheet,
        sourceRow,
        sourceType,
        dealerId,
        sapCode,
        sfaCode,
        dealerName,
        matchMethod,
        matchConfidence,
        matchStatus,
        errorMessage
      ]
    );
  } catch (err) {
    console.error('Failed to log matching audit:', err);
  }
}
