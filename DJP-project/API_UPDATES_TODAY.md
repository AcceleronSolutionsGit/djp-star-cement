# Star Cement DJP / PJP — API Updates Documentation (11-Oct-2026)

This document specifies all **new and updated APIs** implemented today for the **Field App**, **SFA Ingestion/Sync**, and **Admin / Reporting System**, specifically regarding:
1. **Unplanned Visits Tracking & Officer Adherence**
2. **SFA Report Sync & Download restricted to T-1 Day**
3. **Plan Type Filtering (`Planned` vs `Unplanned`)**

---

## Summary of API Changes

| # | Method | Endpoint | Type | Purpose |
|---|---|---|---|---|
| 1 | `GET` | `/api/app/officers/:empCode/unplanned-visits` | **NEW** | Returns the list of unplanned visits made by a specific officer. |
| 2 | `GET` | `/api/app/officers/:empCode/adherence` | **UPDATED** | Enriched to include `unplanned_count` and `unplanned_visits` array. |
| 3 | `GET` | `/api/sfa/unplanned-visits` | **NEW** | System-wide query endpoint for unplanned visits with rich filters. |
| 4 | `POST` | `/api/sfa/sync` | **UPDATED** | Syncs SFA data up to **T-1 day** and returns planned vs unplanned visit breakdown. |
| 5 | `GET` | `/api/djp/export-sfa-logs` | **UPDATED** | Downloads SFA report Excel restricted till **T-1 day** with new **Plan Type** column. |
| 6 | `GET` | `/api/master/visit-logs` | **UPDATED** | Added `planType` filter (`ALL`, `UNPLANNED`, `PLANNED`). |
| 7 | `POST` | `/api/uploads/process` (`SFA_REPORT`) | **UPDATED** | Reconciles unplanned visits upon file upload. |

---

## 1. Field App: Officer Unplanned Visits (NEW)

### `GET /api/app/officers/:empCode/unplanned-visits`

Allows a sales officer to view all unplanned visits they logged via SFA or field punch that were not part of their scheduled beat plan.

#### Request Parameters (Query String)
| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `month` | string | No | — | Filter by month (`YYYY-MM`), e.g. `2026-10` |
| `startDate` | string | No | — | Filter by start date (`YYYY-MM-DD`) |
| `endDate` | string | No | — | Filter by end date (`YYYY-MM-DD`) |
| `search` | string | No | — | Search customer name, code, or branch |
| `limit` | integer | No | `100` | Max rows to return (max 1000) |
| `offset` | integer | No | `0` | Pagination offset |

#### Example Request
```http
GET /api/app/officers/11001774/unplanned-visits?month=2026-10 HTTP/1.1
Host: localhost:3001
```

#### Success Response (`200 OK`)
```json
{
  "emp_code": "11001774",
  "total": 2,
  "unplanned_visits": [
    {
      "id": 4821,
      "visit_date": "2026-10-09",
      "customer_code": "1000001150",
      "mapped_sap_code": "1000001150",
      "customer_name": "PUNAM ENTERPRISE",
      "customer_type": "DEALER",
      "route": "DHARMANAGAR",
      "branch": "DHARMANAGAR",
      "employee_code": "11001774",
      "employee_name": "DEBABRATA CHAKRABORTY- FKT",
      "check_in_time": "10:15:00",
      "check_out_time": "10:45:00",
      "duration": "30 Minute(s)",
      "visit_status": "Productive",
      "purpose_of_visit": "Routine Visit",
      "remarks": "Order placed for 15MT",
      "is_unplanned": 1,
      "reason": "Dealer not on officer's plan"
    },
    {
      "id": 4835,
      "visit_date": "2026-10-07",
      "customer_code": "1000001587",
      "mapped_sap_code": "1000001587",
      "customer_name": "SUBHASISH KARMAKAR",
      "customer_type": "DEALER",
      "route": "KAILASHAHAR",
      "branch": "KAILASHAHAR",
      "employee_code": "11001774",
      "employee_name": "DEBABRATA CHAKRABORTY- FKT",
      "check_in_time": "14:20:00",
      "check_out_time": "14:50:00",
      "duration": "30 Minute(s)",
      "visit_status": "Non productive",
      "purpose_of_visit": "Collection",
      "remarks": null,
      "is_unplanned": 1,
      "reason": "Dealer not on officer's plan"
    }
  ]
}
```

