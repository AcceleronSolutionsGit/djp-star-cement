# STAR CEMENT PJP / DJP AUTOMATION
## Consolidated Master Import Specification, Data Flow Diagrams & End-to-End Journey

---

### Document Information
* **Document Title:** Star Cement PJP/DJP Automation System Architecture & End-to-End Operational Journey
* **Target Audience:** Engineering Team, Solution Architects, Business Analysts, Field Operations & System Administrators
* **Project Reference:** Node.js Rule Engine + Admin Panel + Unified Mobile API
* **Consolidated File:** `Consolidated_Master_Import.xlsx`
* **Version:** 1.0 (Production Architecture Spec)

---

## 1. Executive Summary

The **Star Cement PJP / DJP Automation Platform** replaces the manual, fragmented, Excel-based journey planning process with a centralized, configuration-driven recommendation engine and automated execution feedback loop. 

Historically, sales officers (SO) and managers spent dozens of hours monthly running manual Excel VLOOKUPs, applying disconnected formulas, and distributing static visit lists. This platform establishes:
1. **Single Unified Data Foundation:** Consolidates 6 disparate Excel sources (Dealer Mapping, Performance, Micro-market SBG, Historical Sales, Prospective Dealers, and SFA Execution) into a validated master repository.
2. **Deterministic Recommendation Engine:** Automatically categorizes dealers (A/B/C/D), identifies churn/zero-lifters, scores counter priorities, and creates optimized daily journey plans (8 visits/day/SO).
3. **Dual-Cycle Planning (C1 & C2):**
   * **Cycle C1 (1st–15th):** Initial baseline journey plan generated using historical performance and territory targets.
   * **Cycle C2 (16th–Month End):** Mid-month dynamic recalculation triggered on the 15th, factoring in actual execution, missed visits, and real-time demand conversion.
4. **Closed-Loop Field Feedback:** Seamlessly reconciles mobile check-in/out records, unplanned visits, and planned vs. actual adherence.

---

## 2. Consolidated Master Import Architecture

