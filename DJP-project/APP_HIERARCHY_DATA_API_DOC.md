# Star Cement DJP / PJP — Multi-Tier Hierarchy & App Data API Documentation
**Complete Developer Guide for ZH (Zonal Head), RSM (Regional Sales Manager), ASM (Area Sales Manager), and SO (Sales Officer)**

---

## 1. Overview & Architecture

The Star Cement Dynamic Journey Planner (DJP) platform provides complete visibility into sales planning, dealer visit targets, actual SFA field execution, and adherence across all four tiers of the sales organization:

```
┌────────────────────────────────────────────────────────┐
│                   ZH (Zonal Head)                      │
│             Oversees entire Zone & RSMs                │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│              RSM (Regional Sales Manager)              │
│            Oversees Region & Area Managers             │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┘
│               ASM (Area Sales Manager)                 │
│              Oversees Area & Territory SOs             │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┘
│                 SO (Sales Officer / SE)                │
│             Ground Territory Field Execution           │
└────────────────────────────────────────────────────────┘
```

### Base URL & Protocol
- **Base URL**: `http://<server-ip-or-domain>/api` (or relative `/api`)
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <token>` *(optional in dev/simulator, required in production admin mode)*

---

## 2. Quick API Summary Table

| Category | HTTP Method | Endpoint Path | Primary Roles / Data Returned |
|---|---|---|---|
| **Hierarchy Tree** | `GET` | `/app/hierarchy/:empCode/analysis` | Dynamic roll-up tree (`ZH` → `RSM` → `ASM` → `SO`) with own/team stats |
| **Subordinate Drill** | `GET` | `/app/hierarchy/:viewerCode/officer/:empCode/visits` | Day-wise scheduled and executed visits for any subordinate |
| **Adherence Report** | `GET` | `/app/admin/adherence` | Global adherence segmented `by_role` (ZH, RSM, ASM, SO) and `by_employee` |
| **Team Adherence** | `GET` | `/app/approvers/:empCode/team-adherence` | Team metrics for a manager's immediate team |
| **Master Targets** | `GET` | `/djp/dealer-targets` | All dealers with `zh_*`, `rsm_*`, `asm_*`, `so_*` targets & visits |
| **Master Grid View**| `GET` | `/djp/master-view` | Complete 42-column Master PJP view with pagination and filters |
| **All Plans List** | `GET` | `/app/admin/plans` | Filterable by `role=SO`, `role=ASM`, `role=RSM`, `role=ZH` |
| **Unplanned Visits**| `GET` | `/sfa/unplanned-visits` | Tab 1: 16-column SFA unplanned visit executions |
| **Consolidated**   | `GET` | `/sfa/unplanned-visits/consolidated` | Tab 2: 13-column Planned, Adhered & Unplanned records |
| **Planned vs Unpl.**| `GET` | `/sfa/unplanned-visits/planned-vs-unplanned` | Tab 3: Aggregated summary with grand totals |
| **Employee Hub**   | `GET` | `/master/employees` | Master directory of all employees filtered by designation |
| **Territory Tree** | `GET` | `/admin/mapping` | Full territory linkages between SO, ASM, RSM, and ZH |
| **Excel Export**   | `GET` | `/djp/export-adherence-report` | Download multi-sheet workbook covering ZH, RSM, ASM, and SO |

---

## 3. Detailed Endpoint Specifications

### 3.1. Hierarchy Funnel & Tree Analysis
**The ultimate endpoint for rendering manager hierarchy trees and drilldowns in mobile/web apps.**

- **Endpoint**: `GET /api/app/hierarchy/:empCode/analysis`
- **Access Rule**:
  - A `ZH` sees his entire zone (`RSMs`, `ASMs`, `SOs`).
  - An `RSM` sees his region (`ASMs`, `SOs`).
  - An `ASM` sees his area (`SOs`).
  - An `SO` sees his own performance.
  - Sending `admin` as `:empCode` returns the entire organizational tree.

#### Query Parameters
| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `month` | string | No | Current Month | Format `YYYY-MM` (e.g. `2026-06`) |
| `cycle` | string | No | `ALL` | `C1`, `C2`, or `ALL` |
| `asOn` | string | No | Cycle End Date | Format `YYYY-MM-DD` |
| `depth` | integer | No | Max | Max depth to recurse down children |

#### Response Schema (`200 OK`)
```json
{
  "period_month": "2026-06",
  "cycle_code": "C1",
  "as_on_date": "2026-06-15",
  "viewer": {
    "emp_code": "11002001",
    "emp_name": "SANJAY SHARMA",
    "role": "ZH",
    "designation": "ZONAL HEAD"
  },
  "tree": {
    "emp_code": "11002001",
    "emp_name": "SANJAY SHARMA",
    "role": "ZH",
    "own": {
      "planned_dealers": 15,
      "planned_visits": 30,
      "mtd_due": 30,
      "adhered": 28,
      "adherence_pct": 93.3
    },
    "team": {
      "total_officers": 42,
      "planned_dealers": 1250,
      "planned_visits": 2800,
      "mtd_due": 2800,
      "adhered": 2540,
      "adherence_pct": 90.7
    },
    "children": [
      {
        "emp_code": "11002050",
        "emp_name": "RAJESH KUMAR",
        "role": "RSM",
        "own": { "planned_dealers": 25, "planned_visits": 50, "adhered": 46, "adherence_pct": 92.0 },
        "team": { "total_officers": 14, "planned_visits": 950, "adhered": 860, "adherence_pct": 90.5 },
        "children": [
          {
            "emp_code": "11002055",
            "emp_name": "BIKASH DEKA",
            "role": "ASM",
            "own": { "planned_dealers": 60, "planned_visits": 120, "adhered": 108, "adherence_pct": 90.0 },
            "team": { "total_officers": 4, "planned_visits": 320, "adhered": 290, "adherence_pct": 90.6 },
            "children": [
              {
                "emp_code": "11002057",
                "emp_name": "ABDUL HASIB AHMED",
                "role": "SO",
                "own": { "planned_dealers": 40, "planned_visits": 80, "adhered": 74, "adherence_pct": 92.5 },
                "children": []
              }
            ]
          }
        ]
      }
    ]
  }
}
```

---

### 3.2. Subordinate Officer Visit Drilldown
**Allows a superior officer (ZH, RSM, ASM) to inspect an individual subordinate's day-by-day scheduled and executed visits.**

- **Endpoint**: `GET /api/app/hierarchy/:viewerCode/officer/:empCode/visits`
- **Query Parameters**:
  - `month`: `YYYY-MM` (e.g. `2026-06`)
  - `cycle`: `C1`, `C2`, or `ALL`

#### Response Schema (`200 OK`)
```json
{
  "viewer_code": "11002055",
  "officer_code": "11002057",
  "officer_name": "ABDUL HASIB AHMED",
  "role": "SO",
  "period_month": "2026-06",
  "cycle_code": "C1",
  "summary": {
    "total_planned": 80,
    "total_adhered": 74,
    "unplanned_visits": 6,
    "adherence_pct": 92.5
  },
  "visits_by_date": [
    {
      "date": "2026-06-02",
      "planned_count": 5,
      "actual_count": 5,
      "items": [
        {
          "dealer_sap_code": "1000000058",
          "dealer_sfa_code": "NER150",
          "dealer_name": "MAA KAMAKHYA TRADERS",
          "category": "A",
          "is_planned": true,
          "is_visited": true,
          "check_in_time": "10:15:22",
          "check_out_time": "10:52:10",
          "duration": "36 Minute(s) 48 Second(s)",
          "visit_status": "Productive"
        }
      ]
    }
  ]
}
```

---

### 3.3. Multi-Role Adherence Analytics
**Provides company-wide, role-wise, and officer-wise adherence metrics matching official client workbook formulas.**

- **Endpoint**: `GET /api/app/admin/adherence`
- **Query Parameters**:
  - `month` *(required)*: e.g. `2026-06`
  - `cycle`: `C1`, `C2`, or `ALL`
  - `asOn`: `YYYY-MM-DD` (optional)
  - `productiveOnly`: `true` | `false` (default: false)

#### Response Schema (`200 OK`)
```json
{
  "period_month": "2026-06",
  "cycles": ["C1"],
  "as_on_date": "2026-06-15",
  "totals": {
    "dealers_on_plan": 1820,
    "dealers_visited": 1640,
    "dealers_missed": 180,
    "planned_visits": 3640,
    "mtd_due": 3640,
    "adhered": 3310,
    "adhered_capped": 3280,
    "pending": 330
  },
  "adherence": {
    "capped_pct": 90.1,
    "raw_pct": 90.9,
    "coverage_pct": 90.1
  },
  "by_role": {
    "ZH": {
      "dealers": 15,
      "planned": 30,
      "mtd_due": 30,
      "adhered": 28,
      "capped_pct": 93.3,
      "raw_pct": 93.3,
      "pending": 2,
      "coverage_pct": 93.3
    },
    "RSM": {
      "dealers": 45,
      "planned": 90,
      "mtd_due": 90,
      "adhered": 82,
      "capped_pct": 91.1,
      "raw_pct": 91.1,
      "pending": 8,
      "coverage_pct": 91.1
    },
    "ASM": {
      "dealers": 180,
      "planned": 360,
      "mtd_due": 360,
      "adhered": 324,
      "capped_pct": 90.0,
      "raw_pct": 90.8,
      "pending": 36,
      "coverage_pct": 89.4
    },
    "SO": {
      "dealers": 1580,
      "planned": 3160,
      "mtd_due": 3160,
      "adhered": 2876,
      "capped_pct": 89.9,
      "raw_pct": 91.0,
      "pending": 284,
      "coverage_pct": 90.2
    }
  },
  "by_employee": [
    {
      "emp_code": "11002057",
      "emp_name": "ABDUL HASIB AHMED",
      "role": "SO",
      "cycles": ["C1"],
      "planned_dealers": 40,
      "visited": 37,
      "missed": 3,
      "planned_visits": 80,
      "mtd_due": 80,
      "adhered": 74,
      "adherence_pct": 92.5,
      "missed_dealers": [
        { "sap_code": "1000000102", "name": "ASSAM CEMENT AGENCY", "planned_date": "2026-06-12" }
      ]
    }
  ],
  "by_dealer": [
    {
      "cycle": "C1",
      "role": "SO",
      "emp_code": "11002057",
      "emp_name": "ABDUL HASIB AHMED",
      "sap_code": "1000000058",
      "dealer_name": "MAA KAMAKHYA TRADERS",
      "category": "A",
      "area": "GUWAHATI RURAL",
      "planned": 2,
      "adhered": 2,
      "adherence_pct": 100.0,
      "planned_dates": ["2026-06-02", "2026-06-10"],
      "visit_dates": ["2026-06-02", "2026-06-10"]
    }
  ]
}
```

---

### 3.4. Master Dealer Visit Targets (Full 4-Tier Breakdown)
**Returns target visit frequencies for all four roles (`so_visits`, `asm_visits`, `rsm_visits`, `zh_visits`) per dealer.**

- **Endpoint**: `GET /api/djp/dealer-targets`
- **Query Parameters**:
  - `periodMonth`: `YYYY-MM` (e.g. `2026-06`)
  - `cycleCode`: `C1` | `C2`
  - `page`: default `1`
  - `limit`: default `50` (or `100`, `250`, `500`)
  - `search`: text search for dealer code, dealer name, or employee name
  - `role`: filter by employee role

#### Response Schema (`200 OK`)
```json
{
  "success": true,
  "count": 50,
  "total": 1820,
  "page": 1,
  "totalPages": 37,
  "targets": [
    {
      "id": 101,
      "period_month": "2026-06",
      "cycle_code": "C1",
      "sap_code": "1000000058",
      "sfa_code": "NER150",
      "dealer_name": "MAA KAMAKHYA TRADERS",
      "cust_type": "Dealer",
      "category": "A",
      "priority": 1,
      "priority_label": "High Priority",
      "zone": "NORTH EAST",
      "region": "ASSAM",
      "area": "GUWAHATI RURAL",
      "branch": "GUWAHATI",
      "zh_code": "11002001",
      "zh_name": "SANJAY SHARMA",
      "rsm_code": "11002050",
      "rsm_name": "RAJESH KUMAR",
      "asm_code": "11002055",
      "asm_name": "BIKASH DEKA",
      "so_emp_code": "11002057",
      "so_name": "ABDUL HASIB AHMED",
      "so_visits": 2,
      "asm_visits": 1,
      "rsm_visits": 0,
      "zh_visits": 0,
      "total_visits": 3
    }
  ]
}
```

---

### 3.5. Multi-Role Beat Plans List
**Retrieves plans across all roles, with approval status and visit counts.**

- **Endpoint**: `GET /api/app/admin/plans`
- **Query Parameters**:
  - `month`: `YYYY-MM`
  - `cycle`: `C1` | `C2` | `ALL`
  - `role`: `ALL` | `SO` | `ASM` | `RSM` | `ZH`
  - `status`: `ALL` | `DRAFT` | `SUBMITTED` | `APPROVED` | `RECTIFY`
  - `page`: default `1`, `limit`: default `50`

#### Response Schema (`200 OK`)
```json
{
  "total": 124,
  "page": 1,
  "limit": 50,
  "plans": [
    {
      "id": 402,
      "period_month": "2026-06",
      "cycle_code": "C1",
      "emp_code": "11002055",
      "emp_name": "BIKASH DEKA",
      "emp_role": "ASM",
      "status": "APPROVED",
      "total_visits": 120,
      "total_dealers": 60,
      "submitted_at": "2026-05-28 14:10:00",
      "approved_at": "2026-05-29 09:30:00",
      "approver_emp_code": "11002050",
      "approver_name": "RAJESH KUMAR",
      "approver_role": "RSM"
    }
  ]
}
```

---

### 3.6. Unplanned & Consolidated Visits (The 3 Tabs)

#### Tab 1: Unplanned Visits Report
- **Endpoint**: `GET /api/sfa/unplanned-visits`
- **Query Parameters**: `periodMonth=2026-06&employeeCode=11002057&role=SO&page=1&limit=50`
- **Fields returned (16 standard columns)**:
  `si`, `date_of_visit`, `customer_code`, `customer_name`, `route`, `type`, `branch`, `employee_code`, `employee_name`, `role`, `check_in_time`, `check_out_time`, `duration`, `visit_status`, `remarks`, `purpose_of_visit`

#### Tab 2: Consolidated Visits Report
- **Endpoint**: `GET /api/sfa/unplanned-visits/consolidated`
- **Query Parameters**: `periodMonth=2026-06&employeeCode=11002057&page=1&limit=50`
- **Fields returned (13 standard columns)**:
  `si`, `date_of_visit`, `customer_code`, `customer_name`, `route`, `type`, `branch`, `employee_code`, `employee_name`, `role`, `visit_type` (`Planned` | `Unplanned`), `adherence_status` (`Adhered` | `Missed` | `Unplanned`), `purpose_of_visit`

#### Tab 3: Planned vs Unplanned Summary
- **Endpoint**: `GET /api/sfa/unplanned-visits/planned-vs-unplanned`
- **Query Parameters**: `periodMonth=2026-06&employeeCode=11002057`
- **Fields returned**:
  `employee_code`, `employee_name`, `role`, `total_planned`, `total_adhered`, `total_unplanned`, `total_visits`, `adherence_pct`, plus `grand_total` object.

---

### 3.7. Master Employee Directory & Territory Mapping

#### Employees Directory
- **Endpoint**: `GET /api/master/employees`
- **Query Parameters**: `designation=SO` (or `ASM`, `RSM`, `ZH`, `ALL`), `page=1`, `limit=100`
- **Response**: List of employees with `emp_code`, `emp_name`, `designation`, `zone`, `region`, `headquarter`, `status`.

#### Territory Mapping
- **Endpoint**: `GET /api/admin/mapping`
- **Response**: Organizational mapping connecting `so_emp_code` → `asm_code` → `rsm_code` → `zh_code`.

---

## 4. UI / App Implementation Recommendations

### Recommended Navigation Hierarchy
1. **Role Switcher Dropdown**:
   Filter views by `All Roles`, `ZH`, `RSM`, `ASM`, or `SO`.
2. **Executive Summary Cards**:
   - Total Target Dealers
   - Planned Visits
   - MTD Due Visits
   - Adhered Visits
   - Capped Adherence %
3. **Interactive Hierarchy Tree**:
   Render `tree` from `/api/app/hierarchy/:empCode/analysis` with collapsible nodes. Clicking any node expands subordinates and displays that manager's `own` vs `team` performance.
4. **Subordinate Drilldown Modal / View**:
   When tapping an officer, call `/api/app/hierarchy/:viewerCode/officer/:empCode/visits` to show a calendar-style beat sheet with green (adhered), red (missed), and amber (unplanned) badges.