---

## 2. Field App: Officer Adherence (UPDATED)

### `GET /api/app/officers/:empCode/adherence`

Returns the officer's adherence calculations. **Updated today** to include `unplanned_count` and `unplanned_visits` list directly in the response so the mobile app does not need to issue multiple network requests.

#### Example Request
```http
GET /api/app/officers/11001774/adherence?cycle=C1 HTTP/1.1
Host: localhost:3001
```

#### Success Response (`200 OK`)
```json
{
  "emp_code": "11001774",
  "emp_name": "DEBABRATA CHAKRABORTY- FKT",
  "role": "SO",
  "month": "2026-10",
  "cycle": "C1",
  "as_on_date": "2026-10-10",
  "elapsed_fraction": 0.667,
  "has_plan": true,
  "totals": {
    "dealers_on_plan": 18,
    "dealers_visited": 12,
    "dealers_missed": 6,
    "planned_visits": 24,
    "mtd_due": 16.0,
    "adhered": 14,
    "adhered_capped": 14,
    "pending": 2.0
  },
  "adherence": {
    "capped_pct": 87.5,
    "raw_pct": 87.5,
    "over_visited": false
  },
  "unplanned_count": 2,
  "unplanned_visits": [
    {
      "employee_code": "11001774",
      "employee_name": "DEBABRATA CHAKRABORTY- FKT",
      "customer_code": "1000001150",
      "canonical_code": "1000001150",
      "customer_name": "PUNAM ENTERPRISE",
      "visit_date": "2026-10-09"
    }
  ],
  "dealers": [
    {
      "sap_code": "1000001147",
      "dealer_name": "MAA TARA TRADERS",
      "cycle": "C1",
      "planned": 2,
      "adhered": 2,
      "adhered_capped": 2,
      "pending": 0,
      "planned_dates": ["2026-10-03", "2026-10-08"],
      "visit_dates": ["2026-10-03", "2026-10-08"],
      "state": "DONE"
    }
  ],
  "method": "MTD due = planned x elapsed fraction of the cycle; capped adherence never exceeds 100%"
}
```

---

## 3. SFA Unplanned Visits System API (NEW)

### `GET /api/sfa/unplanned-visits`

Universal query endpoint for managers, web dashboards, or system integrations to pull unplanned visits.

#### Request Parameters (Query String)
| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `employeeCode` | string | No | `ALL` | Filter by officer employee code |
| `periodMonth` | string | No | — | Filter by month (`YYYY-MM`) |
| `startDate` | string | No | — | Filter start date (`YYYY-MM-DD`) |
| `endDate` | string | No | — | Filter end date (`YYYY-MM-DD`) |
| `search` | string | No | — | Text search customer, officer, branch |
| `limit` | integer | No | `100` | Pagination limit |
| `offset` | integer | No | `0` | Pagination offset |

#### Success Response (`200 OK`)
```json
{
  "total": 15,
  "visits": [
    {
      "id": 3021,
      "visit_date": "2026-10-08",
      "customer_code": "WBM273",
      "mapped_sap_code": "1000002891",
      "customer_name": "ROY & SONS",
      "customer_type": "DEALER",
      "route": "AGARTALA",
      "branch": "AGARTALA",
      "employee_code": "11002168",
      "employee_name": "SUBHASISH KARMAKAR",
      "check_in_time": "11:00:00",
      "check_out_time": "11:35:00",
      "duration": "35 Minute(s)",
      "visit_status": "Productive",
      "purpose_of_visit": "Payment Followup",
      "remarks": null,
      "is_unplanned": 1,
      "reason": "Dealer not on officer's plan"
    }
  ]
}
```

---

## 4. Live SFA Adherence Sync API (UPDATED)

### `POST /api/sfa/sync`

Triggers live SFA API synchronization from the upstream SFA endpoint (`http://52.66.31.108/...`).

#### What Changed Today:
1. **Date Range Restricted to T-1 Day**:
   - `endDate` is set to `new Date(now - 1 day)` (`yesterday`).
   - Ensures that in-progress visits from today are not prematurely synced as partial misses.
