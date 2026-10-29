import { dbRun, dbAll, dbGet } from '../config/database.js';

/**
 * Migration to create and initialize master_zone_zh_mapping table.
 */
export async function runZonalHeadMigration() {
  console.log('[Migration] Creating master_zone_zh_mapping table if not exists...');

  await dbRun(`
    CREATE TABLE IF NOT EXISTS master_zone_zh_mapping (
      id INT AUTO_INCREMENT PRIMARY KEY,
      zone_code VARCHAR(50) NOT NULL UNIQUE,
      zone_name VARCHAR(100) NOT NULL,
      zh_name VARCHAR(255) NOT NULL,
      zh_code VARCHAR(100) NOT NULL,
      emp_code VARCHAR(50) NOT NULL,
      designation VARCHAR(150),
      level VARCHAR(50),
      state VARCHAR(100),
      area_keywords TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_mzzm_zone (zone_code),
      INDEX idx_mzzm_zh_code (zh_code),
      INDEX idx_mzzm_emp_code (emp_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Ensure zone column exists in master_dealers and master_dealer_so_mapping
  const checkCol = async (tbl, col, def) => {
    try {
      const cols = await dbAll(`SHOW COLUMNS FROM ${tbl}`);
      if (!cols.some(c => c.Field === col)) {
        await dbRun(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`);
        console.log(`[Migration] Added ${col} to ${tbl}`);
      }
    } catch (err) {
      console.warn(`[Migration] Could not check/add ${tbl}.${col}:`, err.message);
    }
  };

  await checkCol('master_dealers', 'zone', 'VARCHAR(100) NULL AFTER region');
  await checkCol('master_dealers', 'zh_name', 'VARCHAR(255) NULL');
  await checkCol('master_dealers', 'zh_code', 'VARCHAR(100) NULL');
  await checkCol('master_dealer_so_mapping', 'zone', 'VARCHAR(100) NULL AFTER region');
  await checkCol('master_dealer_so_mapping', 'zh_name', 'VARCHAR(255) NULL');
  await checkCol('master_dealer_so_mapping', 'zh_code', 'VARCHAR(100) NULL');
  await checkCol('dealer_visit_targets', 'zh_name', 'VARCHAR(255) NULL');
  await checkCol('dealer_visit_targets', 'zh_code', 'VARCHAR(100) NULL');

  // Seed default zone to Zonal Head mappings derived from employee_master
  const seedZones = [
    {
      zone_code: 'NE2',
      zone_name: 'North East 2 (Tripura, Mizoram, Barak Valley)',
      zh_name: 'BRIJESH SINGH',
      zh_code: '11001891',
      emp_code: 'E1720',
      designation: 'General Manager',
      level: 'L5',
      state: 'ASSAM',
      area_keywords: 'AGARTALA, UDAIPUR, SILCHAR, TRIPURA, MIZORAM, CACHAR, KARIMGANJ, HAILAKANDI, DHARMANAGAR, KAILASHAHAR, BELONIA, AMBASSA, TELIAMURA, BISHALGARH, SANTIRBAZAR, KHOWAI, MOHANPUR'
    },
    {
      zone_code: 'NE1',
      zone_name: 'North East 1 (Assam, Meghalaya, Nagaland, Manipur)',
      zh_name: 'TARAK NATH GHOSH',
      zh_code: '1100077',
      emp_code: 'E0174',
      designation: 'General Manager',
      level: 'L5',
      state: 'ASSAM',
      area_keywords: 'GUWAHATI, DHEMAJI, DIBRUGARH, GOLAGHAT, HOJAI, JORHAT, KARBI ANGLONG, LAKHIMPUR, MANIPUR, NAGALAND, SHILLONG, TEZPUR, TINSUKIA, NAGAON, BONGAIGAON, BARPETA, NALBARI, MORIGAON, SIVASAGAR, GOALPARA, KOKRAJHAR, DHUBRI, MANGALDOI, MEGHALAYA'
    },
    {
      zone_code: 'NB1',
      zone_name: 'North Bengal 1 (Siliguri, Jalpaiguri, Coochbehar, Sikkim)',
      zh_name: 'DIBYAJYOTI GUHA',
      zh_code: '1100380',
      emp_code: 'E0259',
      designation: 'GM',
      level: 'branding',
      state: 'NORTH BENGAL',
      area_keywords: 'ALIPURDUAR, COOCHBEHAR, DARJEELING HILLS, DARJEELING PLAINS, JALPAIGURI, SIKKIM, SILIGURI, KALIMPONG, GANGTOK, ISLAMPUR, KURSEONG, MIRIK, BIRPARA, JAIGAON, DHUPGURI, MAYNAGURI'
    },
    {
      zone_code: 'NB2',
      zone_name: 'North Bengal 2 (Malda, Dinajpur)',
      zh_name: 'DIBYAJYOTI GUHA',
      zh_code: '1100380',
      emp_code: 'E0259',
      designation: 'GM',
      level: 'branding',
      state: 'NORTH BENGAL',
      area_keywords: 'MALDA, DAKSHIN DINAJPUR, UTTAR DINAJPUR, BALURGHAT, RAIGANJ, BUNYADPUR, CHANICHAL, GAZOLE, HARISCHANDRAPUR, SAMSI'
    },
    {
      zone_code: 'SOUTH BENGAL',
      zone_name: 'South Bengal (Kolkata, Howrah, Hooghly, Burdwan)',
      zh_name: 'ATANU BANERJEE',
      zh_code: '1100144',
      emp_code: 'E0002',
      designation: 'GM',
      level: 'L5',
      state: 'SOUTH BENGAL',
      area_keywords: 'KOLKATA, HOWRAH, HOOGHLY, BURDWAN, MIDNAPORE, SOUTH BENGAL, MURSHIDABAD, NADIA, ASANSOL, DURGAPUR, PURULIA, BANKURA, BIRBHUM, TAMLUK, KHARAGPUR'
    },
    {
      zone_code: 'BIHAR',
      zone_name: 'Bihar (Patna, Muzaffarpur, Bhagalpur, Purnia)',
      zh_name: 'RAJESH SRIVASTAVA',
      zh_code: '1100067',
      emp_code: 'E0003',
      designation: 'GM',
      level: 'L5',
      state: 'BIHAR',
      area_keywords: 'BH-1, BH-2, PATNA, MUZAFFARPUR, BHAGALPUR, PURNIA, KATIHAR, KISHANGANJ, BEGUSARAI, SAHARSA, GAYA, DARBHANGA, MOTIHARI, BETTIAH, CHAPRA, SIWAN, ARRAH, BIHAR SHARIF'
    },
    {
      zone_code: 'NT',
      zone_name: 'Non Trade (Institutional & Projects)',
      zh_name: 'ABHISHEK JOSHI',
      zh_code: '11001694',
      emp_code: 'E1277',
      designation: 'GM',
      level: 'NT',
      state: 'NON TRADE',
      area_keywords: 'NON TRADE, INSTITUTIONAL, PROJECTS, GOVT, INFRA, BULK'
    }
  ];

  for (const s of seedZones) {
    await dbRun(`
      INSERT INTO master_zone_zh_mapping (
        zone_code, zone_name, zh_name, zh_code, emp_code, designation, level, state, area_keywords, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        zone_name = VALUES(zone_name),
        zh_name = VALUES(zh_name),
        zh_code = VALUES(zh_code),
        emp_code = VALUES(emp_code),
        designation = VALUES(designation),
        level = VALUES(level),
        state = VALUES(state),
        area_keywords = VALUES(area_keywords),
        updated_at = NOW()
    `, [
      s.zone_code, s.zone_name, s.zh_name, s.zh_code, s.emp_code,
      s.designation, s.level, s.state, s.area_keywords
    ]);
  }

  console.log('[Migration] ✓ Initialized master_zone_zh_mapping table with canonical zones.');
}

if (process.argv[1]?.endsWith('migrate-zonal-heads.js')) {
  runZonalHeadMigration()
    .then(() => {
      console.log('Zonal Head migration finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
