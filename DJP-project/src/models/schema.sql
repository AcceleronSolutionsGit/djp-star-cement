-- 0. Authentication Users Table
CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'SO', -- 'admin' or 'SO'
    emp_code TEXT, -- links to master_employees if it's an SO
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
);

-- Upload Batches Table
CREATE TABLE IF NOT EXISTS upload_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_code TEXT NOT NULL UNIQUE,
    file_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    total_rows INTEGER DEFAULT 0,
    valid_rows INTEGER DEFAULT 0,
    invalid_rows INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING',
    error_summary TEXT,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Master Employees (SO, ASM, RSM, ZH)
CREATE TABLE IF NOT EXISTS master_employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_code TEXT UNIQUE,
    emp_name TEXT NOT NULL,
    designation TEXT, -- SO/SE, ASM, RSM, ZH
    zone TEXT,
    region TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Master Dealers & Prospective Customers
--
-- SOURCE SEPARATION COLUMNS:
--   dm_area         ← Dealer Mapping Area   (ONLY written by dealer-mapping.importer)
--   dm_sap_code     ← Dealer Mapping SAP    (ONLY written by dealer-mapping.importer)
--   dm_customer_code← Dealer Mapping Cust.  (ONLY written by dealer-mapping.importer)
--   dm_sfa_code     ← Dealer Mapping SFA    (ONLY written by dealer-mapping.importer)
--   sbg_potential   ← SBG Potential         (ONLY written by sbg.importer, NULL if not in SBG)
--   sbg_block       ← SBG Block             (ONLY written by sbg.importer, NULL if not in SBG)
--   sbg_status      ← SBG match status      ('SBG_MATCHED' or 'SBG_NOT_FOUND')
--   rsar_status     ← RSAR match status     ('RSAR_MATCHED' or 'RSAR_NOT_FOUND')
--   dp_status       ← DP match status       ('DP_MATCHED' or 'DP_NOT_FOUND')
--   prospect_status ← Prospect match        ('PROSPECT_MATCHED' or 'PROSPECT_NOT_FOUND')
--
-- NULL vs ZERO:
--   sbg_potential NULL = dealer not found in SBG (potential UNKNOWN)
--   sbg_potential 0    = dealer found in SBG with explicitly zero potential
-- =============================================================================
CREATE TABLE IF NOT EXISTS master_dealers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealer_type TEXT NOT NULL DEFAULT 'DEALER', -- DEALER, NON-STAR, INFLUENCER, SUB-DEALER, RSAR
    dealer_id TEXT,
    sap_code TEXT,
    sfa_code TEXT,
    rssd_code TEXT,
    dealer_name TEXT NOT NULL,
    normalized_dealer_name TEXT,
    linked_dealer_code TEXT,
    linked_dealer_name TEXT,
    zone TEXT,
    region TEXT,
    area TEXT,                    -- General area (legacy; use dm_area for authoritative)
    normalized_area TEXT,
    branch TEXT,
    taluka TEXT,

    -- Dealer Mapping AUTHORITATIVE columns (written ONLY by dealer-mapping.importer)
    dm_area TEXT,                 -- Authoritative Area from Dealer Mapping
    dm_sap_code TEXT,             -- Authoritative SAP CODE from Dealer Mapping
    dm_customer_code TEXT,        -- Authoritative Customer CODE from Dealer Mapping
    dm_sfa_code TEXT,             -- Authoritative SFA CODE from Dealer Mapping

    -- SBG AUTHORITATIVE columns (written ONLY by sbg.importer, NULL = not in SBG)
    sbg_potential REAL,           -- SBG Potential (NULL if not found in SBG)
    sbg_block TEXT,               -- SBG Block     (NULL if not found in SBG)
    sbg_status TEXT DEFAULT 'SBG_NOT_FOUND',

    -- Source match status columns
    prospect_status TEXT DEFAULT 'PROSPECT_NOT_FOUND',
    rsar_status TEXT DEFAULT 'RSAR_NOT_FOUND',
    dp_status TEXT DEFAULT 'DP_NOT_FOUND',

    -- Legacy columns (kept for backward compatibility)
    counter_potential REAL DEFAULT 0,
    expected_sale REAL DEFAULT 0,
    counter_strategy TEXT,
    block TEXT,                   -- DM block (NOT sbg_block)
    normalized_block TEXT,
    territory_code TEXT,
    territory_name TEXT,
    current_sales REAL DEFAULT 0, -- Stale; authoritative value computed from sales_history at PJP time
    status TEXT DEFAULT 'ACTIVE',

    -- Hierarchy
    so_name TEXT,
    so_emp_code TEXT,
    asm_name TEXT,
    asm_code TEXT,
    rsm_name TEXT,
    rsm_code TEXT,
    zh_name TEXT,
    zh_code TEXT,

    -- Matching metadata
    match_status TEXT,
    match_method TEXT,
    match_confidence REAL,
    doa DATE,
    batch_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Dealer to SO Mapping
