-- ======================================================================
-- STAR CEMENT PJP / DJP AUTOMATION PLATFORM - MYSQL SCHEMA
-- DATABASE: star_one_djp (XAMPP MySQL / MariaDB Compatible)
-- ======================================================================

-- 0. Authentication Users Table
CREATE TABLE IF NOT EXISTS app_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'SO') NOT NULL DEFAULT 'SO',
    emp_code VARCHAR(100),
    is_active TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    INDEX idx_auth_username (username),
    INDEX idx_auth_emp_code (emp_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 0b. Generation Runs Table (batch isolation)
CREATE TABLE IF NOT EXISTS generation_runs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    generation_code VARCHAR(100) NOT NULL UNIQUE,
    report_month VARCHAR(20) NOT NULL,
    cycle_code VARCHAR(20) NOT NULL,
    dealer_mapping_batch_code VARCHAR(100),
    sales_history_batch_codes TEXT,
    prospect_batch_code VARCHAR(100),
    sfa_feedback_batch_code VARCHAR(100),
    rules_snapshot TEXT,
    status VARCHAR(50) DEFAULT 'PENDING',
    pjp_dealer_count INT DEFAULT 0,
    pjp_visit_requirement INT DEFAULT 0,
    djp_scheduled_count INT DEFAULT 0,
    djp_unallocated_count INT DEFAULT 0,
    capacity_violated TINYINT(1) DEFAULT 0,
    validation_errors TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    INDEX idx_gen_month_cycle (report_month, cycle_code),
    INDEX idx_gen_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1. Upload Batches Table
CREATE TABLE IF NOT EXISTS upload_batches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_code VARCHAR(100) NOT NULL UNIQUE,
    file_type VARCHAR(100) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500),
    period_month VARCHAR(20),
    total_rows INT DEFAULT 0,
    valid_rows INT DEFAULT 0,
    invalid_rows INT DEFAULT 0,
    duplicate_rows INT DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    error_summary TEXT,
    warning_summary TEXT,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_upload_status (status),
    INDEX idx_upload_type (file_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Master Employees (SO, ASM, RSM, ZH)
CREATE TABLE IF NOT EXISTS master_employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    emp_code VARCHAR(100) UNIQUE,
    emp_name VARCHAR(255) NOT NULL,
    designation VARCHAR(100),
    zone VARCHAR(100),
    region VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_emp_code (emp_code),
    INDEX idx_emp_name (emp_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Master Dealers & Prospective Customers
CREATE TABLE IF NOT EXISTS master_dealers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dealer_id VARCHAR(36) UNIQUE,
    dealer_type VARCHAR(50) NOT NULL DEFAULT 'STAR',
    sap_code VARCHAR(100) NULL,
    sfa_code VARCHAR(100),
    rssd_code VARCHAR(100),
    dealer_name VARCHAR(255) NOT NULL,
    normalized_dealer_name VARCHAR(255),
    linked_dealer_code VARCHAR(100),
    linked_dealer_name VARCHAR(255),
    zone VARCHAR(100),
    region VARCHAR(100),
    area VARCHAR(100),
    normalized_area VARCHAR(100),
    taluka VARCHAR(100),
    block VARCHAR(100),
    normalized_block VARCHAR(100),
    counter_potential DOUBLE DEFAULT 0,
    expected_sale DOUBLE DEFAULT 0,
    counter_strategy VARCHAR(100),
    doa DATE NULL,
    match_status VARCHAR(50),
    match_method VARCHAR(50),
    match_confidence DOUBLE,
    batch_code VARCHAR(100) NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dealer_uuid (dealer_id),
    INDEX idx_dealer_sap (sap_code),
    INDEX idx_dealer_sfa (sfa_code),
    INDEX idx_dealer_rssd (rssd_code),
    INDEX idx_dealer_name (dealer_name),
    INDEX idx_dealer_norm_name (normalized_dealer_name),
    INDEX idx_dealer_norm_composite (normalized_dealer_name, normalized_area, normalized_block),
    INDEX idx_dealer_status (status),
    INDEX idx_dealer_area (area),
    INDEX idx_dealer_zone (zone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3b. Matching Audit Table
CREATE TABLE IF NOT EXISTS matching_audit (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_code VARCHAR(100) NOT NULL,
    source_file VARCHAR(255),
    source_sheet VARCHAR(255),
    source_row INT,
    source_type VARCHAR(100),
    dealer_id VARCHAR(36),
    sap_code VARCHAR(100),
    sfa_code VARCHAR(100),
    dealer_name VARCHAR(255),
    match_method VARCHAR(50),
    match_confidence DOUBLE,
    match_status VARCHAR(50),
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_batch (batch_code),
    INDEX idx_audit_dealer (dealer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Dealer to SO Mapping
CREATE TABLE IF NOT EXISTS master_dealer_so_mapping (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dealer_id INT,
    sap_code VARCHAR(100),
    dealer_name VARCHAR(255),
    area VARCHAR(100),
    region VARCHAR(100),
    so_name VARCHAR(255) NOT NULL,
    so_emp_code VARCHAR(100) NOT NULL,
    asm_name VARCHAR(255),
    rsm_name VARCHAR(255),
    zh_name VARCHAR(255),
    batch_code VARCHAR(100) NULL,
    block VARCHAR(100) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_map_dealer_id (dealer_id),
    INDEX idx_map_sap (sap_code),
    INDEX idx_map_so_code (so_emp_code),
    INDEX idx_map_so_name (so_name),
    INDEX idx_map_area (area),
    INDEX idx_map_region (region)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Period-wise Sales History
CREATE TABLE IF NOT EXISTS sales_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sap_code VARCHAR(100),
    rssd_code VARCHAR(100),
    linked_dealer_code VARCHAR(100),
    linked_dealer_name VARCHAR(255),
    sub_dealer_name VARCHAR(255),
    zone VARCHAR(100),
    period_year_month VARCHAR(20) NOT NULL,
    quantity_mt DOUBLE DEFAULT 0,
    batch_code VARCHAR(100) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sales_sap (sap_code),
    INDEX idx_sales_rssd (rssd_code),
    INDEX idx_sales_linked (linked_dealer_code),
    INDEX idx_sales_period (period_year_month),
    UNIQUE INDEX idx_sales_unique (sap_code, rssd_code, linked_dealer_code, period_year_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. SFA Visit Execution Logs (Feedback Loop)
CREATE TABLE IF NOT EXISTS visit_execution_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    visit_date DATE NOT NULL,
    customer_code VARCHAR(100) NOT NULL,
    customer_name VARCHAR(255),
    customer_type VARCHAR(100),
    route VARCHAR(255),
    branch VARCHAR(255),
    employee_code VARCHAR(100) NOT NULL,
    employee_name VARCHAR(255),
    check_in_time VARCHAR(50),
    check_out_time VARCHAR(50),
    duration VARCHAR(50),
    visit_status VARCHAR(50),
    purpose_of_visit TEXT,
    remarks TEXT,
    batch_code VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_visit_date (visit_date),
    INDEX idx_visit_cust (customer_code),
    INDEX idx_visit_emp (employee_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Business Rules & Engine Parameters
CREATE TABLE IF NOT EXISTS business_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rule_key VARCHAR(100) UNIQUE NOT NULL,
    rule_name VARCHAR(255) NOT NULL,
    rule_value TEXT NOT NULL,
    data_type VARCHAR(50) DEFAULT 'STRING',
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_rule_key (rule_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Dealer Level Target Visits per Role
CREATE TABLE IF NOT EXISTS dealer_visit_targets (
    generation_run_code VARCHAR(100),
    id INT AUTO_INCREMENT PRIMARY KEY,
    period_month VARCHAR(20) NOT NULL,
    cycle_code VARCHAR(20) NOT NULL,
    dealer_id INT,
    dealer_name VARCHAR(255) NOT NULL,
    sap_code VARCHAR(100),
    sfa_code VARCHAR(100),
    area VARCHAR(100),
    zone VARCHAR(100),
    category VARCHAR(50) NOT NULL,
    dealer_status VARCHAR(100) NOT NULL,
    so_name VARCHAR(255),
    so_emp_code VARCHAR(100),
    so_visits DOUBLE DEFAULT 0,
    asm_visits DOUBLE DEFAULT 0,
    rsm_visits DOUBLE DEFAULT 0,
    zh_visits DOUBLE DEFAULT 0,
    total_visits DOUBLE DEFAULT 0,
    so_visits_pct DOUBLE DEFAULT 0,
    asm_visits_pct DOUBLE DEFAULT 0,
    rsm_visits_pct DOUBLE DEFAULT 0,
    zh_visits_pct DOUBLE DEFAULT 0,
    batch_code VARCHAR(100) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_target_period_cycle (period_month, cycle_code),
    INDEX idx_target_so_code (so_emp_code),
    INDEX idx_target_sap (sap_code),
    INDEX idx_target_status (dealer_status),
    INDEX idx_target_area (area),
    INDEX idx_target_zone (zone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Multi-Role Generated DJP Recommendations
CREATE TABLE IF NOT EXISTS djp_recommendations (
    generation_run_code VARCHAR(100),
    id INT AUTO_INCREMENT PRIMARY KEY,
    role_type VARCHAR(50) NOT NULL DEFAULT 'SO',
    cycle_code VARCHAR(20) NOT NULL,
    period_month VARCHAR(20) NOT NULL,
    emp_code VARCHAR(100) NOT NULL,
    emp_name VARCHAR(255) NOT NULL,
    visit_date DATE NOT NULL,
    visit_sequence INT NOT NULL,
    dealer_sap_code VARCHAR(100),
    dealer_sfa_code VARCHAR(100),
    dealer_name VARCHAR(255) NOT NULL,
    dealer_type VARCHAR(50) NOT NULL,
    category VARCHAR(50),
    dealer_status VARCHAR(100),
    market_strategy VARCHAR(50),
    priority_score DOUBLE DEFAULT 0,
    required_visits DOUBLE DEFAULT 1,
    recommendation_reason TEXT,
    plan_status VARCHAR(50) DEFAULT 'DRAFT',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_djp_role (role_type),
    INDEX idx_djp_emp (emp_code),
    INDEX idx_djp_date (visit_date),
    INDEX idx_djp_period_cycle (period_month, cycle_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Sales Plans
CREATE TABLE IF NOT EXISTS sales_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    emp_code VARCHAR(100) NOT NULL,
    emp_name VARCHAR(255) NOT NULL,
    period_month VARCHAR(20) NOT NULL,
    status VARCHAR(50) DEFAULT 'DRAFT',
    submitted_at DATETIME NULL,
    approved_by VARCHAR(100) NULL,
    approved_at DATETIME NULL,
    remarks TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_plan_emp (emp_code),
    INDEX idx_plan_period (period_month),
    INDEX idx_plan_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Sales Plan Details
CREATE TABLE IF NOT EXISTS sales_plan_details (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plan_id INT NOT NULL,
    visit_date DATE NOT NULL,
    dealer_id INT NULL,
    dealer_sap_code VARCHAR(100) NULL,
    dealer_name VARCHAR(255) NOT NULL,
    dealer_type VARCHAR(50) NULL,
    purpose_of_visit TEXT NULL,
    sequence INT DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_detail_plan (plan_id),
    INDEX idx_detail_date (visit_date),
    INDEX idx_detail_sap (dealer_sap_code),
    CONSTRAINT fk_plan_details_plan FOREIGN KEY (plan_id) REFERENCES sales_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Plan Approvals Log
CREATE TABLE IF NOT EXISTS plan_approvals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plan_id INT NOT NULL,
    action_by VARCHAR(100) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    remarks TEXT NULL,
    action_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_appr_plan (plan_id),
    CONSTRAINT fk_plan_approvals_plan FOREIGN KEY (plan_id) REFERENCES sales_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
