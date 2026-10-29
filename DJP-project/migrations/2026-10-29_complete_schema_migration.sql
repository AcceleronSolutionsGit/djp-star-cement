-- ==============================================================================
-- Star Cement PJP / DJP Automation Platform
-- Complete Database Schema Migration & Business Rules Seed Script
-- Date: 2026-10-29
-- Database: star_one_djp
-- ==============================================================================

USE star_one_djp;

-- ------------------------------------------------------------------------------
-- 1. Table: master_customer_coordinates
-- Stores SFA Customer Base GPS Coordinates & Route Names (API Synced)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS master_customer_coordinates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dns_customer_code VARCHAR(100) NOT NULL UNIQUE,
  customer_code VARCHAR(100) NULL,
  display_code VARCHAR(100) NULL,
  customer_name VARCHAR(255) NULL,
  customer_type VARCHAR(100) NULL,
  phone_no VARCHAR(50) NULL,
  route_name VARCHAR(255) NULL,
  latitude DOUBLE NULL,
  longitude DOUBLE NULL,
  has_coordinates TINYINT(1) DEFAULT 0,
  branch_code VARCHAR(50) NULL,
  state_code VARCHAR(100) NULL,
  zone VARCHAR(100) NULL,
  address TEXT NULL,
  pin VARCHAR(20) NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mcc_dns (dns_customer_code),
  INDEX idx_mcc_cust (customer_code),
  INDEX idx_mcc_coords (has_coordinates)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 2. Table: employee_master