CREATE TABLE IF NOT EXISTS master_dealer_so_mapping (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealer_id INTEGER,
    sap_code TEXT,
    dealer_name TEXT,
    area TEXT,
    branch TEXT,
    region TEXT,
    so_name TEXT NOT NULL,
    so_emp_code TEXT NOT NULL,
    asm_name TEXT,
    asm_code TEXT,
    rsm_name TEXT,
    rsm_code TEXT,
    zh_name TEXT,
    zh_code TEXT,
    batch_code TEXT,
    block TEXT,                   -- Dealer Mapping block (NOT sbg_block)
    territory_code TEXT,
    territory_name TEXT,
    linked_dealer_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(dealer_id) REFERENCES master_dealers(id)
);

-- =============================================================================
-- Period-wise RSAR Sales History
-- SOURCE: RSAR / Dealer Sales History Excel
-- IMPORTANT: This table stores RSAR data ONLY.
--            Dealer Performance data goes to dealer_performance_history.
--            Do NOT mix these two sources in this table.
-- =============================================================================
CREATE TABLE IF NOT EXISTS sales_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sap_code TEXT,
    rssd_code TEXT,
    linked_dealer_code TEXT,
    linked_dealer_name TEXT,
    sub_dealer_name TEXT,
    zone TEXT,
    period_year_month TEXT NOT NULL,
    quantity_mt REAL DEFAULT 0,
    batch_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Dealer Performance Monthly History
-- SOURCE: Dealer Performance Excel (SEPARATE from RSAR)
-- This table is completely independent from sales_history.
-- The PJP engine loads these as two separate independent sources.
-- =============================================================================
CREATE TABLE IF NOT EXISTS dealer_performance_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sap_code TEXT,
    dealer_name TEXT,
    period_year_month TEXT NOT NULL,
    quantity_mt REAL DEFAULT 0,
    target_mt REAL DEFAULT 0,
    prorata_target_mt REAL DEFAULT 0,
    batch_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Required by the importer's ON DUPLICATE KEY UPDATE. Without it every upload
    -- appends and loadDealerPerformanceHistory SUMs the copies, so a corrected figure
    -- is added to the old one instead of replacing it.
    UNIQUE (sap_code, period_year_month)
);

