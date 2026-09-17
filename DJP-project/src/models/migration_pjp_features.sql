-- =============================================================================
-- PJP Process Guidelines — Feature Migration
-- MySQL migration for Dynamic PJP, Unplanned Visit Gate, Churn Risk
-- Run once against the star_one_djp database
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Feature 1: Dynamic PJP Amendment workflow
-- Add amendment tracking columns to sales_plans
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE sales_plans
  ADD COLUMN IF NOT EXISTS amendment_status VARCHAR(50) DEFAULT NULL
    COMMENT 'NULL=no amendment open, AMENDMENT_PENDING=awaiting ASM, AMENDMENT_APPROVED=closed',
  ADD COLUMN IF NOT EXISTS amendment_requested_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS amendment_approved_by VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS amendment_approved_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS amendment_remarks TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_dynamic_revision TINYINT(1) DEFAULT 0
    COMMENT '0 = original plan, 1 = post-15th revision';

-- Add cycle_code to sales_plans if missing
ALTER TABLE sales_plans
  ADD COLUMN IF NOT EXISTS cycle_code VARCHAR(5) DEFAULT 'C1';

-- Add visit_status to sales_plan_details:
--   ACTIVE           = normal, scheduled visit
--   PENDING_APPROVAL = added during amendment, awaiting ASM approval
--   REJECTED         = ASM rejected this visit addition
ALTER TABLE sales_plan_details
  ADD COLUMN IF NOT EXISTS visit_status VARCHAR(30) DEFAULT 'ACTIVE'
    COMMENT 'ACTIVE | PENDING_APPROVAL | REJECTED';

-- ─────────────────────────────────────────────────────────────────────────────
-- Feature 2: Unplanned Visit Approval Gate
-- Tracks SO requests for unplanned prospective visits on APPROVED plans
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unplanned_visit_requests (
  id                    INT PRIMARY KEY AUTO_INCREMENT,
  plan_id               INT NOT NULL,
  requested_by_emp_code VARCHAR(50) NOT NULL,
  visit_date            DATE NOT NULL,
  dealer_id             INT DEFAULT NULL,
  dealer_sap_code       VARCHAR(50) DEFAULT NULL,
  dealer_name           VARCHAR(255) NOT NULL,
  dealer_type           VARCHAR(50) DEFAULT 'PROSPECTIVE',
  purpose_of_visit      TEXT,
  status                VARCHAR(30) DEFAULT 'PENDING'
    COMMENT 'PENDING | APPROVED | REJECTED',
  reviewed_by           VARCHAR(100) DEFAULT NULL,
  reviewed_at           DATETIME DEFAULT NULL,
  review_remarks        TEXT DEFAULT NULL,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES sales_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes for performance
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE unplanned_visit_requests
  ADD INDEX IF NOT EXISTS idx_uvr_plan_id (plan_id),
  ADD INDEX IF NOT EXISTS idx_uvr_status (status),
  ADD INDEX IF NOT EXISTS idx_uvr_requested_by (requested_by_emp_code);

ALTER TABLE sales_plan_details
  ADD INDEX IF NOT EXISTS idx_spd_visit_status (visit_status);

ALTER TABLE sales_plans
  ADD INDEX IF NOT EXISTS idx_sp_amendment_status (amendment_status);
