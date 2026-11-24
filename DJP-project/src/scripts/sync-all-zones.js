import { dbAll, dbRun } from '../config/database.js';
import { BRANCH_ZONE_MAP, normalizeZone, VALID_ZONES } from '../services/zonalHead.service.js';

export async function syncAllZonesFromSfa() {
  console.log('====================================================');
  console.log('SYNC ALL ZONES & HIERARCHIES FROM SFA AUTHORITATIVE DATA');
  console.log('====================================================\n');

  const t0 = Date.now();

  // 0. Clean up non-canonical legacy zones from master_zone_zh_mapping & update area keywords
  await dbRun(`DELETE FROM master_zone_zh_mapping WHERE zone_code IN ('SOUTH BENGAL', 'NT', 'SB', 'WB', 'LG')`);

  await dbRun(`
    UPDATE master_zone_zh_mapping 
    SET area_keywords = CONCAT(COALESCE(area_keywords, ''), ', RAGHUNATHGANJ, MURSHIDABAD, JIAGUNJ, SAMSHERGANJ, SUTI, KOLKATA, HOWRAH, HOOGHLY, BURDWAN, MIDNAPORE, SOUTH 24 PARGANAS, NORTH 24 PARGANAS, DURGAPUR, ASANSOL, BANKURA, PURULIA, BIRBHUM, NADIA')
    WHERE zone_code = 'NB2' AND area_keywords NOT LIKE '%MURSHIDABAD%'
  `);

  await dbRun(`
    UPDATE master_zone_zh_mapping 
    SET area_keywords = CONCAT(COALESCE(area_keywords, ''), ', WARSALIGANJ, WARISALIGANJ, WARSLIGANJ, WARSHALIGANJ, NAWADA, CHHOTKI NAWADA, RAJAULI, HULASGANJ, JEHANABAD')
    WHERE zone_code = 'BIHAR' AND area_keywords NOT LIKE '%WARSALIGANJ%'
  `);

  // 1. Load SFA Ground Truth
  console.log('[1/5] Loading SFA Ground Truth into memory...');
  const custRows = await dbAll(`
    SELECT UPPER(TRIM(dns_customer_code)) as code, UPPER(TRIM(customer_code)) as cust_code, UPPER(TRIM(display_code)) as disp_code, UPPER(TRIM(zone)) as zone
    FROM master_customer_coordinates
    WHERE zone IS NOT NULL AND zone != ''
  `);
  const sfaCustZoneMap = new Map();
  for (const c of custRows) {
    const zNorm = normalizeZone(c.zone);
    if (zNorm) {
      if (c.code) sfaCustZoneMap.set(c.code, zNorm);
      if (c.cust_code) sfaCustZoneMap.set(c.cust_code, zNorm);
      if (c.disp_code) sfaCustZoneMap.set(c.disp_code, zNorm);
    }
  }

  const routeRows = await dbAll(`
    SELECT UPPER(TRIM(route_name)) as route, UPPER(TRIM(zone)) as zone
    FROM master_customer_coordinates
    WHERE route_name IS NOT NULL AND zone IS NOT NULL AND zone != ''
    GROUP BY UPPER(TRIM(route_name)), UPPER(TRIM(zone))
  `);
  const sfaRouteZoneMap = new Map();
  for (const r of routeRows) {
    const zNorm = normalizeZone(r.zone);
    if (zNorm && r.route) {
      sfaRouteZoneMap.set(r.route, zNorm);
    }
  }

  const empRows = await dbAll(`
    SELECT UPPER(TRIM(dns_emp_code)) as dns_code, UPPER(TRIM(emp_code)) as emp_code, UPPER(TRIM(zone)) as zone
    FROM employee_master
    WHERE zone IS NOT NULL AND zone != ''
  `);
  const sfaEmpZoneMap = new Map();
  for (const e of empRows) {
    const zNorm = normalizeZone(e.zone);
    if (zNorm) {
      if (e.dns_code) sfaEmpZoneMap.set(e.dns_code, zNorm);
      if (e.emp_code) sfaEmpZoneMap.set(e.emp_code, zNorm);
    }
  }

  // Authoritative ZH mapping & dynamic area keywords
  const zhRows = await dbAll(`SELECT zone_code, zh_name, zh_code, area_keywords FROM master_zone_zh_mapping`);
  const zhMap = new Map();
  const dynamicAreaZoneMap = new Map();
  for (const z of zhRows) {
    const normZ = normalizeZone(z.zone_code);
    if (normZ && VALID_ZONES.has(normZ) && z.zh_name) {
      if (!zhMap.has(normZ)) {
        zhMap.set(normZ, { zh_name: z.zh_name, zh_code: z.zh_code });
      }
      if (z.area_keywords) {
        const parts = z.area_keywords.split(/[,;\n]+/).map(p => p.trim().toUpperCase()).filter(Boolean);
        for (const p of parts) {
          if (!dynamicAreaZoneMap.has(p)) {
            dynamicAreaZoneMap.set(p, normZ);
          }
        }
      }
    }
  }
  // Canonicals
  if (!zhMap.has('BIHAR')) zhMap.set('BIHAR', { zh_name: 'GIRIDHARI MUKHERJEE', zh_code: '11002257' });
  if (!zhMap.has('NB1')) zhMap.set('NB1', { zh_name: 'GIRIDHARI MUKHERJEE', zh_code: '11002257' });
  if (!zhMap.has('NB2')) zhMap.set('NB2', { zh_name: 'GIRIDHARI MUKHERJEE', zh_code: '11002257' });
  if (!zhMap.has('NE1')) zhMap.set('NE1', { zh_name: 'TARAK NATH GHOSH', zh_code: '1100077' });
  if (!zhMap.has('NE2')) zhMap.set('NE2', { zh_name: 'BRIJESH SINGH', zh_code: '11001891' });

  console.log(`✓ SFA Customers: ${sfaCustZoneMap.size}, Routes: ${sfaRouteZoneMap.size}, Employees: ${sfaEmpZoneMap.size} (${Date.now() - t0}ms)\n`);

  function resolveZone({ sap_code, sfa_code, customer_code, so_emp_code, branch, area, dm_area, block, sbg_block, zone, region }) {
    // 1. SFA Customer Data
    for (const c of [sap_code, sfa_code, customer_code]) {
      if (!c) continue;
      const clean = String(c).trim().toUpperCase();
      if (sfaCustZoneMap.has(clean)) {
        const z = sfaCustZoneMap.get(clean);
        if (VALID_ZONES.has(z)) return z;
      }
    }

    // 2. Geographic Match: SFA Routes, BRANCH_ZONE_MAP, dynamicAreaZoneMap
    for (const g of [branch, dm_area, area, sbg_block, block]) {
      if (!g) continue;
      const clean = String(g).trim().toUpperCase();
      if (sfaRouteZoneMap.has(clean) && VALID_ZONES.has(sfaRouteZoneMap.get(clean))) {
        return sfaRouteZoneMap.get(clean);
      }
      if (BRANCH_ZONE_MAP[clean] && VALID_ZONES.has(BRANCH_ZONE_MAP[clean])) {
        return BRANCH_ZONE_MAP[clean];
      }
      if (dynamicAreaZoneMap.has(clean)) {
        return dynamicAreaZoneMap.get(clean);
      }
      for (const [k, z] of Object.entries(BRANCH_ZONE_MAP)) {
        if (k.length >= 3 && (clean === k || clean.includes(k) || k.includes(clean))) {
          if (VALID_ZONES.has(z)) return z;
        }
      }
    }

    // 3. SFA Employee Data (SO Assignment)
    if (so_emp_code) {
      const clean = String(so_emp_code).trim().toUpperCase();
      if (sfaEmpZoneMap.has(clean)) {
        const z = sfaEmpZoneMap.get(clean);
        if (VALID_ZONES.has(z)) return z;
      }
    }

    // 4. Explicit zone
    const norm = normalizeZone(zone || region);
    if (norm && VALID_ZONES.has(norm)) return norm;

    // 5. Default
    return 'NE1';
  }

  // 2. Match and update master_dealers
  console.log('[2/5] Matching zones in master_dealers...');
  const dealers = await dbAll(`SELECT id, sap_code, sfa_code, so_emp_code, branch, area, dm_area, block, sbg_block, zone, region, zh_name, zh_code FROM master_dealers`);
  let mdUpdates = 0;
  for (const d of dealers) {
    const targetZone = resolveZone(d);
    const zh = zhMap.get(targetZone) || zhMap.get('NE1');
    const needZone = d.zone !== targetZone;
    const needZh = zh && (d.zh_name !== zh.zh_name || d.zh_code !== zh.zh_code);

    if (needZone || needZh) {
      await dbRun(`UPDATE master_dealers SET zone = ?, zh_name = ?, zh_code = ? WHERE id = ?`, [targetZone, zh.zh_name, zh.zh_code, d.id]);
      mdUpdates++;
    }
  }
  console.log(`✓ master_dealers updated: ${mdUpdates} / ${dealers.length}\n`);

  // 3. Match and update master_dealer_so_mapping
  console.log('[3/5] Matching zones in master_dealer_so_mapping...');
  const mappings = await dbAll(`SELECT id, sap_code, linked_dealer_code as sfa_code, so_emp_code, branch, area, block, zone, region, zh_name, zh_code FROM master_dealer_so_mapping`);
  let mapUpdates = 0;
  for (const m of mappings) {
    const targetZone = resolveZone(m);
    const zh = zhMap.get(targetZone) || zhMap.get('NE1');
    const needZone = m.zone !== targetZone;
    const needZh = zh && (m.zh_name !== zh.zh_name || m.zh_code !== zh.zh_code);

    if (needZone || needZh) {
      await dbRun(`UPDATE master_dealer_so_mapping SET zone = ?, zh_name = ?, zh_code = ? WHERE id = ?`, [targetZone, zh.zh_name, zh.zh_code, m.id]);
      mapUpdates++;
    }
  }
  console.log(`✓ master_dealer_so_mapping updated: ${mapUpdates} / ${mappings.length}\n`);

  // 4. Match and update dealer_visit_targets
  console.log('[4/5] Matching zones in dealer_visit_targets...');
  const targets = await dbAll(`SELECT id, sap_code, sfa_code, so_emp_code, branch, area, dm_area, block, sbg_block, zone, region, zh_name, zh_code FROM dealer_visit_targets`);
  let tgtUpdates = 0;
  const BATCH_SIZE = 500;
  let batch = [];

  for (const t of targets) {
    const targetZone = resolveZone(t);
    const zh = zhMap.get(targetZone) || zhMap.get('NE1');
    const needZone = t.zone !== targetZone;
    const needZh = zh && (t.zh_name !== zh.zh_name || t.zh_code !== zh.zh_code);

    if (needZone || needZh) {
      batch.push({ id: t.id, zone: targetZone, zh_name: zh.zh_name, zh_code: zh.zh_code });
      tgtUpdates++;
    }
  }

  console.log(`  Updating ${tgtUpdates} dealer_visit_targets rows in batches...`);
  for (let i = 0; i < batch.length; i += BATCH_SIZE) {
    const chunk = batch.slice(i, i + BATCH_SIZE);
    const ids = chunk.map(c => c.id).join(',');
    const zoneCases = chunk.map(c => `WHEN id = ${c.id} THEN '${c.zone}'`).join(' ');
    const zhNameCases = chunk.map(c => `WHEN id = ${c.id} THEN '${c.zh_name.replace(/'/g, "''")}'`).join(' ');
    const zhCodeCases = chunk.map(c => `WHEN id = ${c.id} THEN '${c.zh_code}'`).join(' ');

    await dbRun(`
      UPDATE dealer_visit_targets
      SET 
        zone = CASE ${zoneCases} ELSE zone END,
        zh_name = CASE ${zhNameCases} ELSE zh_name END,
        zh_code = CASE ${zhCodeCases} ELSE zh_code END
      WHERE id IN (${ids})
    `);
  }
  console.log(`✓ dealer_visit_targets updated: ${tgtUpdates} / ${targets.length}\n`);

  // 4b. Sync block from master_dealers where missing on target
  const resBlock = await dbRun(`
    UPDATE dealer_visit_targets dvt
    JOIN master_dealers md ON dvt.dealer_id = md.id OR (dvt.sap_code IS NOT NULL AND dvt.sap_code = md.sap_code)
    SET dvt.block = md.block
    WHERE (dvt.block IS NULL OR dvt.block = '' OR dvt.block = '-') AND md.block IS NOT NULL AND md.block != ''
  `);
  console.log(`✓ dealer_visit_targets blocks backfilled: ${resBlock.changes || 0}\n`);

  // 5. Verification
  console.log('[5/5] Verifying zone distribution across tables...');
  const tgtDist = await dbAll(`SELECT zone, zh_name, COUNT(*) as c FROM dealer_visit_targets GROUP BY zone, zh_name ORDER BY zone`);
  console.log('dealer_visit_targets Zone & ZH summary:');
  console.table(tgtDist);

  const dlrDist = await dbAll(`SELECT zone, zh_name, COUNT(*) as c FROM master_dealers GROUP BY zone, zh_name ORDER BY zone`);
  console.log('master_dealers Zone & ZH summary:');
  console.table(dlrDist);

  const mapDist = await dbAll(`SELECT zone, zh_name, COUNT(*) as c FROM master_dealer_so_mapping GROUP BY zone, zh_name ORDER BY zone`);
  console.log('master_dealer_so_mapping Zone & ZH summary:');
  console.table(mapDist);

  console.log(`\n====================================================`);
  console.log(`✓ ALL ZONES & ZONAL HEADS SUCCESSFULLY MATCHED IN ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  console.log(`====================================================`);
}

// Run directly if invoked from CLI
if (process.argv[1]?.endsWith('sync-all-zones.js')) {
  syncAllZonesFromSfa().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