-- SFA Visit Execution Logs (Feedback Loop)
CREATE TABLE IF NOT EXISTS visit_execution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_date DATE NOT NULL,
    customer_code TEXT NOT NULL,
    customer_name TEXT,
    customer_type TEXT,
    route TEXT,
    branch TEXT,
    employee_code TEXT NOT NULL,
    employee_name TEXT,
    check_in_time TEXT,
    check_out_time TEXT,
    duration TEXT,
    visit_status TEXT,
    purpose_of_visit TEXT,
    remarks TEXT,
    batch_code TEXT,              -- written by sfa-report.importer.js
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Business Rules & Engine Parameters
CREATE TABLE IF NOT EXISTS business_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_key TEXT UNIQUE NOT NULL,
    rule_name TEXT NOT NULL,
    rule_value TEXT NOT NULL,
    data_type TEXT DEFAULT 'STRING',
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Dealer Level Target Visits per Role (1st Output Requirement)
--
-- COLUMN NOTES:
--   category      = grade (A/B/C/D from area grade calculation)
--   dealer_status = finalCategory (Growing, De-growing, Zero Lifter, Prospective, Churn, Need to Grow)
--   priority      = numeric priorityRank (1 = highest)
--   priority_label= text tier ('High', 'Medium', 'Low')
--   dm_area       = Dealer Mapping Area (authoritative)
--   sbg_block     = SBG Block (authoritative, NULL if not found in SBG)
--   sbg_potential = SBG Potential (authoritative, NULL if not found in SBG)
--   rsar_six_month_avg = 6M average from RSAR only
--   dp_six_month_avg   = 6M average from Dealer Performance only
-- =============================================================================
CREATE TABLE IF NOT EXISTS dealer_visit_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_run_code TEXT,
    period_month TEXT NOT NULL,
    cycle_code TEXT NOT NULL,
    dealer_id INTEGER,
    dealer_name TEXT NOT NULL,
    sap_code TEXT,
    sfa_code TEXT,
    linked_dealer_code TEXT,

    -- Geography
    area TEXT,                    -- = dm_area (Dealer Mapping authoritative)
    dm_area TEXT,                 -- Dealer Mapping Area (dedicated column)
    block TEXT,                   -- = sbg_block
    sbg_block TEXT,               -- SBG Block (dedicated column, NULL if not in SBG)
    branch TEXT,
    zone TEXT,
    region TEXT,
    cust_type TEXT,
    territory_code TEXT,
    territory_name TEXT,

    -- Hierarchy
    so_code TEXT,
    so_name TEXT,
    so_emp_code TEXT,
    asm_name TEXT,
    asm_code TEXT,
    rsm_name TEXT,
    rsm_code TEXT,
    zh_name TEXT,
    zh_code TEXT,

    -- SBG Potential (authoritative, NULL if not found in SBG)
    potential REAL,
    sbg_potential REAL,

    -- RSAR Sales Metrics (from RSAR only, independent of DP)
    previous_sales REAL DEFAULT 0,
    current_sales REAL DEFAULT 0,
    lysm_sales REAL DEFAULT 0,
    rsar_six_month_avg REAL DEFAULT 0,

    -- DP Sales Metrics (from Dealer Performance only, independent of RSAR)
    dp_six_month_avg REAL DEFAULT 0,

    -- Calculation outputs
    final_volume REAL DEFAULT 0,
    score_a REAL DEFAULT 0,
    score_b REAL DEFAULT 31,
    score_c REAL DEFAULT 0,
    total_score REAL DEFAULT 0,
    priority INTEGER DEFAULT 0,   -- numeric rank (1 = highest)
    priority_label TEXT,          -- text tier ('High', 'Medium', 'Low')
    grade TEXT,                   -- area grade (A/B/C/D)

    -- category = grade, dealer_status = finalCategory (legacy column names)
    category TEXT NOT NULL,       -- A, B, C, D
    dealer_status TEXT NOT NULL,  -- Growing, De-growing, Zero Lifter, Prospective, Churn, Need to Grow

    -- Source statuses
    sbg_status TEXT,
    rsar_status TEXT,
    dp_status TEXT,
    prospect_status TEXT,

    -- Visit targets (fractional preserved: 0.5 = alternate-cycle visit)
    so_visits REAL DEFAULT 0,
    asm_visits REAL DEFAULT 0,
    rsm_visits REAL DEFAULT 0,
    zh_visits REAL DEFAULT 0,
    total_visits REAL DEFAULT 0,
    so_visits_pct REAL DEFAULT 0,
    asm_visits_pct REAL DEFAULT 0,
    rsm_visits_pct REAL DEFAULT 0,
    zh_visits_pct REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Multi-Role Generated DJP Recommendations (2nd Output Requirement)
CREATE TABLE IF NOT EXISTS djp_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_run_code TEXT,
    role_type TEXT NOT NULL DEFAULT 'SO', -- SO, ASM, RSM, ZH
    cycle_code TEXT NOT NULL, -- C1 (1-15) or C2 (16-End)
    period_month TEXT NOT NULL, -- e.g., '2026-07'
    emp_code TEXT NOT NULL,
    emp_name TEXT NOT NULL,
    visit_date DATE NOT NULL,
    visit_sequence INTEGER NOT NULL,
    dealer_sap_code TEXT,
    dealer_sfa_code TEXT,
    dealer_name TEXT NOT NULL,
    dealer_type TEXT NOT NULL,
    category TEXT, -- A, B, C, D
    dealer_status TEXT,
    market_strategy TEXT,
    priority_score REAL DEFAULT 0,
    required_visits REAL DEFAULT 1,
    recommendation_reason TEXT,
    plan_status TEXT DEFAULT 'DRAFT',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Plan Generation & Submission Workflow
