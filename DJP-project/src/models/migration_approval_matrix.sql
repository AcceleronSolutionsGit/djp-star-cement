-- =============================================================================
-- Approval Matrix Migration (MySQL)
-- Adds role-based approval enforcement to the PJP plan workflow.
--
-- Approval Hierarchy:
--   SO   → approved by → ASM
--   ASM  → approved by → RSM
--   RSM  → approved by → ZH
--   ZH   → approved by → ADMIN
-- =============================================================================

-- ── 1. Approval Matrix config table (admin-configurable) ─────────────────────
CREATE TABLE IF NOT EXISTS approval_matrix (
  id                    INT PRIMARY KEY AUTO_INCREMENT,
  submitter_role        VARCHAR(20) NOT NULL COMMENT 'Role of the plan creator (SO, ASM, RSM, ZH)',
  required_approver_role VARCHAR(20) NOT NULL COMMENT 'Role required to approve (ASM, RSM, ZH, ADMIN)',
  description           TEXT DEFAULT NULL,
  is_active             TINYINT(1) DEFAULT 1,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_submitter_role (submitter_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Defines which role can approve plans submitted by each role';

-- Seed default matrix
INSERT INTO approval_matrix (submitter_role, required_approver_role, description)
VALUES
  ('SO',    'ASM',   'Sales Officer plans approved by Area Sales Manager'),
  ('SR',    'ASM',   'Sales Representative plans approved by Area Sales Manager'),
  ('MT',    'ASM',   'Market Trader plans approved by Area Sales Manager'),
  ('ASM',   'RSM',   'ASM plans approved by Regional Sales Manager'),
  ('RSM',   'ZH',    'RSM plans approved by Zone Head'),
  ('ZH',    'ADMIN', 'Zone Head plans approved by Admin / National Head')
ON DUPLICATE KEY UPDATE
  required_approver_role = VALUES(required_approver_role),
  description = VALUES(description);

-- ── 2. Add role columns to sales_plans ───────────────────────────────────────
ALTER TABLE sales_plans
  ADD COLUMN IF NOT EXISTS emp_role VARCHAR(20) DEFAULT 'SO'
    COMMENT 'Role of the employee who created the plan',
  ADD COLUMN IF NOT EXISTS required_approver_role VARCHAR(20) DEFAULT NULL
    COMMENT 'Role required to approve this plan (set on submit, from approval_matrix)',
  ADD COLUMN IF NOT EXISTS approver_emp_code VARCHAR(100) DEFAULT NULL
    COMMENT 'Emp code of the actual approver (filled on approval)';

-- ── 3. Add role column to plan_approvals for audit trail ─────────────────────
ALTER TABLE plan_approvals
  ADD COLUMN IF NOT EXISTS approver_role VARCHAR(20) DEFAULT NULL
    COMMENT 'Role of the approver at time of action';

-- ── 4. Add role column to unplanned_visit_requests ───────────────────────────
ALTER TABLE unplanned_visit_requests
  ADD COLUMN IF NOT EXISTS required_approver_role VARCHAR(20) DEFAULT 'ASM'
    COMMENT 'Role required to approve (from matrix based on requestor role)';

-- ── 5. Index for fast matrix lookups ─────────────────────────────────────────
ALTER TABLE sales_plans
  ADD INDEX IF NOT EXISTS idx_sp_emp_role (emp_role),
  ADD INDEX IF NOT EXISTS idx_sp_req_approver_role (required_approver_role);