-- Stores Full Employee Hierarchy (L1-L7, Zonal Heads, RSMs, ASMs, SOs)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_master (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emp_code VARCHAR(50) NOT NULL UNIQUE,
  dns_emp_code VARCHAR(50) NULL,
  emp_name VARCHAR(255) NULL,
  dob VARCHAR(50) NULL,
  acedns VARCHAR(10) NULL,
  branch_code VARCHAR(500) NULL,
  doj VARCHAR(50) NULL,
  lower_leaves LONGTEXT NULL,
  reporting_to VARCHAR(500) NULL,
  vertical_value VARCHAR(100) NULL,
  email VARCHAR(255) NULL,
  phone_no VARCHAR(50) NULL,
  hq VARCHAR(100) NULL,
  sale_access VARCHAR(50) NULL,
  designation VARCHAR(150) NULL,
  district VARCHAR(100) NULL,
  state VARCHAR(100) NULL,
  zone VARCHAR(100) NULL,
  region VARCHAR(100) NULL,
  app_access VARCHAR(10) NULL,
  functionality VARCHAR(100) NULL,
  functionality_rel_val VARCHAR(100) NULL,
  level VARCHAR(50) NULL,
  acedns_changed_date VARCHAR(50) NULL,
  download_time VARCHAR(50) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_em_dns_emp_code (dns_emp_code),
  INDEX idx_em_emp_name (emp_name),
  INDEX idx_em_designation (designation),
  INDEX idx_em_zone (zone),
  INDEX idx_em_state (state),
  INDEX idx_em_acedns (acedns),
  INDEX idx_em_reporting_to (reporting_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 3. Table: master_zone_zh_mapping
-- Canonical Zone to Zonal Head Hierarchy Resolution Matrix
-- ------------------------------------------------------------------------------
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Canonical Corporate Zones & Zonal Heads
INSERT INTO master_zone_zh_mapping (zone_code, zone_name, zh_name, zh_code, emp_code, designation, level, state, area_keywords)
VALUES
('NE2', 'Northeast 2 (Tripura, Barak Valley, Mizoram)', 'BRIJESH SINGH', '11001891', 'E1720', 'Zonal Head - Northeast 2', 'L7', 'TRIPURA', 'AGARTALA,SILCHAR,DHARMANAGAR,UDAIPUR,AIZAWL,KARIMGANJ,HAILAKANDI,TRIPURA,BARAK'),
('NE1', 'Northeast 1 (Assam, Meghalaya, Nagaland)', 'TARAK NATH GHOSH', '1100077', 'E0174', 'Zonal Head - Northeast 1', 'L7', 'ASSAM', 'GUWAHATI,NAGAON,JORHAT,DIBRUGARH,TINSUKIA,TEZPUR,BONGAIGAON,SHILLONG,DIMAPUR,KOHIMA,ASSAM'),
('NB1', 'North Bengal 1 (Siliguri, Jalpaiguri, Coochbehar)', 'DIBYAJYOTI GUHA', '1100380', 'E0259', 'Zonal Head - North Bengal 1', 'L7', 'WEST BENGAL', 'SILIGURI,JALPAIGURI,COOCHBEHAR,ALIPURDUAR,DARJEELING,KALIMPONG,SIKKIM,GANGTOK,NORTH BENGAL'),
('NB2', 'North Bengal 2 (Malda, Dinajpur)', 'DIBYAJYOTI GUHA', '1100380', 'E0259', 'Zonal Head - North Bengal 2', 'L7', 'WEST BENGAL', 'MALDA,RAIGANJ,BALURGHAT,UTTAR DINAJPUR,DAKSHIN DINAJPUR'),
('SOUTH BENGAL', 'South Bengal & Kolkata Metro', 'ATANU BANERJEE', '1100144', 'E0002', 'Zonal Head - South Bengal', 'L7', 'WEST BENGAL', 'KOLKATA,HOWRAH,HOOGHLY,BURDWAN,ASANSOL,DURGAPUR,MEDINIPUR,KHARAGPUR,SOUTH BENGAL'),
('BIHAR', 'Bihar (Patna, Muzaffarpur, Bhagalpur, Purnia)', 'RAJESH SRIVASTAVA', '1100067', 'E0003', 'Zonal Head - Bihar', 'L7', 'BIHAR', 'PATNA,GAYA,MUZAFFARPUR,BHAGALPUR,PURNIA,DARBHANGA,BEGUSARAI,BIHAR'),
('NT', 'Non Trade / Institutional Business', 'ABHISHEK JOSHI', '11001694', 'E1277', 'Zonal Head - Non Trade', 'L7', 'PAN INDIA', 'INSTITUTIONAL,PROJECTS,INFRA,GOVERNMENT,KEY ACCOUNTS')
ON DUPLICATE KEY UPDATE 
  zh_name = VALUES(zh_name),
  zh_code = VALUES(zh_code),
  emp_code = VALUES(emp_code),
  designation = VALUES(designation);

-- ------------------------------------------------------------------------------
-- 4. Alterations: master_dealers
-- ------------------------------------------------------------------------------
ALTER TABLE master_dealers ADD COLUMN IF NOT EXISTS latitude DOUBLE NULL;
ALTER TABLE master_dealers ADD COLUMN IF NOT EXISTS longitude DOUBLE NULL;
ALTER TABLE master_dealers ADD COLUMN IF NOT EXISTS route_name VARCHAR(255) NULL;
ALTER TABLE master_dealers ADD COLUMN IF NOT EXISTS has_coordinates TINYINT(1) DEFAULT 0;
ALTER TABLE master_dealers ADD COLUMN IF NOT EXISTS zone VARCHAR(100) NULL AFTER region;
ALTER TABLE master_dealers ADD COLUMN IF NOT EXISTS zh_name VARCHAR(255) NULL;
ALTER TABLE master_dealers ADD COLUMN IF NOT EXISTS zh_code VARCHAR(100) NULL;

-- ------------------------------------------------------------------------------
-- 5. Alterations: master_dealer_so_mapping
-- ------------------------------------------------------------------------------
ALTER TABLE master_dealer_so_mapping ADD COLUMN IF NOT EXISTS zone VARCHAR(100) NULL AFTER region;
ALTER TABLE master_dealer_so_mapping ADD COLUMN IF NOT EXISTS zh_name VARCHAR(255) NULL;
ALTER TABLE master_dealer_so_mapping ADD COLUMN IF NOT EXISTS zh_code VARCHAR(100) NULL;

-- ------------------------------------------------------------------------------
-- 6. Alterations: dealer_visit_targets
-- ------------------------------------------------------------------------------
ALTER TABLE dealer_visit_targets ADD COLUMN IF NOT EXISTS zh_name VARCHAR(255) NULL;
ALTER TABLE dealer_visit_targets ADD COLUMN IF NOT EXISTS zh_code VARCHAR(100) NULL;

-- ------------------------------------------------------------------------------
-- 7. Alterations: sales_plan_details (Backdated Tracking & Heuristic Routes)
-- ------------------------------------------------------------------------------
ALTER TABLE sales_plan_details ADD COLUMN IF NOT EXISTS latitude DOUBLE NULL;
ALTER TABLE sales_plan_details ADD COLUMN IF NOT EXISTS longitude DOUBLE NULL;
ALTER TABLE sales_plan_details ADD COLUMN IF NOT EXISTS distance_from_prev_km DOUBLE DEFAULT 0;
ALTER TABLE sales_plan_details ADD COLUMN IF NOT EXISTS route_name VARCHAR(255) NULL;
ALTER TABLE sales_plan_details ADD COLUMN IF NOT EXISTS is_backdated_edit TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE sales_plan_details ADD COLUMN IF NOT EXISTS edited_after_date TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE sales_plan_details ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- ------------------------------------------------------------------------------
-- 8. Business Rules Configuration (Edit Windows & Working Saturdays)
-- ------------------------------------------------------------------------------
INSERT INTO business_rules (rule_key, rule_name, rule_value, data_type, description, updated_at)
VALUES 
('c1_edit_start_day', 'Cycle 1 Edit Window Start Day', '1', 'INTEGER', 'Day of month when C1 plan editing opens (1-5th)', NOW()),
('c1_edit_end_day',   'Cycle 1 Edit Window End Day',   '5', 'INTEGER', 'Day of month when C1 plan editing closes (1-5th)', NOW()),
('c2_edit_start_day', 'Cycle 2 Edit Window Start Day', '15', 'INTEGER', 'Day of month when C2 plan editing opens (15-17th)', NOW()),
('c2_edit_end_day',   'Cycle 2 Edit Window End Day',   '17', 'INTEGER', 'Day of month when C2 plan editing closes (15-17th)', NOW()),
('all_saturdays_working', 'All Saturdays Working', '1', 'INTEGER', 'Flag indicating all Saturdays are full working days (1=Yes, 0=No)', NOW())
ON DUPLICATE KEY UPDATE 
  rule_value = VALUES(rule_value),
  updated_at = NOW();

-- ------------------------------------------------------------------------------
-- 9. Heal Dealer Types (Eliminate Generic 'STAR' -> DEALER vs RSAR)
-- ------------------------------------------------------------------------------
UPDATE master_dealers md
JOIN master_customer_coordinates mcc 
  ON (md.sfa_code IS NOT NULL AND UPPER(TRIM(md.sfa_code)) = UPPER(TRIM(mcc.dns_customer_code)))
  OR (md.sap_code IS NOT NULL AND (UPPER(TRIM(md.sap_code)) = UPPER(TRIM(mcc.dns_customer_code)) OR UPPER(TRIM(md.sap_code)) = UPPER(TRIM(mcc.customer_code))))
SET md.dealer_type = 'RSAR'
WHERE (mcc.customer_type = 'Sub Dealer' OR mcc.customer_type LIKE '%Sub%')
  AND md.dealer_type IN ('STAR', 'DEALER', NULL);

UPDATE master_dealers md
JOIN master_customer_coordinates mcc 
  ON (md.sfa_code IS NOT NULL AND UPPER(TRIM(md.sfa_code)) = UPPER(TRIM(mcc.dns_customer_code)))
  OR (md.sap_code IS NOT NULL AND (UPPER(TRIM(md.sap_code)) = UPPER(TRIM(mcc.dns_customer_code)) OR UPPER(TRIM(md.sap_code)) = UPPER(TRIM(mcc.customer_code))))
SET md.dealer_type = 'DEALER'
WHERE mcc.customer_type IN ('Dealer', 'Exclusive Dealer')
  AND md.dealer_type = 'STAR';

UPDATE master_dealers
SET dealer_type = 'DEALER'
WHERE dealer_type = 'STAR';

UPDATE sales_plan_details spd
JOIN master_dealers md ON (spd.dealer_id = md.id OR spd.dealer_sap_code = md.sap_code)
SET spd.dealer_type = md.dealer_type
WHERE spd.dealer_type = 'STAR' OR spd.dealer_type IS NULL;