CREATE TABLE IF NOT EXISTS sales_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_code TEXT NOT NULL,
    emp_name TEXT NOT NULL,
    period_month TEXT NOT NULL, -- e.g., '2026-07'
    cycle_code VARCHAR(5) NOT NULL DEFAULT 'C1', -- C1 (days 1-15) or C2 (days 16-end)
    status TEXT DEFAULT 'DRAFT', -- DRAFT, SUBMITTED, APPROVED, REJECTED, RECTIFY
    submitted_at DATETIME,
    approved_by TEXT,
    approved_at DATETIME,
    remarks TEXT,
    -- Routing, written by planRouting.service straight after generation. Without
    -- these the stamp throws, generation finishes PARTIAL with a ROUTING error, and
    -- EVERY plan reads as having no approver — so no plan can reach an inbox.
    emp_role VARCHAR(20) DEFAULT 'SO',            -- SO / ASM / RSM / ZH
    required_approver_role VARCHAR(20) DEFAULT NULL,
    l1_approver_emp_code VARCHAR(100) DEFAULT NULL, -- the ONE person who approves this
    l1_approver_name VARCHAR(255) DEFAULT NULL,
    l1_approver_role VARCHAR(20) DEFAULT NULL,
    rectification_count INT DEFAULT 0,            -- send-backs used; max is 1
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Plan Details (Date-wise dealer allocations)
CREATE TABLE IF NOT EXISTS sales_plan_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    visit_date DATE NOT NULL,
    dealer_id INTEGER,
    dealer_sap_code TEXT,
    dealer_name TEXT NOT NULL,
    dealer_type TEXT,
    purpose_of_visit TEXT,
    sequence INTEGER DEFAULT 1,
    -- Who put this visit on the plan. The generator writes AUTO; a visit the officer
    -- adds in the field app is AGENT, and added_by carries his employee code.
    -- buildDetail() reads all three, so without them the plan detail screen 500s with
    -- "Unknown column 'd.source' in 'field list'".
    visit_status VARCHAR(20) DEFAULT 'ACTIVE',
    source VARCHAR(20) DEFAULT 'AUTO',
    added_by VARCHAR(50) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(plan_id) REFERENCES sales_plans(id)
);

-- Plan Approvals Log
CREATE TABLE IF NOT EXISTS plan_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    action_by TEXT NOT NULL, -- Manager EMP Code
    action_type TEXT NOT NULL, -- SUBMITTED, APPROVED, REJECTED, RECTIFY, RESUBMITTED
    remarks TEXT,
    approver_role VARCHAR(20) DEFAULT NULL,
    action_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(plan_id) REFERENCES sales_plans(id)
);

-- Matching Audit Log
CREATE TABLE IF NOT EXISTS matching_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_code TEXT,
    source_file TEXT,
    source_sheet TEXT,
    source_row INTEGER,
    source_type TEXT,
    dealer_id TEXT,
    sap_code TEXT,
    sfa_code TEXT,
    dealer_name TEXT,
    match_method TEXT,
    match_confidence REAL,
    match_status TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Generation Runs (batch-isolated plan generation)
-- Written by createGenerationRun / executeGenerationRun / generateAllLegacy /
-- regenerateC2Plans; listGenerationRuns orders by started_at.
-- =============================================================================
CREATE TABLE IF NOT EXISTS generation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_code TEXT NOT NULL UNIQUE,
    report_month TEXT NOT NULL,
    cycle_code TEXT NOT NULL,
    dealer_mapping_batch_code TEXT,
    sales_history_batch_codes TEXT,      -- JSON array of batch codes
    prospect_batch_code TEXT,
    sfa_feedback_batch_code TEXT,
    rules_snapshot TEXT,                 -- JSON snapshot of business_rules at run time
    status TEXT NOT NULL DEFAULT 'PENDING',
    pjp_dealer_count INTEGER DEFAULT 0,
    djp_scheduled_count INTEGER DEFAULT 0,
    djp_unallocated_count INTEGER DEFAULT 0,
    error_message TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);
