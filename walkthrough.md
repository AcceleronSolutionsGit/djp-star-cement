# Application Workflow & Data Architecture Walkthrough

The Star Cement Central PJP & DJP Sales Automation Platform is an end-to-end data processing and planning engine designed to automate the daily journey plans of Sales Officers. 

Here is the complete start-to-end workflow of the application and how data moves through it.

## 1. Data Ingestion (Monthly SFA Upload)
**Goal:** Ingest raw field data from the legacy ERP/SFA systems to fuel the planning engine.

- **Trigger:** An administrator visits the **Monthly Ingestion Hub** and uploads the massive monthly SFA Excel Report.
- **Data Used:** The Excel file contains 5 critical master sheets:
  1. **Full PJP Process Trade:** Dealer mapping, active statuses, SAP codes, and categorization (A, B, C, D). 
  2. **Dealer - SO Territory Hierarchy Mapping:** Defines which Sales Officer (SO) manages which dealer geographically (Zone, Region, Area).
  3. **Prospect Dealer List:** List of potential dealers with statuses like "Growing", "Zero lifter", etc.
  4. **Period Sales History:** RSAR/ERP sales data per dealer indicating volume performance over previous months.
  5. **SFA Visit Execution Feedback:** Logs of actual physical visits made by SOs to dealers, including check-in/check-out timestamps and GPS coordinates.
- **Processing:** The Node.js backend uses streaming (`exceljs`) to parse the file efficiently in chunks. It normalizes messy data (e.g., converting raw Excel date decimals into proper `HH:mm:ss` or `YYYY-MM` formats) and performs fast batched inserts into the **MySQL Database**.

## 2. Master Data Harmonization & Rule Engine
**Goal:** Prepare the data and apply business logic.

- **Master Data Hub:** Once ingested, the data is available in the Master Data Hub. Administrators can use rich **Searchable Filters** (powered by React-Select) to drill down into millions of rows instantly, verifying data integrity.
- **Business Rule Engine:** The application exposes a Rule Engine UI where management can configure constraints.
  - *Example Rules:* "Category A dealers must be visited 4 times a month", "Category B dealers must be visited 2 times", "SOs can make a maximum of 15 visits per day".
- **Data Used:** These rules are saved in the `business_rules` MySQL table and dictate the behavior of the generation engine.

## 3. The DJP Generation Engine
**Goal:** Automatically synthesize optimal travel plans for every Sales Officer.

- **Trigger:** An admin hits the "Generate Auto-Plans" button.
- **Workflow:** 
  1. The backend engine queries the `business_rules`.
  2. It cross-references the **PJP Process Trade** list with the **Dealer-SO Mapping** list to assign dealers to specific SOs.
  3. It calculates required visit frequencies (e.g., if a dealer is Category A, they need 4 visits).
  4. It looks at the **Sales History** to prioritize high-volume dealers or flag "Zero Lifters" for immediate attention.
  5. It distributes these visits across the current month, usually split into **Cycle 1 (Days 1-15)** and **Cycle 2 (Days 16-End of Month)**.
- **Data Output:** The engine generates records in `dealer_visit_targets` and creates formal plans in the `sales_plans` and `plan_visits` tables.

## 4. Plan Review & Exception Handling
**Goal:** Allow human oversight and corrections.

- **Unmapped Dealers:** During generation, if a dealer is found in the Sales History but lacks a Sales Officer in the Territory Mapping, they are flagged in the **Dealer to SO Mapping Engine**. Admins can manually map them here.
- **Manual Adjustments:** Sales Officers or Area Managers can log into the **Generated Sales Plans** interface to view the AI-recommended DJP (Daily Journey Plan).
- **Data Used:** The UI queries the `sales_plans` and `plan_visits` tables. Users can drag-and-drop visits, delete unnecessary ones, or add ad-hoc prospect visits.

## 5. Approval Workflow & Execution
**Goal:** Lock in the plans and track compliance.

- **Workflow:** Once an SO finishes reviewing their plan, they hit "Submit". The plan enters the **Plan Approvals** queue.
- **Manager Action:** The Area Manager reviews the submitted plans. They can "Approve" or "Reject" with remarks.
- **Execution Loop:** Approved plans are synced back to the SFA mobile app (via API). As SOs perform their field visits, their new check-ins are logged in the SFA system.
- **Full Circle:** Next month, the new **SFA Visit Execution Feedback** is uploaded back into this platform, allowing the engine to calculate compliance (e.g., "Did the SO actually visit the Category A dealer 4 times like the plan dictated?") and adjust future plans accordingly.

---

### System Architecture Summary
> [!NOTE]
> - **Frontend:** React SPA (Vite) utilizing `react-select` for advanced filtering and local storage for state persistence.
> - **Backend:** Node.js / Express serving RESTful APIs.
> - **Database:** MySQL relational database handling hundreds of thousands of records using batched queries and indexing.
