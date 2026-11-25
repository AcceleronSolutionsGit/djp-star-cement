import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbAll, dbRun } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const norm = v => String(v ?? '').trim();
const key  = v => norm(v).toUpperCase();
const normName = v => key(v).replace(/\([^)]*\)/g, '').replace(/[,.-]+/g, ' ').replace(/\s+/g, ' ').trim();

// Explicit dictionary for the legacy Plan 565 rows
const DEALER_FIXES = {
  'PANKAJ CEMENT,': {
    dealer_name: 'PANKAJ CEMENT STORE',
    sap_code: 'NSRE07305',
    sfa_code: 'NSRE07305',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'JAI SADAFAL LOHA BHANDAR': {
    dealer_name: 'JAI SADAFAL LOHA BHANDAR',
    sap_code: '1000002059',
    sfa_code: 'BHJ047',
    dealer_type: 'DEALER',
    category: 'Zero Lifter'
  },
  'SAMPARK HARDWARE': {
    dealer_name: 'SAMPARK HARDWARE',
    sap_code: 'NSRE19321',
    sfa_code: 'NSRE19321',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'PRASAD HARDWARE TRADERS (RSDP935)': {
    dealer_name: 'PRASAD HARDWARE TRADERS (RSDP935)',
    sap_code: '1500000990',
    sfa_code: 'SDRE07338',
    dealer_type: 'RSAR',
    category: 'Churn'
  },
  'PRASANTA HARDWARE': {
    dealer_name: 'PRASANTA HARDWARE',
    sap_code: 'NSRE21121',
    sfa_code: 'NSRE21121',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'SHREE RAM TRADERS': {
    dealer_name: 'SHREE RAM TRADERS',
    sap_code: '1000001383',
    sfa_code: 'WBS303',
    dealer_type: 'DEALER',
    category: 'Growing'
  },
  'GANESH ENTERPRISES': {
    dealer_name: 'GANESH ENTERPRISES',
    sap_code: 'BHG030',
    sfa_code: 'BHG030',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'NEW LOCKNATH BUILDERS': {
    dealer_name: 'NEW LOCKNATH BUILDERS',
    sap_code: 'WBN114',
    sfa_code: 'WBN114',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'MANIYARI TRADERS': {
    dealer_name: 'MANIYARI TRADERS',
    sap_code: 'BHM009',
    sfa_code: 'BHM009',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'RK TRADING': {
    dealer_name: 'RK TRADING',
    sap_code: 'SDNE10292',
    sfa_code: 'SDNE10292',
    dealer_type: 'RSAR',
    category: 'Prospective'
  },
  'N S TRADING CO (SARAI)': {
    dealer_name: 'N S TRADING CO (SARAI)',
    sap_code: 'NSRE09153',
    sfa_code: 'NSRE09153',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'SRI HARI CEMENT': {
    dealer_name: 'SRI HARI CEMENT',
    sap_code: 'NSRE17944',
    sfa_code: 'NSRE17944',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'SUBRATA ROY': {
    dealer_name: 'SUBRATA ROY',
    sap_code: 'NSRE03259',
    sfa_code: 'NSRE03259',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'JAI MAA VINDWASHNI IRON STEEL': {
    dealer_name: 'JAI MAA VINDWASHNI IRON STEEL',
    sap_code: 'NSRE03276',
    sfa_code: 'NSRE03276',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'SHIV GURU TRADERS': {
    dealer_name: 'SHIV GURU TRADERS',
    sap_code: 'NSRE03292',
    sfa_code: 'NSRE03292',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'SHIV ENTERPRISES - BARAJAGARNATH': {
    dealer_name: 'SHIV ENTERPRISES - BARAJAGARNATH',
    sap_code: 'NSRE17737',
    sfa_code: 'NSRE17737',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'NARGIS TRADERS': {
    dealer_name: 'NARGIS TRADERS',
    sap_code: 'NSRE03271',
    sfa_code: 'NSRE03271',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'MAUSAMI ENTERPRISE': {
    dealer_name: 'MAUSAMI ENTERPRISE',
    sap_code: 'NSRE03258',
    sfa_code: 'NSRE03258',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  "AMBIKA TRADER'S": {
    dealer_name: "AMBIKA TRADER'S",
    sap_code: 'NSRE16988',
    sfa_code: 'NSRE16988',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'MJ TRADERS': {
    dealer_name: 'MJ TRADERS',
    sap_code: 'NSRE03270',
    sfa_code: 'NSRE03270',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'SANJIBANI ENTERPRISE': {
    dealer_name: 'SANJIBANI ENTERPRISE',
    sap_code: 'NSRE03256',
    sfa_code: 'NSRE03256',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'MAA SARSWATI ENTERPRISES': {
    dealer_name: 'MAA SARSWATI ENTERPRISES',
    sap_code: 'NSRE03289',
    sfa_code: 'NSRE03289',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'S S TRADERS': {
    dealer_name: 'S S TRADERS',
    sap_code: 'NSRE03267',
    sfa_code: 'NSRE03267',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'BANTI IRON STORE': {
    dealer_name: 'BANTI IRON STORE',
    sap_code: 'NSRE11087',
    sfa_code: 'NSRE11087',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  },
  'SRS TRADERS': {
    dealer_name: 'SRS TRADERS',
    sap_code: 'NSRE03269',
    sfa_code: 'NSRE03269',
    dealer_type: 'NON STAR',
    category: 'Prospective'
  }
};

function deterministicProspectCode(name, dealerId) {
  if (dealerId) return `NS-DLR-${dealerId}`;
  const slug = normName(name).replace(/[^A-Z0-9]+/g, '-').slice(0, 24);
  return slug ? `NS-${slug}` : 'NS-PROSPECT';
}

export async function healPlanDealerCodes() {
  console.log('[HealCodes] Starting dealer code healing across sales_plan_details...');

  let totalUpdated = 0;
  for (const [origName, fix] of Object.entries(DEALER_FIXES)) {
    const res = await dbRun(
      `UPDATE sales_plan_details
       SET dealer_name = ?,
           dealer_sap_code = ?,
           dealer_type = ?
       WHERE plan_id = 565
         AND (dealer_name = ? OR dealer_name = ? OR dealer_sap_code LIKE 'C/%' OR dealer_sap_code IS NULL)
         AND (dealer_name = ? OR dealer_name = ?)`,
      [
        fix.dealer_name,
        fix.sap_code,
        fix.dealer_type,
        origName,
        fix.dealer_name,
        origName,
        fix.dealer_name
      ]
    );
    if (res.affectedRows > 0) {
      console.log(`  Updated ${res.affectedRows} visits for "${origName}" -> SAP:${fix.sap_code}`);
      totalUpdated += res.affectedRows;
    }
  }

  // Heal any other rows in sales_plan_details with legacy C/%, PR-%, DLR_%, or NULL/empty SAP codes
  const otherWeird = await dbAll(`
    SELECT id, dealer_id, dealer_name, dealer_sap_code, dealer_type
    FROM sales_plan_details
    WHERE dealer_sap_code LIKE 'C/%'
       OR dealer_sap_code LIKE 'PR-%'
       OR dealer_sap_code LIKE 'DLR_%'
       OR dealer_sap_code IS NULL
       OR dealer_sap_code = ''
  `);

  if (otherWeird.length > 0) {
    console.log(`[HealCodes] Found ${otherWeird.length} unmapped/legacy rows in sales_plan_details. Resolving from master tables...`);
    const masterRows = await dbAll(
      `SELECT id, dealer_id, sap_code, sfa_code, rssd_code, dealer_name, dealer_type FROM master_dealers`
    ).catch(() => []);
    const targetRows = await dbAll(
      `SELECT id, dealer_id, sap_code, sfa_code, dealer_name FROM dealer_visit_targets`
    ).catch(() => []);

    const lookup = new Map();
    const register = (kStr, info) => {
      const k = key(kStr);
      if (k && !lookup.has(k)) lookup.set(k, info);
    };

    for (const m of masterRows) {
      const sap = norm(m.sap_code) || norm(m.sfa_code);
      if (!sap) continue;
      const info = { sap, dealer_type: m.dealer_type || '' };
      if (m.id) register(`ID_${m.id}`, info);
      if (m.dealer_id) register(m.dealer_id, info);
      if (m.sap_code) register(m.sap_code, info);
      if (m.sfa_code) register(m.sfa_code, info);
      if (m.rssd_code) register(m.rssd_code, info);
      if (m.dealer_name) {
        register(m.dealer_name, info);
        register(normName(m.dealer_name), info);
        const codeInName = String(m.dealer_name).match(/\((RSS[BD]?\w+|SD[A-Z0-9]+|[A-Z0-9_-]{4,})\)/i);
        if (codeInName) register(codeInName[1], info);
      }
    }

    for (const t of targetRows) {
      const sap = norm(t.sap_code) || norm(t.sfa_code);
      if (!sap) continue;
      const info = { sap, dealer_type: '' };
      if (t.id) register(`ID_${t.id}`, info);
      if (t.dealer_id) register(t.dealer_id, info);
      if (t.sap_code) register(t.sap_code, info);
      if (t.sfa_code) register(t.sfa_code, info);
      if (t.dealer_name) {
        register(t.dealer_name, info);
        register(normName(t.dealer_name), info);
        const codeInName = String(t.dealer_name).match(/\((RSS[BD]?\w+|SD[A-Z0-9]+|[A-Z0-9_-]{4,})\)/i);
        if (codeInName) register(codeInName[1], info);
      }
    }

    for (const row of otherWeird) {
      const codeInName = String(row.dealer_name || '').match(/\((RSS[BD]?\w+|SD[A-Z0-9]+|[A-Z0-9_-]{4,})\)/i);
      const match = (row.dealer_id && lookup.get(key(`ID_${row.dealer_id}`)))
                 || (row.dealer_id && lookup.get(key(row.dealer_id)))
                 || (row.dealer_name && lookup.get(key(row.dealer_name)))
                 || (codeInName && lookup.get(key(codeInName[1])))
                 || (row.dealer_name && lookup.get(normName(row.dealer_name)));

      const resolvedCode = match ? match.sap : deterministicProspectCode(row.dealer_name, row.dealer_id);
      const resolvedType = (match && match.dealer_type) ? match.dealer_type : (row.dealer_type || 'PROSPECTIVE');

      if (resolvedCode !== row.dealer_sap_code) {
        await dbRun(
          `UPDATE sales_plan_details
           SET dealer_sap_code = ?,
               dealer_type = COALESCE(NULLIF(dealer_type, ''), ?)
           WHERE id = ?`,
          [resolvedCode, resolvedType, row.id]
        );
        totalUpdated++;
      }
    }
  }

  // Update src/data/abhijitDamC1Visits.json
  const visitsJsonPath = path.resolve(__dirname, '../data/abhijitDamC1Visits.json');
  if (fs.existsSync(visitsJsonPath)) {
    const visits = JSON.parse(fs.readFileSync(visitsJsonPath, 'utf8'));
    let fileUpdated = 0;
    for (const v of visits) {
      const fix = DEALER_FIXES[v.dealer_name] || (v.dealer_name ? DEALER_FIXES[v.dealer_name.trim()] : null);
      if (fix) {
        v.dealer_name = fix.dealer_name;
        v.dealer_sap_code = fix.sap_code;
        v.dealer_type = fix.dealer_type;
        fileUpdated++;
      } else if (v.dealer_sap_code && v.dealer_sap_code.startsWith('C/')) {
        v.dealer_sap_code = v.dealer_sap_code.replace('C/', 'NS-');
        fileUpdated++;
      }
    }
    if (fileUpdated > 0) {
      fs.writeFileSync(visitsJsonPath, JSON.stringify(visits, null, 2), 'utf8');
      console.log(`[HealCodes] ✓ Updated ${fileUpdated} visits in abhijitDamC1Visits.json`);
    }
  }

  console.log(`[HealCodes] ✓ Total database visits healed: ${totalUpdated}`);
  return { totalUpdated };
}

// Run standalone if called directly
if (process.argv[1] && process.argv[1].endsWith('heal-plan-dealer-codes.js')) {
  healPlanDealerCodes()
    .then(r => console.log('Done:', r))
    .catch(console.error)
    .finally(() => process.exit());
}
