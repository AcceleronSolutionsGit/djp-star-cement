# Star Cement PJP / DJP Engine — React Native API Reference

> **Base URL:** `http://<SERVER_HOST>:3000/api`
> **Auth:** Bearer token (received from login). Add `Authorization: Bearer <token>` header.
> **Content-Type:** `application/json` for all requests except file uploads.
> **File Uploads:** `multipart/form-data`
> **Server Port:** `3000` (configured via `.env`)

---

## Table of Contents

1. [Auth](#1-auth)
2. [Field App APIs (Mobile / App Engine)](#2-field-app-apis-mobile--app-engine)
   - [2.1 Architecture & Permissions](#21-architecture--permissions)
   - [2.2 Officer Endpoints](#22-officer-endpoints-apiappofficersempcode)
   - [2.3 Approver Endpoints](#23-approver-endpoints-apiappapproversempcode)
   - [2.4 Hierarchy & Drill-Down](#24-hierarchy--drill-down-apiapphierarchy)
   - [2.5 Field Admin & System Endpoints](#25-field-admin--system-endpoints-apiappadmin)
3. [Plans & Workflows (Admin / Backend)](#3-plans--workflows-admin--backend)
4. [Employees](#4-employees)
5. [Admin — Dashboard & Filters](#5-admin--dashboard--filters)
6. [Admin — Business Rules](#6-admin--business-rules)
7. [Master Data](#7-master-data)
8. [Uploads & Batches](#8-uploads--batches)
9. [DJP Engine](#9-djp-engine)
10. [Generation Runs (Batch-Isolated)](#10-generation-runs-batch-isolated)
11. [PJP Canonical Engine](#11-pjp-canonical-engine)
12. [Export APIs — File Downloads](#12-export-apis--file-downloads)
13. [Healthcheck](#13-healthcheck)
14. [Error Reference](#14-error-reference)
15. [React Native Setup & Tips](#15-react-native-setup--tips)

---

## 1. Auth

### `POST /api/auth/login`

Authenticate a user and receive a session token.

**Request Body:**
```json
{
  "username": "admin",
  "password": "admin"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `username` | string | Yes | Username (not email) |
| `password` | string | Yes | Plain-text password |

**Built-in Credentials:**

| Username | Password | Role |
|---|---|---|
| `admin` | `admin` | Admin |
| `so` | `so` | Sales Officer |

**Success `200`:**
```json
{
  "user": {
    "username": "admin",
    "role": "admin"
  },
  "token": "mock-admin-token-123"
}
```

**Error Responses:**

| Status | Body |
|---|---|
| `400` | `{ "error": "Username and password are required" }` |
| `401` | `{ "error": "Invalid username or password" }` |
| `500` | `{ "error": "Internal server error" }` |

**React Native Example:**
```javascript
const login = async (username, password) => {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  await AsyncStorage.setItem('token', data.token);
  return data; // { user, token }
};
```

---

## 2. Field App APIs (Mobile / App Engine)

> **Mobile Architecture & Auth Model:**
> Unlike the admin/web portal, Field App APIs under `/api/app/...` do **not** require Bearer tokens.
> The active officer or manager is identified by their Employee Code in the URL path (`:empCode`).
> The backend automatically validates employee identity, resolves hierarchy and ownership, and enforces role-based permissions directly.

### 2.1 Architecture & Permissions

#### Hierarchy & Approval Matrix:
- **SO** (Sales Officer) → L1 Approver: **ASM** (Area Sales Manager)
- **ASM** → L1 Approver: **RSM** (Regional Sales Manager)
- **RSM** → L1 Approver: **ZH** (Zonal Head)
- **ZH** → L1 Approver: **ADMIN**

#### Plan Lifecycle & Strict Rectify-Once Policy:
```
[DRAFT]  ----(Submit)---->  [SUBMITTED]  ----(Approve)----> [APPROVED] (Locked for Punching)
   ^                               |
   |----(Rectify: Max 1 time)------|
```
- **`DRAFT`**: Owned and editable by the officer. Officer can add dealers from their pool, reschedule/move visits, and delete visits.
- **`SUBMITTED`**: Locked for editing. Moved to the designated L1 Approver's inbox.
- **`RECTIFY`**: Returned by L1 with mandatory feedback comments. The plan becomes editable again for the officer.
  - **Single Rectification Guarantee (`MAX_RECTIFICATIONS = 1`):** A manager can only send a plan back for rectification once. Once re-submitted, the only permitted manager action is `APPROVE`.
- **`APPROVED`**: Final approved schedule. Visited counters are ready for field check-in / check-out ("punching").

> [!IMPORTANT]
> **Unmapped Dealers Business Rule:**  
> **Unmapped dealers are NEVER auto-generated.**  
> The backend PJP / DJP auto-generation engine schedules **only mapped target counters** with pre-allocated visit quotas (`required_visits > 0`).  
> Unmapped dealers (from master records or new ground prospects) can **only be added manually by Sales Officers (SOs)** directly into their plans while in `DRAFT` or `RECTIFY` status.

---

### 2.2 Officer Endpoints (`/api/app/officers/:empCode/...`)

#### `GET /api/app/officers/:empCode/summary`

Fetch home screen status counters and action indicators for the mobile app dashboard.

**Path Parameters:**
| Param | Type | Description |
|---|---|---|
| `empCode` | string | Officer employee code (e.g. `2500070`) |

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `month` | string | No | Filter by month `YYYY-MM` (e.g. `2026-07`). Default: `ALL` |

**Success `200`:**
```json
{
  "emp_code": "2500070",
  "emp_name": "PIKAN SAHA",
  "role": "SO",
  "month": "2026-07",
  "my_plans": {
    "DRAFT": 1,
    "SUBMITTED": 0,
    "APPROVED": 1,
    "RECTIFY": 0
  },
  "awaiting_my_approval": 0,
  "action_required": 1
}
```

---

#### `GET /api/app/officers/:empCode/plans`

List all plans owned by the officer, including cycle breakdowns and status pills.

**Path Parameters:**
| Param | Type | Description |
|---|---|---|
| `empCode` | string | Officer employee code |

**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `month` | string | Month filter in `YYYY-MM` format |
| `cycle` | string | Cycle filter: `C1`, `C2`, or `ALL` |
| `status` | string | Status filter: `DRAFT`, `SUBMITTED`, `APPROVED`, `RECTIFY`, or `ALL` |

**Success `200`:**
```json
{
  "emp_code": "2500070",
  "role": "SO",
  "filter": { "month": "2026-07", "cycle": "ALL", "status": "ALL" },
  "count": 2,
  "plans": [
    {
      "plan_id": 4,
      "period_month": "2026-07",
      "cycle_code": "C1",
      "status": "APPROVED",
      "employee": {
        "emp_code": "2500070",
        "emp_name": "PIKAN SAHA",
        "role": "SO"
      },
      "approver": {
        "emp_code": "11001772",
        "name": "BIKRAM KUMAR HALDER",
        "role": "ASM"
      },
      "counts": {
        "visits": 24,
        "dealers": 18,
        "working_days": 12
      },
      "date_range": {
        "from": "2026-07-01",
        "to": "2026-07-15"
      },
      "rectification": {
        "count": 0,
        "remaining": 1,
        "requested_by": null,
        "requested_at": null,
        "remarks": null
      },
      "timestamps": {
        "created_at": "2026-06-25T08:30:00.000Z",
        "submitted_at": "2026-06-26T11:00:00.000Z",
        "approved_at": "2026-06-27T09:15:00.000Z"
      },
      "actions": {
        "can_edit": false,
        "can_submit": false,
        "can_approve": false,
        "can_rectify": false,
        "rectify_blocked_reason": null
      }
    }
  ]
}
```

---

#### `GET /api/app/officers/:empCode/plans/:planId`

Get full plan detail, day-by-day scheduled visits, dealer location/category metadata, category mix breakdown, cycle constraints, and permitted UI actions.

**Path Parameters:**
| Param | Type | Description |
|---|---|---|
| `empCode` | string | Officer employee code |
| `planId` | number | Plan ID |

**Success `200`:**
```json
{
  "plan": {
    "plan_id": 4,
    "period_month": "2026-07",
    "cycle_code": "C1",
    "status": "APPROVED",
    "employee": {
      "emp_code": "2500070",
      "emp_name": "PIKAN SAHA",
      "role": "SO"
    },
    "approver": {
      "emp_code": "11001772",
      "name": "BIKRAM KUMAR HALDER",
      "role": "ASM"
    },
    "counts": {
      "visits": 24,
      "dealers": 18,
      "working_days": 12
    },
    "date_range": {
      "from": "2026-07-01",
      "to": "2026-07-15"
    },
    "rectification": {
      "count": 0,
      "remaining": 1,
      "requested_by": null,
      "requested_at": null,
      "remarks": null
    },
    "timestamps": {
      "created_at": "2026-06-25T08:30:00.000Z",
      "submitted_at": "2026-06-26T11:00:00.000Z",
      "approved_at": "2026-06-27T09:15:00.000Z"
    },
    "actions": {
      "can_edit": false,
      "can_submit": false,
      "can_approve": false,
      "can_rectify": false,
      "rectify_blocked_reason": null
    },
    "category_mix": {
      "Growing": 14,
      "Elite": 6,
      "Routine": 4
    },
    "cycle_window": {
      "from": "2026-07-01",
      "to": "2026-07-15",
      "min_per_day": 1,
      "max_per_day": 4
    },
    "days": [
      {
        "date": "2026-07-01",
        "day_of_week": "Wednesday",
        "visit_count": 2,
        "visits": [
          {
            "detail_id": 189,
            "sequence": 1,
            "dealer": {
              "dealer_id": 23,
              "sap_code": "1000000051",
              "sfa_code": "NEM065",
              "name": "MODAK TRADERS (AGARTALA)",
              "type": "STAR",
              "area": "AGARTALA",
              "zone": "NE2",
              "block": "KALYANPUR"
            },
            "final_category": "Growing",
            "grade": "D",
            "priority_score": 8,
            "purpose_of_visit": "PJP Scheduled Visit (D - Growing)",
            "visit_status": "ACTIVE",
            "executed": true,
            "execution": {
              "check_in_time": "10:15:00",
              "check_out_time": "10:48:00",
              "duration": "33 Minute(s)",
              "status": "Productive"
            },
            "source": "AUTO"
          }
        ]
      }
    ],
    "history": [
      {
        "action": "SUBMITTED",
        "action_by": "2500070",
        "action_at": "2026-06-26T11:00:00.000Z",
        "remarks": "Submitting July C1 plan"
      },
      {
        "action": "APPROVED",
        "action_by": "11001772",
        "action_at": "2026-06-27T09:15:00.000Z",
        "remarks": "Approved"
      }
    ]
  }
}
```

---

#### `GET /api/app/officers/:empCode/dealers`

Fetch dealers eligible to be added to this officer's plan for the period. Supports fetching **Target Dealers** (mapped to the officer), **Unmapped Dealers** (all other active or prospective dealers from master data), or **All Counters**.

**Path Parameters:**
| Param | Type | Description |
|---|---|---|
| `empCode` | string | Officer employee code |

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `month` | string | Yes | Period month `YYYY-MM` (e.g. `2026-07`) |
| `cycle` | string | No | `C1` or `C2` (default: `C1`) |
| `scope` | string | No | `mapped` (default), `unmapped`, or `all` |
| `search` | string | No | Search string (matches counter name, SAP code, SFA code, area, block) |
| `limit` | number | No | Results limit (default: `200`, max: `1000`) |
| `offset` | number | No | Offset for pagination (default: `0`) |

**Success `200` (Mapped Dealers — Default):**
```json
{
  "emp_code": "2500070",
  "role": "SO",
  "month": "2026-07",
  "cycle": "C1",
  "scope": "mapped",
  "count": 28,
  "dealers": [
    {
      "sap_code": "1000000051",
      "sfa_code": "NEM065",
      "dealer_name": "MODAK TRADERS (AGARTALA)",
      "area": "AGARTALA",
      "zone": "NE2",
      "block": "KALYANPUR",
      "final_category": "Growing",
      "grade": "D",
      "priority_score": 8,
      "required_visits": 2,
      "already_planned": 1,
      "is_unmapped": false
    }
  ]
}
```

**Success `200` (Unmapped Dealers — `?scope=unmapped`):**
```json
{
  "emp_code": "2500070",
  "role": "SO",
  "month": "2026-07",
  "cycle": "C1",
  "scope": "unmapped",
  "count": 45,
  "dealers": [
    {
      "sap_code": "1000000013",
      "sfa_code": "B138",
      "dealer_name": "BANKA BEHARI PAUL",
      "area": "AGARTALA",
      "zone": "NE2",
      "block": "AMC (SADAR)",
      "final_category": "Unmapped",
      "grade": "C",
      "priority_score": 0,
      "required_visits": 0,
      "already_planned": 0,
      "is_unmapped": true
    }
  ]
}
```

---

#### `POST /api/app/officers/:empCode/plans/:planId/visits`

Add a dealer visit to a specific date on a `DRAFT` or `RECTIFY` plan.
**Supports both Mapped and Unmapped Dealers:**
1. **Mapped Target Counter:** Provide `dealerSapCode` or `dealerSfaCode`.
2. **Existing Master Unmapped Counter:** Provide `dealerSapCode` or `dealerSfaCode` with `isUnmapped: true`.
3. **New Unmapped Counter (Ground Prospect):** Provide `dealerName`, `dealerType: "PROSPECTIVE"`, `area`, `block`, and `isUnmapped: true`.

**Path Parameters:**
| Param | Type | Description |
|---|---|---|
| `empCode` | string | Officer employee code |
| `planId` | number | Plan ID |

**Request Body (Adding Existing Counter):**
```json
{
  "visitDate": "2026-07-04",
  "dealerSapCode": "1000000013",
  "isUnmapped": true,
  "purposeOfVisit": "Unmapped counter market introduction"
}
```

**Request Body (Adding New Ground Prospect):**
```json
{
  "visitDate": "2026-07-04",
  "dealerName": "Guwahati Cement Depot",
  "dealerType": "PROSPECTIVE",
  "area": "GUWAHATI",
  "block": "DISPUR",
  "isUnmapped": true,
  "purposeOfVisit": "New dealer onboarding pitch"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `visitDate` | string | Yes | Date string `YYYY-MM-DD` within cycle window |
| `dealerSapCode` | string | Yes* | Dealer SAP code (or `dealerSfaCode` for prospects) |
| `dealerName` | string | No* | Required if adding a new unmapped dealer by name |
| `dealerType` | string | No | E.g. `"STAR"`, `"PROSPECTIVE"`, `"DEALER"` (default: `"PROSPECTIVE"`) |
| `area` | string | No | Counter territory area |
| `block` | string | No | Counter block / sub-district |
| `isUnmapped` | boolean | No | Set to `true` when adding an unmapped counter |
| `purposeOfVisit` | string | No | Purpose of visit description |

**Success `200`:**
```json
{
  "success": true,
  "message": "BANKA BEHARI PAUL (Unmapped) added to 2026-07-04.",
  "detail_id": 342,
  "plan_id": 4,
  "is_unmapped": true
}
```

**Errors:**
- `400`: `visitDate` outside cycle window, or counter code not found and no `dealerName` provided.
- `409`: Plan is not editable (`SUBMITTED` or `APPROVED`), or daily visit capacity limit reached.

---

#### `PUT /api/app/officers/:empCode/plans/:planId/visits/:detailId`

Reschedule an existing visit to another date or update its visit sequence.

**Path Parameters:**
| Param | Type | Description |
|---|---|---|
| `empCode` | string | Officer employee code |
| `planId` | number | Plan ID |
| `detailId` | number | Detail/Visit ID |

**Request Body:**
```json
{
  "visitDate": "2026-07-05",
  "sequence": 2,
  "purposeOfVisit": "Rescheduled meeting"
}
```

**Success `200`:**
```json
{
  "success": true,
  "message": "MODAK TRADERS (AGARTALA) moved to 2026-07-05.",
  "plan_id": 4,
  "detail_id": 342
}
```

---

#### `DELETE /api/app/officers/:empCode/plans/:planId/visits/:detailId`

Drop a visit from a `DRAFT` or `RECTIFY` plan.

**Success `200`:**
```json
{
  "success": true,
  "message": "MODAK TRADERS (AGARTALA) removed from 2026-07-04.",
  "plan_id": 4
}
```

---

#### `POST /api/app/officers/:empCode/plans/:planId/submit`

Submit a plan to the officer's L1 approver. Re-verifies hierarchy routing and validates that the plan contains visits.

**Request Body:**
```json
{
  "remarks": "July C1 plan ready for review"
}
```

**Success `200`:**
```json
{
  "success": true,
  "message": "Plan 4 submitted to BIKRAM KUMAR HALDER for approval.",
  "plan_id": 4,
  "status": "SUBMITTED",
  "is_resubmission": false,
  "visits_submitted": 24,
  "approver": {
    "emp_code": "11001772",
    "name": "BIKRAM KUMAR HALDER",
    "role": "ASM"
  },
  "rectification_remaining": 1
}
```

---

#### `POST /api/app/officers/:empCode/visits/punch`

Field visit execution check-in / check-out ("punching"). Writes directly to `visit_execution_logs` under batch `APP-PUNCH-<month>`. Supports both planned visits and ad-hoc unplanned visits.

**Request Body:**
```json
{
  "visitDate": "2026-07-01",
  "dealerCode": "1000000051",
  "checkInTime": "10:15:00",
  "checkOutTime": "10:48:00",
  "duration": "33 Minute(s)",
  "visitStatus": "Productive",
  "purposeOfVisit": "PJP Scheduled Visit (D - Growing)",
  "remarks": "Order placed: 50 MT"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `visitDate` | string | Yes | Date string `YYYY-MM-DD` |
| `dealerCode` | string | Yes | Dealer SAP Code or SFA Code |
| `checkInTime` | string | No | `HH:MM:SS` (default: server auto) |
| `checkOutTime` | string | No | `HH:MM:SS` (default: server auto) |
| `duration` | string | No | E.g. `"33 Minute(s)"` (default: calculated) |
| `visitStatus` | string | No | `"Productive"` or `"Non productive"` (default: `"Productive"`) |
| `purposeOfVisit` | string | No | Visit purpose |
| `remarks` | string | No | Field observations |

**Success `201`:**
```json
{
  "message": "Punched MODAK TRADERS (AGARTALA) on 2026-07-01.",
  "planned": true,
  "cycle_code": "C1",
  "sfa_row": {
    "Date of Visit": "2026-07-01",
    "Customer Code": "NEM065",
    "Customer Name": "MODAK TRADERS (AGARTALA)",
    "Type": "STAR",
    "Route": "AGARTALA",
    "Branch": "KALYANPUR",
    "Employee Code": "2500070",
    "Visit Status(Productive / Non productive)": "Productive",
    "Purpose Of Visit": "PJP Scheduled Visit (D - Growing)",
    "Remarks": "Order placed: 50 MT"
  }
}
```

**Errors:**
- `409`: Counter already punched on this day by this officer.

---

#### `GET /api/app/officers/:empCode/adherence`

Officer personal performance & adherence scorecard.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `month` | string | Yes | Period month `YYYY-MM` |
| `cycle` | string | No | `C1` or `C2` |
| `asOn` | string | No | Cutoff date `YYYY-MM-DD` |

**Success `200`:**
```json
{
  "emp_code": "2500070",
  "emp_name": "PIKAN SAHA",
  "role": "SO",
  "period_month": "2026-07",
  "cycle_code": "C1",
  "summary": {
    "planned_visits": 24,
    "completed_visits": 20,
    "productive_visits": 18,
    "adherence_pct": 83.3,
    "unplanned_visits": 2
  },
  "counters": {
    "targeted": 18,
    "covered": 16,
    "coverage_pct": 88.9
  }
}
```

---

### 2.3 Approver Endpoints (`/api/app/approvers/:empCode/...`)

#### `GET /api/app/approvers/:empCode/inbox`

Fetch all submitted plans awaiting this manager's review.

**Path Parameters:**
| Param | Type | Description |
|---|---|---|
| `empCode` | string | Manager employee code (or `ADMIN`) |

**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `month` | string | `YYYY-MM` |
| `status` | string | Status filter (default: `SUBMITTED`, or `ALL`) |

**Success `200`:**
```json
{
  "approver": {
    "emp_code": "11001772",
    "name": "BIKRAM KUMAR HALDER",
    "role": "ASM"
  },
  "filter": { "status": "SUBMITTED", "month": "2026-07" },
  "count": 1,
  "plans": [
    {
      "plan_id": 4,
      "period_month": "2026-07",
      "cycle_code": "C1",
      "status": "SUBMITTED",
      "employee": {
        "emp_code": "2500070",
        "emp_name": "PIKAN SAHA",
        "role": "SO"
      },
      "approver": {
        "emp_code": "11001772",
        "name": "BIKRAM KUMAR HALDER",
        "role": "ASM"
      },
      "counts": {
        "visits": 24,
        "dealers": 18,
        "working_days": 12
      },
      "rectification": { "count": 0, "remaining": 1 }
    }
  ]
}
```

---

#### `GET /api/app/approvers/:empCode/plans/:planId`

Detailed review of a subordinate's plan with manager-specific action flags (`can_approve: true`, `can_rectify: true`).

---

#### `POST /api/app/approvers/:empCode/plans/:planId/decision`

Approve or send back a plan for rectification.

**Request Body (Approve):**
```json
{
  "action": "APPROVE",
  "remarks": "Approved for July C1"
}
```

**Request Body (Rectify):**
```json
{
  "action": "RECTIFY",
  "remarks": "Please add more visits to Udaipur area dealers."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | Yes | `"APPROVE"` or `"RECTIFY"` |
| `remarks` | string | Yes (if RECTIFY) | Explanatory remarks for the officer |

**Success `200` (Approve):**
```json
{
  "success": true,
  "message": "Plan 4 approved.",
  "plan_id": 4,
  "status": "APPROVED",
  "action": "APPROVE"
}
```

**Success `200` (Rectify):**
```json
{
  "success": true,
  "message": "Plan 4 sent back for rectification. The agent has been notified.",
  "plan_id": 4,
  "status": "RECTIFY",
  "action": "RECTIFY",
  "rectification_count": 1,
  "rectifications_remaining": 0
}
```

**Errors:**
- `400`: Missing required remarks on rectification.
- `409`: Plan is not in `SUBMITTED` state, or plan has already been rectified once.

---

#### `GET /api/app/approvers/:empCode/team-adherence`

Manager view of team execution performance across direct reports.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `month` | string | Yes | `YYYY-MM` |
| `cycle` | string | No | `C1` or `C2` |
| `asOn` | string | No | Cutoff date `YYYY-MM-DD` |

**Success `200`:**
```json
{
  "approver": {
    "emp_code": "11001772",
    "name": "BIKRAM KUMAR HALDER",
    "role": "ASM"
  },
  "month": "2026-07",
  "cycle": "C1",
  "team_count": 5,
  "team": [
    {
      "emp_code": "2500070",
      "emp_name": "PIKAN SAHA",
      "role": "SO",
      "planned_visits": 24,
      "completed_visits": 20,
      "adherence_pct": 83.3,
      "counters_covered_pct": 88.9
    }
  ]
}
```

---

#### `GET /api/app/approvers/:empCode/adherence/daily`
Team day-by-day visit adherence matrix.

#### `GET /api/app/approvers/:empCode/adherence/counters`
Team counter-level coverage and repeat visit performance.

---

### 2.4 Hierarchy & Drill-Down (`/api/app/hierarchy/...`)

#### `GET /api/app/hierarchy/:empCode/analysis`
Multi-level organizational performance analysis down from this employee.
- **Query Parameters:** `month`, `cycle`, `asOn`, `depth` (`1` = direct reports, `2` = recursive team).

#### `GET /api/app/hierarchy/:viewerCode/officer/:empCode/visits`
Manager drill-down into an individual officer's raw punch logs and execution audits.

---

### 2.5 Field Admin & System Endpoints (`/api/app/admin/...`)

#### `GET /api/app/admin/plan-periods`
List all generated plan periods, cycle codes, and officer/plan counts.

**Success `200`:**
```json
{
  "periods": [
    {
      "month": "2026-07",
      "plans": 14,
      "officers": 7,
      "cycles": {
        "C1": { "plans": 7, "visits": 168 },
        "C2": { "plans": 7, "visits": 168 }
      },
      "by_status": {
        "DRAFT": 2,
        "SUBMITTED": 4,
        "APPROVED": 8
      }
    }
  ]
}
```

#### `GET /api/app/admin/plans`
Global directory of all sales plans with multi-faceted search, filters, pagination, and rollup metrics.
- **Query Parameters:** `month`, `cycle`, `status`, `role`, `search`, `limit`, `offset`

#### `GET /api/app/admin/plans/:planId`
Unrestricted detail view of any plan without ownership restrictions.

#### `GET /api/app/admin/adherence`
Organization-wide adherence report across all zones, regions, and roles.
- **Query Parameters:** `month`, `cycle`, `asOn`, `productiveOnly=1`

#### `GET /api/app/admin/cycle-handover`
Audit of unvisited C1 counters and rollover into C2 targets.

#### `GET /api/app/admin/c2-regenerations` & `GET /api/app/admin/c2-regenerations/:id`
Review automated C2 regeneration runs and diff reports.

#### `POST /api/app/routing/restamp`
Re-evaluate and restamp approval hierarchy routing on existing plans when organizational changes occur.
- **Body:** `{ "periodMonth": "2026-07", "cycleCode": "C1" }`

---

## 3. Plans & Workflows (Admin / Backend)

### `POST /api/plans/generate`

Auto-generate a DJP plan for an employee for a given month.

**Request Body:**
```json
{
  "empCode": "SO001",
  "planMonth": "2026-09",
  "role": "SO",
  "cycleCode": "C1"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `empCode` | string | Yes | Employee code |
| `planMonth` | string | Yes | `YYYY-MM` format |
| `role` | string | No | `SO` / `ASM` / `RSM` / `ZH` (default: `SO`) |
| `cycleCode` | string | No | `C1` / `C2` (default: `C1`) |

**Success `200`:**
```json
{
  "planId": 42,
  "empCode": "SO001",
  "planMonth": "2026-09",
  "status": "DRAFT",
  "totalVisits": 180,
  "scheduledVisits": 165,
  "unallocatedVisits": 15,
  "details": [
    {
      "visitDate": "2026-09-03",
      "dealerName": "Star Traders",
      "dealerSapCode": "DL001",
      "sequence": 1,
      "purposeOfVisit": "Routine Visit"
    }
  ]
}
```

---

### `GET /api/plans`

List all plans, optionally filtered by employee.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `empCode` | string | Employee code, or omit / pass `ALL` for all |
| `role` | string | Role filter |

**Success `200`:**
```json
{
  "plans": [
    {
      "id": 42,
      "emp_code": "SO001",
      "plan_month": "2026-09",
      "cycle_code": "C1",
      "status": "DRAFT",
      "created_at": "2026-09-01T10:30:00.000Z",
      "submitted_at": null,
      "approved_by": null,
      "approved_at": null,
      "remarks": ""
    }
  ]
}
```

**Plan Status Lifecycle:**
```
DRAFT  -->  SUBMITTED  -->  APPROVED
                       -->  REJECTED
```

---

### `GET /api/plans/:planId/details`

Get all scheduled visits for a plan.

**Path Params:** `planId` (number)

**Success `200`:**
```json
{
  "details": [
    {
      "id": 101,
      "plan_id": 42,
      "visit_date": "2026-09-03",
      "dealer_id": "DLRID_007",
      "dealer_sap_code": "DL001",
      "dealer_name": "Star Traders",
      "dealer_type": "DEALER",
      "purpose_of_visit": "Routine Visit",
      "sequence": 1
    }
  ]
}
```

---

### `POST /api/plans/details`

Add a manual visit to a DRAFT plan.

**Request Body:**
```json
{
  "planId": 42,
  "visitDate": "2026-09-10",
  "dealerId": "DLRID_007",
  "dealerSapCode": "DL001",
  "dealerName": "Star Traders",
  "dealerType": "DEALER",
  "purposeOfVisit": "Collection Visit"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `planId` | number | Yes | Plan ID (must be DRAFT) |
| `visitDate` | string | Yes | `YYYY-MM-DD` |
| `dealerId` | string | No | Internal dealer ID |
| `dealerSapCode` | string | No | SAP code |
| `dealerName` | string | Yes | Dealer name |
| `dealerType` | string | No | `DEALER` / `PROSPECTIVE` (default: `DEALER`) |
| `purposeOfVisit` | string | No | Default: `Routine Visit` |

> **Business Rules:** Max **8 visits/day**. Same dealer **cannot repeat** in a day.

**Success `200`:**
```json
{
  "success": true,
  "message": "Visit added successfully.",
  "detailId": 201
}
```

**Error Examples:**
```json
{ "error": "Daily limit reached: Maximum 8 visits allowed per day." }
{ "error": "Customer already scheduled on this day." }
{ "error": "Only DRAFT plans can be edited." }
```

---

### `DELETE /api/plans/details/:detailId`

Remove a visit from a DRAFT plan.

**Path Params:** `detailId` (number)

**Success `200`:**
```json
{ "success": true, "message": "Visit removed successfully." }
```

---

### `PUT /api/plans/details/move`

Move a visit to a different date.

**Request Body:**
```json
{
  "detailId": 201,
  "newDate": "2026-09-15"
}
```

**Success `200`:**
```json
{ "success": true, "message": "Visit moved successfully." }
```

---

### `POST /api/plans/submit`

Submit a DRAFT plan for manager approval.

**Request Body:**
```json
{ "planId": 42 }
```

**Success `200`:**
```json
{ "success": true, "message": "Plan 42 submitted for approval." }
```

---

### `POST /api/plans/approve`

Approve or reject a SUBMITTED plan.

**Request Body:**
```json
{
  "planId": 42,
  "managerEmpCode": "ASM001",
  "action": "APPROVED",
  "remarks": "Approved for September."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `planId` | number | Yes | |
| `managerEmpCode` | string | Yes | Approving manager's code |
| `action` | string | Yes | `APPROVED` or `REJECTED` |
| `remarks` | string | No | Optional comments |

**Success `200`:**
```json
{ "success": true, "message": "Plan 42 approved." }
```

---

### `DELETE /api/plans/:planId`

Delete a single plan and all its visits.

**Success `200`:**
```json
{ "success": true, "message": "Plan deleted successfully." }
```

---

### `POST /api/plans/bulk-delete`

Delete multiple plans at once.

**Request Body:**
```json
{ "planIds": [42, 43, 44] }
```

**Success `200`:**
```json
{ "success": true, "message": "Successfully deleted 3 plans." }
```

---

### `GET /api/plans/dealers`

Get all dealers assigned to a specific employee.

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `empCode` | string | Yes | Employee code |
| `role` | string | No | `SO` / `ASM` / `RSM` / `ZH` (default: `SO`) |

**Success `200`:**
```json
{
  "dealers": [
    {
      "dealer_id": "DLRID_007",
      "sap_code": "DL001",
      "dealer_name": "Star Traders"
    }
  ]
}
```

---

### `POST /api/plans/mapping/run`

Trigger dealer-to-employee auto-mapping engine.

**Request Body:** `{}` (empty)

**Success `200`:**
```json
{
  "success": true,
  "mappedCount": 342,
  "message": "Dealer mapping completed."
}
```

---

## 4. Employees

### `GET /api/employees`

Get all employees across all roles (merged from master table + visit targets).

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `role` | string | `SO` / `ASM` / `RSM` / `ZH` / `ALL` |

**Success `200`:**
```json
{
  "employees": [
    {
      "emp_code": "SO001",
      "emp_name": "Rahul Sharma",
      "role": "SO",
      "area": "Patna North",
      "region": "Bihar"
    },
    {
      "emp_code": "ASM001",
      "emp_name": "Anjali Singh",
      "role": "ASM",
      "area": "Patna",
      "region": "Bihar"
    }
  ]
}
```

---

## 5. Admin — Dashboard & Filters

### `GET /api/admin/stats`

Get aggregate dashboard header statistics.

**No parameters.**

**Success `200`:**
```json
{
  "stats": {
    "totalDealers": 1250,
    "totalAreas": 48,
    "soVisits": 3.5,
    "asmVisits": 1.2,
    "rsmVisits": 0.5,
    "zhVisits": 0.2
  }
}
```

| Field | Description |
|---|---|
| `totalDealers` | Active dealers in system |
| `totalAreas` | Distinct geographic areas |
| `soVisits` | Avg SO visits/dealer/month |
| `asmVisits` | Avg ASM visits/dealer/month |
| `rsmVisits` | Avg RSM visits/dealer/month |
| `zhVisits` | Avg ZH visits/dealer/month |

---

### `GET /api/admin/filters`

Get dropdown options for zone, area, SO, dealer status.

**Success `200`:**
```json
{
  "zones": ["North Zone", "East Zone", "South Zone"],
  "areas": ["Patna", "Gaya", "Muzaffarpur"],
  "salesOfficers": ["Rahul Sharma", "Anjali Singh"],
  "dealerStatuses": ["Active", "Churn", "Prospect"]
}
```

---

### `GET /api/admin/mapping`

Get dealer-to-SO territory mapping with filters and pagination.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `search` | string | Dealer name, SAP code, SO name |
| `area` | string | Area filter |
| `region` | string | Region filter |
| `soName` | string | SO name filter |
| `custType` | string | `DEALER` / `NON-STAR` / `PROSPECTIVE` |
| `limit` | number | Page size (default: `50`) |
| `offset` | number | Offset (default: `0`) |

**Success `200`:**
```json
{
  "total": 1250,
  "mappings": [
    {
      "id": 1,
      "dealer_id": "DLRID_007",
      "dealer_name": "Star Traders",
      "sap_code": "DL001",
      "sfa_code": "SFA001",
      "so_name": "Rahul Sharma",
      "so_emp_code": "SO001",
      "area": "Patna North",
      "region": "Bihar",
      "dealer_type": "DEALER"
    }
  ]
}
```

---

### `GET /api/admin/readiness`

Check if all 5 required Excel input files are uploaded and ready.

**Success `200`:**
```json
{
  "allAvailable": false,
  "available": ["DEALER_MAPPING", "SALES_HISTORY", "SBG"],
  "missing": ["DEALER_PERFORMANCE", "PROSPECT_DEALERS"],
  "details": {
    "DEALER_MAPPING":    { "available": true,  "batchCode": "BAT-202609-001" },
    "SALES_HISTORY":     { "available": true,  "batchCode": "BAT-202609-002" },
    "SBG":               { "available": true,  "batchCode": "BAT-202609-003" },
    "DEALER_PERFORMANCE":{ "available": false, "batchCode": null },
    "PROSPECT_DEALERS":  { "available": false, "batchCode": null }
  }
}
```

---

### `DELETE /api/admin/purge`

> **Destructive.** Wipes all master data from all tables.

**No body required.**

**Success `200`:**
```json
{ "message": "Old data purged successfully from all master tables." }
```

---

## 6. Admin — Business Rules

### `GET /api/admin/rules`

Get all configurable business rules.

**Success `200`:**
```json
{
  "rules": [
    {
      "id": 1,
      "rule_key": "SO_MONTHLY_WORKING_DAYS",
      "rule_name": "SO Monthly Working Days",
      "rule_value": "26",
      "data_type": "INTEGER",
      "description": "Working days per month for SO",
      "updated_at": "2026-09-01T08:00:00.000Z"
    },
    {
      "id": 2,
      "rule_key": "SO_DAILY_VISIT_CAPACITY",
      "rule_name": "SO Daily Visit Capacity",
      "rule_value": "8",
      "data_type": "INTEGER",
      "description": "Max dealer visits an SO can do in one day",
      "updated_at": "2026-09-01T08:00:00.000Z"
    }
  ]
}
```

---

### `PUT /api/admin/rules`

Update a single business rule by key.

**Request Body:**
```json
{
  "rule_key": "SO_DAILY_VISIT_CAPACITY",
  "rule_value": "10"
}
```

**Success `200`:**
```json
{
  "message": "Rule updated successfully",
  "rule": {
    "id": 2,
    "rule_key": "SO_DAILY_VISIT_CAPACITY",
    "rule_value": "10",
    "updated_at": "2026-09-05T11:00:00.000Z"
  }
}
```

---

### `PUT /api/admin/rules/batch`

Update multiple business rules in one call.

**Request Body:**
```json
{
  "rules": [
    { "rule_key": "SO_MONTHLY_WORKING_DAYS", "rule_value": "25" },
    {
      "rule_key": "SO_DAILY_VISIT_CAPACITY",
      "rule_value": "8",
      "rule_name": "Daily Visit Capacity",
      "data_type": "INTEGER",
      "description": "Max visits per day"
    }
  ]
}
```

**Success `200`:**
```json
{
  "message": "Rules batch updated successfully",
  "rules": [
    { "id": 1, "rule_key": "SO_MONTHLY_WORKING_DAYS", "rule_value": "25" },
    { "id": 2, "rule_key": "SO_DAILY_VISIT_CAPACITY",  "rule_value": "8" }
  ]
}
```

---

## 7. Master Data

### `GET /api/master/summary`

Get record counts for all master data tables.

**Success `200`:**
```json
{
  "summary": {
    "totalDealers": 1250,
    "totalProspects": 87,
    "totalEmployees": 42,
    "totalSalesRecords": 15340,
    "totalVisitLogs": 4200,
    "totalMappings": 1250,
    "totalTargets": 1320,
    "totalBatches": 12
  }
}
```

---

### `GET /api/master/filters`

Get all distinct dropdown values from every master table.

**Success `200`:**
```json
{
  "dealerZones": ["North Zone", "East Zone"],
  "dealerRegions": ["Bihar", "Jharkhand"],
  "dealerAreas": ["Patna", "Gaya"],
  "dealerTypes": ["DEALER", "PROSPECTIVE", "NON_STAR"],
  "dealerStatuses": ["ACTIVE", "INACTIVE"],
  "salesPeriods": ["2026-08", "2026-07", "2026-06"],
  "salesZones": ["North Zone"],
  "logBranches": ["Patna Branch"],
  "logRoutes": ["Route A", "Route B"],
  "logEmployees": ["Rahul Sharma"],
  "logStatuses": ["VISITED", "MISSED"],
  "logVisitDates": ["2026-08-30", "2026-08-29"],
  "logCustomerTypes": ["DEALER", "PROSPECT"],
  "mappingAreas": ["Patna North"],
  "mappingRegions": ["Bihar"],
  "mappingSos": ["Rahul Sharma"],
  "pjpZones": ["North Zone"],
  "pjpAreas": ["Patna"],
  "pjpSos": ["Rahul Sharma"],
  "pjpCategories": ["A", "B", "C"],
  "pjpStatuses": ["Active", "Churn"]
}
```

---

### `GET /api/master/dealers`

Get master dealer list with filters and pagination.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `search` | string | Name, SAP code, SFA code, RSSD code, taluka |
| `dealerType` | string | `DEALER` / `PROSPECTIVE` / `NON_STAR` |
| `status` | string | `ACTIVE` / `INACTIVE` |
| `zone` | string | Zone filter |
| `region` | string | Region filter |
| `area` | string | Area filter |
| `counterStrategy` | string | `PROSPECT` or other strategy |
| `limit` | number | Default: `50` |
| `offset` | number | Default: `0` |

**Success `200`:**
```json
{
  "total": 1250,
  "dealers": [
    {
      "id": "DLRID_007",
      "dealer_name": "Star Traders",
      "sap_code": "DL001",
      "sfa_code": "SFA001",
      "rssd_code": "RSSD001",
      "dealer_type": "DEALER",
      "status": "ACTIVE",
      "zone": "North Zone",
      "region": "Bihar",
      "area": "Patna North",
      "block": "Danapur",
      "taluka": "Danapur",
      "counter_strategy": "STAR",
      "so_name": "Rahul Sharma"
    }
  ]
}
```

---

### `GET /api/master/employees`

Get master employees with filters and pagination.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `search` | string | Name, code, designation |
| `zone` | string | Zone filter |
| `region` | string | Region filter |
| `limit` | number | Default: `50` |
| `offset` | number | Default: `0` |

**Success `200`:**
```json
{
  "total": 42,
  "employees": [
    {
      "id": 1,
      "emp_code": "SO001",
      "emp_name": "Rahul Sharma",
      "role": "SO",
      "designation": "Sales Officer",
      "zone": "North Zone",
      "region": "Bihar",
      "area": "Patna"
    }
  ]
}
```

---

### `GET /api/master/sales-history`

Get sales history with filters and pagination.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `search` | string | Dealer name, SAP code, RSSD code |
| `period` | string | `YYYY-MM` format |
| `zone` | string | Zone filter |
| `limit` | number | Default: `50` |
| `offset` | number | Default: `0` |

**Success `200`:**
```json
{
  "total": 15340,
  "sales": [
    {
      "id": 1,
      "period_year_month": "2026-08",
      "zone": "North Zone",
      "sub_dealer_name": "Rahul Hardware",
      "linked_dealer_name": "Star Traders",
      "sap_code": "DL001",
      "rssd_code": "RSSD001",
      "linked_dealer_code": "LD001",
      "sales_qty": 500,
      "sales_value": 125000
    }
  ]
}
```

---

### `GET /api/master/visit-logs`

Get SFA visit execution logs with filters and pagination.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `search` | string | Customer name/code, employee, branch, route |
| `visitDate` | string | `YYYY-MM-DD` |
| `employeeName` | string | Employee name |
| `branch` | string | Branch |
| `route` | string | Route |
| `visitStatus` | string | `VISITED` / `MISSED` |
| `customerType` | string | `DEALER` / `PROSPECT` |
| `limit` | number | Default: `50` |
| `offset` | number | Default: `0` |

**Success `200`:**
```json
{
  "total": 4200,
  "logs": [
    {
      "id": 1,
      "visit_date": "2026-08-30",
      "employee_name": "Rahul Sharma",
      "employee_code": "SO001",
      "customer_name": "Star Traders",
      "customer_code": "DL001",
      "customer_type": "DEALER",
      "branch": "Patna Branch",
      "route": "Route A",
      "visit_status": "VISITED"
    }
  ]
}
```

---

## 8. Uploads & Batches

### `POST /api/uploads/file`

Upload an Excel/CSV file. Uses `multipart/form-data`.

**Form Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | File | Yes | `.xlsx` / `.xls` / `.csv` (max 50 MB) |
| `uploadType` | string | No | Auto-detected if omitted. See table below. |
| `periodMonth` | string | No | `YYYY-MM` — required only for `PJP_TRADE` |
| `cycleCode` | string | No | `C1` / `C2` — for `PJP_TRADE` (default: `C1`) |

**Upload Type Values:**

| Excel File | `uploadType` |
|---|---|
| SBG Market Mapping | `SBG` |
| Dealer Mapping / Hierarchy | `DEALER_MAPPING` |
| RSAR / Sales History | `SALES_HISTORY` |
| Dealer Performance | `DEALER_PERFORMANCE` |
| Prospect Dealers | `PROSPECT_DEALERS` |
| SFA Visit Report | `SFA_REPORT` |
| PJP Trade File | `PJP_TRADE` |

**Success `200`:**
```json
{
  "message": "File ingested successfully.",
  "batchCode": "BAT-202609-847",
  "fileName": "dealer_mapping_sep2026.xlsx",
  "uploadType": "DEALER_MAPPING",
  "batchStatus": "VALIDATED",
  "rowsProcessed": 1250,
  "counts": {
    "totalRows": 1252,
    "validRows": 1250,
    "invalidRows": 2,
    "duplicateRows": 0,
    "warnings": ["Row 45: Missing zone, defaulted to Unknown"],
    "errors": [
      { "row": 3, "errors": ["SAP code missing"] }
    ]
  },
  "warnings": [],
  "errors": []
}
```

**Batch Status Values:**

| Status | Meaning |
|---|---|
| `VALIDATED` | All rows valid |
| `PARTIAL` | Some valid, some invalid |
| `FAILED` | Zero valid rows |
| `PROCESSING` | In progress |

**Error `422`:**
```json
{
  "error": "File processing failed — 0 valid rows. Check the file format.",
  "batchCode": "BAT-202609-847",
  "batchStatus": "FAILED",
  "errors": []
}
```

**React Native Upload Example:**
```javascript
const uploadExcel = async (fileUri, fileName, uploadType) => {
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  formData.append('uploadType', uploadType);

  const res = await fetch(`${BASE_URL}/api/uploads/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data' },
    body: formData,
  });
  return res.json();
};
```

---

### `POST /api/uploads/process`

Process a file already saved on server by path (legacy / server-side use).

**Request Body:**
```json
{
  "uploadType": "DEALER_MAPPING",
  "filePath": "/absolute/path/to/dealer_mapping.xlsx",
  "periodMonth": "2026-09",
  "cycleCode": "C1"
}
```

**Success `200`:**
```json
{
  "message": "Upload processed",
  "batchCode": "BAT-1725500000000",
  "batchStatus": "VALIDATED",
  "counts": {
    "totalRows": 1250,
    "validRows": 1250,
    "invalidRows": 0,
    "duplicateRows": 0
  }
}
```

---

### `GET /api/admin/batches`

Get all upload batch logs (last 100).

**Success `200`:**
```json
{
  "batches": [
    {
      "id": 1,
      "batch_code": "BAT-202609-847",
      "file_type": "DEALER_MAPPING",
      "file_name": "dealer_mapping.xlsx",
      "file_path": "/upload-files/file-1234567890.xlsx",
      "period_month": null,
      "status": "VALIDATED",
      "total_rows": 1250,
      "valid_rows": 1250,
      "invalid_rows": 0,
      "duplicate_rows": 0,
      "error_summary": null,
      "warning_summary": null,
      "uploaded_at": "2026-09-05T09:30:00.000Z"
    }
  ]
}
```

---

### `DELETE /api/admin/batches/:batchCode`

Delete a batch and all its associated data.

**Path Param:** `batchCode` (string, e.g. `BAT-202609-847`)

**Success `200`:**
```json
{
  "success": true,
  "message": "Batch BAT-202609-847 data purged and removed from logs."
}
```

---

## 9. DJP Engine

### `POST /api/djp/generate-all`

**Legacy single-shot generation.** Auto-selects latest validated batches and runs full PJP + DJP for all roles.

> Call `GET /api/admin/readiness` first to confirm all 5 files are uploaded.

**Request Body:**
```json
{
  "planMonth": "2026-09",
  "cycleCode": "C1"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `planMonth` | string | Yes | `YYYY-MM` |
| `cycleCode` | string | No | `C1` / `C2` (default: `C1`) |

**Success `200`:**
```json
{
  "message": "Multi-Role PJP & DJP Solution Generated",
  "generationCode": "GEN-202609-C1-1725523456789",
  "periodMonth": "2026-09",
  "cycleCode": "C1",
  "dealerMappingBatchUsed": "BAT-202609-001",
  "salesBatchesUsed": ["BAT-202609-002", "BAT-202609-003"],
  "totalDealerTargets": 1250,
  "totalVisitsRequired": 4375,
  "totalDjpSlots": 4200,
  "unallocatedCount": 175,
  "capacityViolated": false
}
```

---

### `GET /api/djp/dealer-targets`

Get computed dealer visit targets (PJP output table).

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `periodMonth` | string | `YYYY-MM`. Defaults to latest. |
| `cycleCode` | string | `C1` / `C2` |
| `soEmpCode` | string | SO employee code filter |
| `soName` | string | SO name filter |
| `category` | string | `A` / `B` / `C` |
| `dealerStatus` | string | `Active` / `Churn` / `Prospect` |
| `custType` | string | `DEALER` / `NON-STAR` / `PROSPECTIVE` |
| `zone` | string | Zone filter |
| `area` | string | Area filter |
| `search` | string | Dealer name, SAP code, area, SO |
| `limit` | number | Default: `50` |
| `offset` | number | Default: `0` |

**Success `200`:**
```json
{
  "total": 1250,
  "targets": [
    {
      "id": 1,
      "dealer_id": "DLRID_007",
      "dealer_name": "Star Traders",
      "sap_code": "DL001",
      "sfa_code": "SFA001",
      "zone": "North Zone",
      "area": "Patna North",
      "so_name": "Rahul Sharma",
      "so_emp_code": "SO001",
      "asm_name": "Anjali Singh",
      "rsm_name": "Priya Verma",
      "zh_name": "Suresh Mehta",
      "category": "A",
      "dealer_status": "Active",
      "dealer_type": "DEALER",
      "so_visits": 3.5,
      "asm_visits": 1.2,
      "rsm_visits": 0.5,
      "zh_visits": 0.2,
      "total_visits": 5.4,
      "so_visits_pct": 64.81,
      "asm_visits_pct": 22.22,
      "rsm_visits_pct": 9.26,
      "zh_visits_pct": 3.70,
      "priority": 1,
      "period_month": "2026-09",
      "cycle_code": "C1"
    }
  ]
}
```

---

### `GET /api/djp/plan`

Get raw DJP day-wise recommendations (from `djp_recommendations` table).

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `roleType` | string | `SO` / `ASM` / `RSM` / `ZH` |
| `empCode` | string | Employee code |
| `soEmpCode` | string | Alias for empCode |
| `periodMonth` | string | `YYYY-MM` |
| `cycleCode` | string | `C1` / `C2` |

**Success `200`:**
```json
{
  "total": 165,
  "plan": [
    {
      "id": 1,
      "emp_code": "SO001",
      "role_type": "SO",
      "dealer_name": "Star Traders",
      "dealer_sap_code": "DL001",
      "visit_date": "2026-09-03",
      "visit_sequence": 1,
      "period_month": "2026-09",
      "cycle_code": "C1"
    }
  ]
}
```

---

### `GET /api/djp/reconciliation`

Get multi-source reconciliation diagnostics.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `periodMonth` | string | `YYYY-MM` (default: `2026-06`) |
| `cycleCode` | string | `C1` / `C2` (default: `C1`) |

**Success `200`:**
```json
{
  "reportMonth": "2026-09",
  "cycleCode": "C1",
  "dealerUniverse": 1250,
  "targetedDealers": 1245,
  "untargetedDealers": 5,
  "totalVisitRequirements": 4375,
  "allocatedSlots": 4200,
  "unallocatedSlots": 175,
  "reconciliationRate": 96.0,
  "discrepancies": []
}
```

---

## 10. Generation Runs (Batch-Isolated)

> Use this set of APIs for **reproducible, auditable** generation runs where you explicitly declare which uploaded batch each run should use.

### `POST /api/generation/create`

Create a new generation run record (does not execute yet).

**Request Body:**
```json
{
  "planMonth": "2026-09",
  "cycleCode": "C1",
  "dealerMappingBatchCode": "BAT-202609-001",
  "salesHistoryBatchCodes": ["BAT-202609-002", "BAT-202608-003"],
  "prospectBatchCode": "BAT-202609-004",
  "sfaFeedbackBatchCode": "BAT-202609-005"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `planMonth` | string | Yes | `YYYY-MM` |
| `cycleCode` | string | Yes | `C1` / `C2` |
| `dealerMappingBatchCode` | string | Yes | From `DEALER_MAPPING` upload |
| `salesHistoryBatchCodes` | string[] | No | Array of `SALES_HISTORY` batch codes |
| `prospectBatchCode` | string | No | `PROSPECT_DEALERS` batch code |
| `sfaFeedbackBatchCode` | string | No | `SFA_REPORT` batch code |

**Success `200`:**
```json
{
  "message": "Generation run created. Call POST /api/generation/run/:code to execute.",
  "generationCode": "GEN-202609-C1-1725523456789",
  "reportMonth": "2026-09",
  "cycleCode": "C1",
  "dealerMappingBatchCode": "BAT-202609-001",
  "salesHistoryBatchCodes": ["BAT-202609-002"],
  "prospectBatchCode": "BAT-202609-004"
}
```

---

### `POST /api/generation/run/:code`

Execute a PENDING generation run.

**Path Param:** `code` (generation code from create step)

**No request body required.**

**Success `200`:**
```json
{
  "message": "Generation completed successfully.",
  "generationCode": "GEN-202609-C1-1725523456789",
  "reportMonth": "2026-09",
  "cycleCode": "C1",
  "totalDealerTargets": 1250,
  "totalVisitsRequired": 4375,
  "totalDjpSlots": 4200,
  "unallocatedCount": 0,
  "capacityViolated": false
}
```

**Errors:**
```json
{ "error": "Generation run 'GEN-...' is already running" }
{ "error": "Generation run 'GEN-...' already completed." }
```

---

### `GET /api/generation`

List all generation runs (last 50).

**Success `200`:**
```json
{
  "runs": [
    {
      "id": 1,
      "generation_code": "GEN-202609-C1-1725523456789",
      "report_month": "2026-09",
      "cycle_code": "C1",
      "dealer_mapping_batch_code": "BAT-202609-001",
      "sales_history_batch_codes": "[\"BAT-202609-002\"]",
      "status": "COMPLETED",
      "pjp_dealer_count": 1250,
      "pjp_visit_requirement": 4375,
      "djp_scheduled_count": 4200,
      "djp_unallocated_count": 0,
      "capacity_violated": 0,
      "started_at": "2026-09-05T10:00:00.000Z",
      "completed_at": "2026-09-05T10:05:32.000Z"
    }
  ]
}
```

**Status Values:**

| Status | Meaning |
|---|---|
| `PENDING` | Created, not yet run |
| `RUNNING` | Executing |
| `COMPLETED` | Fully successful |
| `PARTIAL` | Done, some visits unallocated |
| `FAILED` | Error during execution |

---

### `GET /api/generation/:code`

Get a specific generation run by code.

**Success `200`:**
```json
{
  "run": {
    "generation_code": "GEN-202609-C1-1725523456789",
    "report_month": "2026-09",
    "cycle_code": "C1",
    "status": "COMPLETED",
    "pjp_dealer_count": 1250,
    "rules_snapshot": "{\"SO_MONTHLY_WORKING_DAYS\":\"26\"}",
    "validation_errors": null
  }
}
```

---

## 11. PJP Canonical Engine

### `POST /api/pjp/calculate`

Run the canonical PJP scoring and visit allocation algorithm only (no DJP).

**Request Body:**
```json
{
  "planMonth": "2026-09",
  "cycleCode": "C1"
}
```

**Success `200`:**
```json
{
  "message": "PJP Calculation Complete",
  "periodMonth": "2026-09",
  "cycleCode": "C1",
  "stats": {
    "totalDealers": 1250,
    "categorizedDealers": 1250,
    "totalVisits": 4375,
    "processingTimeMs": 1240
  },
  "validation": {
    "valid": true,
    "totalErrors": 0,
    "totalDuplicates": 0,
    "errors": []
  }
}
```

---

### `GET /api/pjp/debug/:dealerCode`

Get full PJP calculation trace for a specific dealer (for debugging).

**Path Param:** `dealerCode` (SAP or SFA code)

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `periodMonth` | string | Yes | `YYYY-MM` |
| `cycleCode` | string | No | `C1` / `C2` |

**Success `200`:**
```json
{
  "dealer": {
    "dealerCode": "DL001",
    "dealerName": "Star Traders",
    "category": "A",
    "soVisits": 3.5,
    "asmVisits": 1.2,
    "priority": 1,
    "score": 87.5
  },
  "trace": {
    "steps": [
      "Dealer classified as category A based on counter potential rank 1",
      "SO visits assigned: 3.5 (from A-category percentile rule)",
      "Priority score: 87.5 (A=40pts + Category=40pts + Share=7.5pts)"
    ]
  }
}
```

**Error `404`:**
```json
{ "error": "Dealer DL001 not found in PJP results" }
```

---

### `GET /api/pjp/reconciliation`

Same as `GET /api/djp/reconciliation`. Accepts `periodMonth` and `cycleCode` query params.

---

## 12. Export APIs — File Downloads

These endpoints return **binary Excel files**. In React Native, use `expo-file-system` or `react-native-fs` to download.

### `GET /api/djp/export-pjp-trade`

Download PJP_TRADE report — 16-column standard format.

**Query Parameters:** `periodMonth` (YYYY-MM), `cycleCode` (C1/C2)

**Response:** Binary `.xlsx`
**Filename:** `PJP_TRADE_2026-09_C1.xlsx`

---

### `GET /api/djp/export-master`  &  `GET /api/pjp/export-master`

Download Master Report — 42-column format, sheet name: `Master`.

**Query Parameters:** `periodMonth`, `cycleCode`
**Filename:** `M_2026-09_C1.xlsx`

---

### `GET /api/djp/export-visits`  &  `GET /api/pjp/export-visits`

Download Visits-to-be-Achieved report — 20-column format, sheet: `Visits`. Excludes Churn dealers.

**Query Parameters:** `periodMonth`, `cycleCode`
**Filename:** `visits-To_Be_Achieved_2026-09_C1.xlsx`

**React Native Download Example:**
```javascript
import * as FileSystem from 'expo-file-system';

const downloadReport = async (type, periodMonth, cycleCode) => {
  const url = `${BASE_URL}/api/djp/export-${type}?periodMonth=${periodMonth}&cycleCode=${cycleCode}`;
  const dest = FileSystem.documentDirectory + `${type}_${periodMonth}.xlsx`;
  const { uri } = await FileSystem.downloadAsync(url, dest);
  return uri; // local file path
};
// Usage: downloadReport('pjp-trade', '2026-09', 'C1')
```

---

## 13. Healthcheck

### `GET /health`

> Root-level endpoint — not under `/api`

**Success `200`:**
```json
{
  "status": "UP",
  "message": "Star Cement PJP / DJP Engine API Platform running."
}
```

---

## 14. Error Reference

All error responses:
```json
{ "error": "Human-readable error message" }
```

| HTTP Status | Meaning |
|---|---|
| `400` | Bad request — missing or invalid params |
| `401` | Authentication failure |
| `403` | Forbidden — permission or hierarchy barrier |
| `404` | Resource not found |
| `409` | Conflict — duplicate visit, capacity exceeded, or state lock |
| `422` | Unprocessable — file validation failed |
| `500` | Internal server error |

---

## 15. React Native Setup & Tips

### 15.1 Field App Client (Sessionless `:empCode`)

For the Field App (`/api/app/...`), no token is needed. You can use a lightweight helper:

```javascript
// api/fieldAppClient.js
const BASE_URL = 'http://192.168.x.x:3000'; // Replace with server LAN IP

export const fieldAppApi = async (endpoint, method = 'GET', body = null) => {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}/api/app${endpoint}`, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

// Examples:
// const summary = await fieldAppApi('/officers/2500070/summary?month=2026-07');
// const plans   = await fieldAppApi('/officers/2500070/plans?cycle=C1');
// const detail  = await fieldAppApi('/officers/2500070/plans/4');
```

### 15.2 Admin Web & Master Data Client (Bearer Token)

```javascript
// api/adminClient.js
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = 'http://192.168.x.x:3000';

export const adminApi = async (endpoint, options = {}) => {
  const token = await AsyncStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(`${BASE_URL}/api${endpoint}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};
```

---

### 15.3 End-to-End Field App Workflows

#### A. Field Officer Workflow (Daily Mobile Operations)

```
Step 1: GET  /api/app/officers/:empCode/summary
        Display dashboard KPI counters (pending plans, approval alerts).

Step 2: GET  /api/app/officers/:empCode/plans?month=YYYY-MM&cycle=C1
        Show officer's plans with status badges (DRAFT, SUBMITTED, APPROVED, RECTIFY).

Step 3: GET  /api/app/officers/:empCode/plans/:planId
        Open the active plan. Renders day-by-day diary, dealer cards (name, area, zone,
        category, grade), category mix breakdown, and permissible action buttons.

Step 4: GET  /api/app/officers/:empCode/dealers?month=YYYY-MM&cycle=C1
        (If plan is DRAFT or RECTIFY) Open dealer picker showing available pool & quota.

Step 5: POST /api/app/officers/:empCode/plans/:planId/visits
        Add a dealer to a specific visit date.

Step 6: PUT  /api/app/officers/:empCode/plans/:planId/visits/:detailId
        Drag-and-drop or reschedule visit to another day.

Step 7: POST /api/app/officers/:empCode/plans/:planId/submit
        Submit finalized schedule to L1 manager.

Step 8: POST /api/app/officers/:empCode/visits/punch
        (When plan is APPROVED) Officer visits dealer on the road: check-in, execution
        status (Productive / Non-Productive), and check-out.

Step 9: GET  /api/app/officers/:empCode/adherence?month=YYYY-MM&cycle=C1
        Check personal adherence percentage and list of remaining counters.
```

#### B. Approver / Manager Workflow

```
Step 1: GET  /api/app/approvers/:empCode/inbox?month=YYYY-MM
        List pending plans from subordinates (SOs, ASMs, RSMs).

Step 2: GET  /api/app/approvers/:empCode/plans/:planId
        Review the officer's scheduled route, dealer category mix, and visit frequency.

Step 3: POST /api/app/approvers/:empCode/plans/:planId/decision
        Submit decision:
        • APPROVE: Locks plan; officer can now punch visits.
        • RECTIFY: Sends plan back with mandatory remarks. (Note: Allowed once only).

Step 4: GET  /api/app/approvers/:empCode/team-adherence?month=YYYY-MM&cycle=C1
        Monitor overall team adherence rates and target completion percentages.
```