2. **Automated Plan Reconciliation**:
   - Evaluates each newly ingested SFA visit against `sales_plan_details` and `dealer_visit_targets`.
   - Populates `is_unplanned = 1` for visits to dealers not in the officer's plan.
3. **Rich Response**:
   - Returns counts and array of unplanned visits directly to caller.

#### Success Response (`200 OK`)
```json
{
  "status": "success",
  "inserted": 348,
  "batchCode": "BAT-202610-SYNC-819",
  "syncedUntil": "2026-10-10",
  "plannedCount": 331,
  "unplannedCount": 17,
  "unplannedVisits": [
    {
      "id": 5102,
      "visit_date": "2026-10-09",
      "customer_code": "1000001150",
      "mapped_sap_code": "1000001150",
      "customer_name": "PUNAM ENTERPRISE",
      "customer_type": "DEALER",
      "route": "DHARMANAGAR",
      "branch": "DHARMANAGAR",
      "employee_code": "11001774",
      "employee_name": "DEBABRATA CHAKRABORTY- FKT",
      "check_in_time": "10:15:00",
      "check_out_time": "10:45:00",
      "duration": "30 Minute(s)",
      "visit_status": "Productive",
      "unplanned_type": "DEALER_NOT_ON_PLAN",
      "reason": "Dealer not on officer's plan"
    }
  ]
}
```

---

## 5. Download SFA Report Excel (UPDATED)

### `GET /api/djp/export-sfa-logs`

Downloads the complete SFA execution report in Microsoft Excel (`.xlsx`) format.

#### What Changed Today:
1. **Date Bound Capped at T-1 Day**:
   - Only records with `visit_date <= T-1` are exported.
2. **Added `Plan Type` Column**:
   - Every row now carries `'Plan Type'` set to `'Planned'` or `'Unplanned'`.
3. **Response Headers**:
   - `Content-Disposition: attachment; filename="SFA_Report_Till_T-1_YYYY-MM-DD.xlsx"`
   - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

#### Column Structure of Exported Sheet:
1. `Date of Visit` (`YYYY-MM-DD`)
2. **`Plan Type`** (`Planned` / `Unplanned`)
3. `SFA Customer Code`
4. `Mapped SAP Code`
5. `Customer Name`
6. `Type`
7. `Route`
8. `Branch`
9. `Employee Code`
10. `Employee Name`
11. `Check In Time`
12. `Check Out Time`
13. `Duration`
14. `Visit Status`
15. `Purpose Of Visit`
16. `Remarks`

---

## 6. SFA Visit Logs Query API (UPDATED)

### `GET /api/master/visit-logs`

Used by Master Data Repository (TAB 5) and external dashboards.

#### What Changed Today:
- Added `planType` query parameter:
  - `planType=UNPLANNED`: Returns only unplanned visits (`is_unplanned = 1`).
  - `planType=PLANNED`: Returns only scheduled visits (`is_unplanned = 0`).
  - `planType=ALL` (default): Returns all visits.

#### Request Parameters (Query String)
| Parameter | Type | Options / Example |
|---|---|---|
| `planType` | string | `ALL`, `UNPLANNED`, `PLANNED` |
| `visitDate` | string | `ALL`, `2026-10-09` |
| `employeeName` | string | `ALL`, `DEBABRATA CHAKRABORTY- FKT` |
| `branch` | string | `ALL`, `DHARMANAGAR` |
| `route` | string | `ALL`, `DHARMANAGAR` |
| `visitStatus` | string | `ALL`, `Productive`, `Non productive` |
| `customerType` | string | `ALL`, `DEALER`, `PROSPECTIVE` |
| `search` | string | Free-text keyword search |
| `limit` | integer | Default `50` |
| `offset` | integer | Default `0` |

---

## 7. Status Codes & Error Handling

All endpoints follow standard HTTP error responses:

| Code | Meaning | Cause |
|---|---|---|
| `200` | OK | Request succeeded. |
| `201` | Created | Resource successfully created (e.g. visit punched). |
| `400` | Bad Request | Missing required query/body parameters. |
| `401` | Unauthorized | Missing or invalid auth token (for protected routes). |
| `404` | Not Found | Employee code or plan ID does not exist. |
| `409` | Conflict | Duplicate punch or conflicting plan action. |
| `500` | Internal Server Error | Database or network error. |