To streamline ingestion and eliminate manual errors across multiple independent file uploads, all required source data is consolidated into a single master workbook: [`Consolidated_Master_Import.xlsx`](file:///d:/OFFICE/DJP-project/DJP-project/Consolidated_Master_Import.xlsx).

### 2.1 File Location & Generated Assets
* **Root Location:** [`Consolidated_Master_Import.xlsx`](file:///d:/OFFICE/DJP-project/DJP-project/Consolidated_Master_Import.xlsx)
* **Template Directory:** [`templates/Consolidated_Master_Import.xlsx`](file:///d:/OFFICE/DJP-project/DJP-project/templates/Consolidated_Master_Import.xlsx)
* **Upload Archive Directory:** [`upload-files/Consolidated_Master_Import.xlsx`](file:///d:/OFFICE/DJP-project/DJP-project/upload-files/Consolidated_Master_Import.xlsx)
* **Workbook Compilation Script:** [`scripts/generate-consolidated-import.js`](file:///d:/OFFICE/DJP-project/DJP-project/scripts/generate-consolidated-import.js)
* **Automated Import Runner:** [`scripts/import-consolidated-runner.js`](file:///d:/OFFICE/DJP-project/DJP-project/scripts/import-consolidated-runner.js)

---

### 2.2 Sheet Breakdown & Data Dictionary

| Sheet Name | Source Module | Row Count | Target Database Tables | Key Fields & Identifiers |
| :--- | :--- | :--- | :--- | :--- |
| **`Index_and_Guide`** | System Guide | 18 rows | N/A (Metadata) | Ingestion order, versioning, data dictionary & constraints |
| **`Dealer_Mapping`** | Core Hierarchy | 109 rows | `master_dealers`<br>`master_employees`<br>`master_dealer_so_mapping` | `SAP Code`, `SFA Code`, `Dealer Name`, `Cust Type`, `Area`, `Zone`, `Block`, `SO Name`, `SO Emp Code`, `ASM Name/Code`, `RSM Name/Code`, `ZH Name/Code`, `DOA` |
| **`Dealer_Performance`** | Sales & Targets | 109 rows | `dealer_performance_history`<br>`master_dealers` | `SAP`, `CODE`, `DEALERS NAME`, `AREA`, `REGION`, `DOA`, `Targeted Dealer`, `EXCLUSIVE DEALER`, `June'26 Tgt`, `Prorata Tgt`, `Monthly Sales`, `6-Month Avg` |
| **`SBG_Master`** | Micro-Market | 109 rows | `master_dealers`<br>`territories` | `Customer Code`, `Dealer Name`, `Territory Code/Name`, `Block (Taluka)`, `Counter Potential Average (MT)`, `Zone`, `Status in SAP`, `Dealer Start Date` |
| **`Sales_History`** | RSAR / ERP | 462 rows | `sub_dealer_sales_history`<br>`sales_history` | `SAP Code`, `Sub Dealer Name`, `LinkedDealerCode`, `Linked Dealer Name`, `Zone`, `Jan-26` through `Jun-26` Monthly Volume |
| **`Prospect_Dealers`** | Growth Pipeline | 73 rows | `prospective_dealers` | `Zone`, `AREA`, `TALUKA`, `SFA CODE`, `PROSPECTIVE DEALER NAME`, `NAME OF SO`, `Potential (MT)`, `Expected Sale (MT)`, `Month` |
| **`SFA_Report`** | Execution Feedback | 109 rows | `sfa_visit_history`<br>`unplanned_visits` | `Date of Visit`, `Customer Code`, `Customer Name`, `Route`, `Branch`, `Employee Code/Name`, `Check In/Out Time`, `Duration`, `Visit Status`, `Purpose` |

---

### 2.3 Strict Pipeline Ingestion Order & Integrity Rules

```
Step 1: Dealer_Mapping
   │   (Establishes canonical dealers, employee hierarchy: SO -> ASM -> RSM -> ZH)
   ▼
Step 2: SBG_Master
   │   (Enriches dealers with territory codes, micro-market potential & SAP status)
   ▼
Step 3: Dealer_Performance
   │   (Attaches monthly targets, prorata targets, DOA tiers, and performance records)
   ▼
Step 4: Sales_History
   │   (Populates 6-month historical trend curves for churn and zero-lifter detection)
   ▼
Step 5: Prospect_Dealers
   │   (Injects vetted prospective dealers mapped to responsible Sales Officers)
   ▼
Step 6: SFA_Report
       (Logs field executions, duration, productive check-ins & triggers C2 feedback)
```

---

## 3. Data Flow Diagrams (DFD)

### 3.1 Level 0: System Context Diagram

```mermaid
flowchart TD
    subgraph ExternalSources["External Data Inputs"]
        Excel["Consolidated Master Import (.xlsx)\n(6 Domain Sheets)"]
        SFA_App["Mobile SFA App\n(Field Telemetry)"]
        AdminUser["System Administrator\n(Rule Configuration)"]
    end

    subgraph Platform["Star Cement DJP Automation Platform"]
        Ingestion["Staging, Ingestion & Canonical Resolution Engine"]
        RuleEngine["Node.js DJP & Recommendation Engine"]
        DB[("Central Database\n(MySQL / Staging / History)")]
    end

    subgraph ConsumerRoles["Business Consumers & Stakeholders"]
        SO["Sales Officer (SO)\n(Journey Review & Plan Execution)"]
        ASM["Area Sales Manager (ASM)\n(Plan Approval & Monitoring)"]
        Mgmt["Management & Leadership\n(Adherence, Funnel & Coverage Reports)"]
    end

    Excel --> Ingestion
    AdminUser -->|Rules: 8 Visits/Day, C1/C2 Dates, Category Thresholds| RuleEngine
    Ingestion <--> DB
    DB <--> RuleEngine

    RuleEngine -->|Generates Date-wise DJP Recommendations| SO
    SO -->|Submits Edited Plan| ASM
    ASM -->|Approves / Rejects Plan| RuleEngine
    RuleEngine -->|Publishes Approved Schedule| SFA_App
    SFA_App -->|Actual Visits, Geotags, Duration, Unplanned Visits| Ingestion
    RuleEngine -->|Plan vs Actual Adherence & Analytics| Mgmt
```

---

### 3.2 Level 1: Functional Decomposition Data Flow Diagram

```mermaid
flowchart LR
    subgraph S1["1. File Ingestion & Staging"]
        F1["Consolidated Master File"] --> F2["upload_batches\n(Status: PROCESSING)"]
        F2 --> F3{"Schema Inspection\n& Type Validation"}
        F3 -- Valid Rows --> F4["Staging Data"]
        F3 -- Errors --> F5["matching_audit\n& Error Summary"]
    end

    subgraph S2["2. Canonical Matching & Persistence"]
        F4 --> M1["Canonical Matching Engine\n(SAP & SFA Code Reconciliation)"]
        M1 --> T1[("master_dealers")]
        M1 --> T2[("master_employees\n(SO, ASM, RSM, ZH)")]
        M1 --> T3[("dealer_performance_history")]
        M1 --> T4[("sales_history")]
        M1 --> T5[("prospective_dealers")]
        M1 --> T6[("sfa_visit_history")]
    end

    subgraph S3["3. Rule & Recommendation Engine"]
        T1 & T2 & T3 & T4 & T5 & T6 --> R1["Eligibility Filter\n(Active SAP, Mapped SO)"]
        R1 --> R2["Classification Engine\n(Core Dealer, Sub-Dealer, Prospect)"]
        R2 --> R3["Category Engine (A/B/C/D)\n& Market Strategy (GA/GI/MM)"]
        R3 --> R4["Priority Scoring Engine\n(Volume, Potential Gap, Churn Boost)"]
        R4 --> R5["Visit Frequency Matrix\n(Target Monthly Visits)"]
    end

    subgraph S4["4. Allocation & Schedule Generation"]
        R5 --> A1["Daily Allocation Engine\n(Strict Max 8 visits/day/SO)"]
        A1 --> A2["Dual-Cycle Partitioning\n(Cycle C1: 1-15 | Cycle C2: 16-End)"]
        A2 --> A3[("sales_plans\n& dealer_visit_targets")]
    end

    subgraph S5["5. Execution & Mid-Month Feedback"]
        A3 --> E1["SO Review & Edit"]
        E1 --> E2["ASM Approval"]
        E2 --> E3["Mobile Execution"]
        E3 --> E4["Mid-Month Dynamic Recalculation\n(Missed Visits Priority Boost)"]
        E4 -.->|Recalculate C2| A1
    end
```

---

### 3.3 Level 2: Rule Engine Internal Processing Flowchart

```mermaid
flowchart TD
    Start(["Input: Target Period (YYYY-MM), Cycle (C1/C2), SO ID"]) --> LoadContext["Load Active Rules, Master Dealers, Targets & History"]
    
    LoadContext --> EligibleFilter{"Is Dealer Eligible?\n1. Status Active in SAP?\n2. Mapped to Current SO?\n3. Valid Territory?"}
    EligibleFilter -- No --> Exclude["Exclude Dealer from Pool"]
    EligibleFilter -- Yes --> ChurnDetector{"3-Month Churn Check\n(Total Sales past 90 days == 0?)"}
    
    ChurnDetector -- Yes --> ZeroLifter["Tag: Zero-Lifter / Churn\nAssign High Reactivation Boost (+30 pts)"]
    ChurnDetector -- No --> CategoryAssign["Assign Category (A / B / C / D)\nBased on Monthly Volume & Potential"]
    
    ZeroLifter --> MarketStrategy
    CategoryAssign --> MarketStrategy["Apply Market Strategy Multiplier\n- GA (Growth Acceleration): +15 pts\n- GI (Growth Intensive): +10 pts\n- MM (Maintenance Market): +5 pts"]
    
    MarketStrategy --> ComputeScore["Compute Composite Priority Score:\nScore = (w_vol * Vol) + (w_pot * PotGap) + Boosts"]
    
    ComputeScore --> MissedCheck{"Did SO Miss Planned Visit\nin Previous 15 Days?"}
    MissedCheck -- Yes --> MissedBoost["Apply Carry-Forward Penalty Boost\nForce into Top Priority Queue"]
    MissedCheck -- No --> SortQueue["Sort Eligible Dealers by Descending Priority"]
    MissedBoost --> SortQueue
    
    SortQueue --> CapacityConstraint["Daily Slot Allocation Engine:\n- Respect Officer Working Days\n- Max 8 Dealers per Day\n- Group by Route / Geography Cluster"]
    
    CapacityConstraint --> Output(["Persist Proposed DJP in sales_plans (Status: DRAFT)"])
```

---

## 4. End-to-End Journey Representation

The end-to-end journey encompasses **9 distinct operational phases** across 4 key roles: **Admin**, **Sales Officer (SO)**, **Area Sales Manager (ASM)**, and **Zonal Leadership (ZSM)**.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as System Administrator
    actor SO as Sales Officer (SO)
    actor ASM as Area Sales Manager (ASM)
    participant Platform as Node.js Rule Engine
    participant DB as Central Database
    participant Mobile as SFA Mobile App
    actor ZSM as ZSM / Management

    Note over Admin,DB: PHASE 1: DATA INGESTION & STAGING
    Admin->>Platform: Upload Consolidated_Master_Import.xlsx
    Platform->>DB: Create upload_batches (Status: PROCESSING)
    Platform->>Platform: Validate headers, formats, and sheets
    Platform->>Platform: Reconcile SAP Codes & SFA Codes (Canonical Match)
    Platform->>DB: Insert master_dealers, employees, performance & history
    Platform->>DB: Update upload_batches (Status: VALIDATED)
    Platform-->>Admin: Display Ingestion Report (Rows valid, errors, warnings)

    Note over Admin,Platform: PHASE 2: BUSINESS RULE CALIBRATION
    Admin->>Platform: Set Business Rules (8 visits/day, C1: 1-15, C2: 16-30, Category thresholds)
    Platform->>DB: Store audited rule version in business_rules

    Note over SO,Platform: PHASE 3: DJP GENERATION (CYCLE C1)
    SO->>Platform: Click "Generate DJP" (e.g., 2026-07 Cycle C1)
    Platform->>DB: Fetch eligible dealers, 6-month history, potential gap
    Platform->>Platform: Evaluate Eligibility -> Classification -> Priority Scoring
    Platform->>Platform: Allocate daily 8 slots across available working days
    Platform->>DB: Save generated records in sales_plans (Status: DRAFT)
    Platform-->>SO: Present Date-wise DJP Recommendations

    Note over SO,ASM: PHASE 4: REVIEW, EDIT & SUBMISSION
    SO->>SO: Inspect recommended daily routes and dealers
    alt SO Modifies Plan
        SO->>Platform: Swap visit dates / replace dealer with prospective counter
        Platform->>DB: Record manual edits with audit reason
    end
    SO->>Platform: Click "Submit Plan for Approval"
    Platform->>DB: Update sales_plans (Status: SUBMITTED)
    Platform-->>ASM: Trigger Notification: Plan awaiting review

    Note over ASM,Platform: PHASE 5: MANAGERIAL APPROVAL
    ASM->>Platform: Inspect SO's proposed DJP calendar and dealer mix
    alt Plan Approved
        ASM->>Platform: Approve DJP Plan
        Platform->>DB: Update sales_plans (Status: APPROVED / PUBLISHED)
    else Revision Required
        ASM->>Platform: Reject Plan with Feedback Comments
        Platform->>DB: Update sales_plans (Status: REJECTED)
        Platform-->>SO: Return plan for revision
    end

    Note over SO,Mobile: PHASE 6: FIELD EXECUTION (CYCLE C1)
    Mobile->>Platform: Sync Published DJP for current date
    SO->>Mobile: Arrive at Dealer counter -> Click "Check-In" (GPS Geotag logged)
    SO->>Mobile: Conduct meeting, record orders, counter feedback
    SO->>Mobile: Click "Check-Out" -> Log Productive/Non-Productive status
    Mobile->>Platform: Send visit telemetry to /api/visits/check-in & check-out
    Platform->>DB: Insert record into sfa_visit_history

    Note over Platform,DB: PHASE 7: UNPLANNED VISIT RECONCILIATION
    opt SO Visits Unplanned Dealer
        SO->>Mobile: Check-in at non-scheduled dealer counter
        Mobile->>Platform: Log Unplanned Visit flag
        Platform->>DB: Reconcile unplanned visit against target allocations
    end

    Note over Platform,SO: PHASE 8: MID-MONTH DYNAMIC FEEDBACK (CYCLE C2)
    Note over Platform: Triggered on 15th of the month
    Platform->>DB: Query C1 actual visits vs planned visits
    Platform->>Platform: Identify Missed Visits (Planned but not completed)
    Platform->>Platform: Recalculate C2 suggestions (16th-Month End) with Missed-Visit Priority Boost
    Platform->>DB: Generate Cycle C2 DJP (Status: DRAFT)
    Platform-->>SO: Present fresh C2 Journey Plan ready for execution

    Note over ZSM,Platform: PHASE 9: MONITORING & AUDIT REPORTING
    ZSM->>Platform: Access Executive Dashboard
    Platform->>DB: Compute Plan vs Actual Adherence, Coverage % & Churn Trends
    Platform-->>ZSM: Display Hierarchy Funnel, Adherence Heatmap & Visit Outcome Mix
```

---

## 5. Detailed Phase Descriptions

### Phase 1: Consolidated Data Ingestion & Validation
* **Trigger:** Monthly file upload or ad-hoc data refresh by the administrator.
* **Mechanism:** Single upload of [`Consolidated_Master_Import.xlsx`](file:///d:/OFFICE/DJP-project/DJP-project/Consolidated_Master_Import.xlsx).
* **Validation Pipeline:**
  1. Header normalization (case-insensitive, trims underscores, hyphens, and whitespace).
  2. Data type and date parsing (supports ISO dates, Excel serial numbers, `Jun-26`, `June'26`).
  3. Canonical matching: Reconciles SAP Codes with SFA Codes into a persistent `dealer_id`.
  4. Logging in `upload_batches` with row counts (`valid_rows`, `invalid_rows`, `duplicate_rows`).

### Phase 2: Hierarchy & Master Resolution
* **Mapping Hierarchy:** `Sales Officer (SO)` $\rightarrow$ `Area Sales Manager (ASM)` $\rightarrow$ `Regional Sales Manager (RSM)` $\rightarrow$ `Zonal Head (ZH)`.
* **Conflict Prevention:** Employee designations are preserved upon initial creation to prevent designation flip-flops across different file lines.
* **Master Dealers:** Unique dealer record keyed by canonical ID, containing current SO assignment, territory, counter potential, and activation date (DOA).

### Phase 3: Rule Configuration & Parameter Management
* **Configurable Parameters:**
  * **Daily Dealer Capacity:** Default is 8 visits/day/SO (configurable without code modifications).
  * **Cycle Boundaries:** C1 (1st–15th), C2 (16th–Month End).
  * **Category Thresholds:** Metric volume thresholds for Class A, B, C, D counters.
  * **Scoring Weights:** Tunable weights for volume, potential gap, churn reactivation, and exclusive status.

### Phase 4: Automated DJP Generation Engine
* **Execution Flow:**
  1. `Eligibility Filter`: Removes inactive SAP counters or unassigned dealers.
  2. `Churn Engine`: Evaluates 3-month trailing sales; dealers with 0 sales are flagged as zero-lifters.
  3. `Potential Gap`: Calculated as $\text{Potential Gap} = \max(0, \text{Counter Potential} - \text{Current Sales})$.
  4. `Priority Engine`: Calculates weighted composite score.
  5. `Daily Allocation`: Sequentially fills up to 8 slots per planning day.

### Phase 5: Field Officer (SO) Plan Review & Editing
* **Empowerment with Guardrails:** SOs can view system recommendations and make necessary field adjustments:
  * Reorder sequence of visits on any given date.
  * Swap dealer visits across dates.
  * Substitute an existing dealer with an approved prospective dealer.
  * *Auditability:* Every manual edit requires an operational reason code and remains distinguishable from system-generated suggestions.

### Phase 6: Managerial Approval Workflow
* **Approval Chain:** SO submits plan $\rightarrow$ ASM reviews proposed schedule.
* **Review Criteria:** ASM inspects coverage balance, high-potential dealer inclusion, and geographical logic.
* **Actions:** Approve (locks plan as `PUBLISHED`), Reject (returns plan to SO with review comments).

### Phase 7: Mobile App Field Execution & Geotagging
* **Daily Operations:** The field officer accesses the published daily plan on the mobile app.
* **Verification:** Geotagged GPS coordinates and timestamp logged on "Check-In" and "Check-Out".
* **Outcome Recording:** Productive (with sales conversion/order booking) vs Non-Productive (with reason codes: shop closed, owner unavailable, etc.).

### Phase 8: Mid-Month C2 Dynamic Feedback Loop
* **Dynamic Recalculation Date:** 15th of each month.
* **Feedback Ingestion:** Reads completed visits vs planned visits from C1.
* **Carry-Forward Rule:** Unvisited/missed dealers receive a priority boost in Cycle C2 so they are scheduled without exceeding daily capacity limits.

### Phase 9: Executive Monitoring & Adherence Analytics
* **Visibility:**
  * **Plan vs Actual Adherence:** Tracks execution percentage against initial commitments.
  * **Coverage Analysis:** Identifies counters with zero visits over 30/60/90 days.
  * **Hierarchy Performance:** Roll-up adherence from SO to ASM, RSM, and Zone.

---

## 6. Database Schema Reference

```mermaid
erDiagram
    UPLOAD_BATCHES ||--o{ MATCHING_AUDIT : logs
    MASTER_EMPLOYEES ||--o{ MASTER_DEALERS : manages
    MASTER_DEALERS ||--o{ DEALER_PERFORMANCE_HISTORY : has
    MASTER_DEALERS ||--o{ SALES_HISTORY : has
    MASTER_DEALERS ||--o{ DEALER_VISIT_TARGETS : targets
    MASTER_DEALERS ||--o{ SALES_PLANS : schedules
    MASTER_DEALERS ||--o{ SFA_VISIT_HISTORY : executes
    PROSPECTIVE_DEALERS ||--o{ SALES_PLANS : introduces

    UPLOAD_BATCHES {
        string batch_code PK
        string file_type
        string file_name
        string status
        int total_rows
        int valid_rows
        int invalid_rows
    }

    MASTER_DEALERS {
        string id PK
        string sap_code
        string sfa_code
        string dealer_name
        string cust_type
        string area
        string zone
        string block
        string so_emp_code FK
        double counter_potential
        date doa
    }

    MASTER_EMPLOYEES {
        int id PK
        string emp_code
        string emp_name
        string designation
        string zone
        string region
    }

    DEALER_PERFORMANCE_HISTORY {
        int id PK
        string dealer_id FK
        string period_month
        double target_qty
        double prorata_target
        double actual_sales
    }

    SALES_PLANS {
        int id PK
        string plan_code
        string user_id FK
        string dealer_id FK
        date plan_date
        int visit_sequence
        string cycle_code
        string status
        string reason
    }

    SFA_VISIT_HISTORY {
        int id PK
        string dealer_id FK
        string employee_code FK
        date visit_date
        datetime check_in_time
        datetime check_out_time
        int duration_minutes
        string visit_status
    }
```

---

## 7. How to Run & Automate

### 7.1 Recompiling the Consolidated Master Import File
If source files in `upload-files/` are modified, regenerate the master workbook at any time:
```powershell
node scripts/generate-consolidated-import.js
```

### 7.2 Executing the Automated Ingestion Pipeline
To ingest the consolidated file into the database across all 6 domains in the correct dependency sequence:
```powershell
node scripts/import-consolidated-runner.js
```

### 7.3 Direct API Upload Endpoint
Administrators can also upload the file directly via the web portal or API:
* **Endpoint:** `POST /api/upload`
* **Form-Data:**
  * `file`: `Consolidated_Master_Import.xlsx`
  * `uploadType`: `DEALER_MAPPING` (or individual domain selectors)
