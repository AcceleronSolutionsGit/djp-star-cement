# Star Cement Non-Trade DJP — Mobile Field App API Documentation

**Version:** 1.0.0  
**Target Clients:** Mobile Field App (Android / iOS / Flutter / React Native), SFA App, Web Simulator  
**Base URL:** `http://<server-ip>:3001/api` (e.g. `http://52.66.31.108/api` or `http://52.66.31.108/star_one_djp/api`)  
**Default Content-Type:** `application/json`

---

## 1. Overview & Mobile Flow Architecture

The Non-Trade Journey Planning (DJP) platform distributes monthly counter journey plans to Field Officers and tracks visit adherence in real time.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          FIELD OFFICER APP WORKFLOW                    │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Launch App & Query Month Plans:                                     │
│    GET /api/app/officers/{empCode}/plans?month=YYYY-MM                 │
│                                                                        │
│ 2. Fetch Today's Scheduled Counter Visits (Day-by-Day Calendar):       │
│    GET /api/app/officers/{empCode}/plans/{planId}                      │
│                                                                        │
│ 3. Punch Check-In & Check-Out at Counter:                              │
│    POST /api/app/officers/{empCode}/visits/punch                       │
│    -> Immediately records execution & recalculates real-time adherence │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Authentication & Headers

Standard requests should include:
```http
Content-Type: application/json
Accept: application/json
```
If using bearer token authentication (configured in environment):
```http
Authorization: Bearer <TOKEN>
```
*(Employee identification is passed via route parameters like `:empCode`, matching standard SFA patterns).*

---

## 3. Field Officer Endpoints

### 3.1 List Officer Plans for a Month

Returns the summary of journey plans assigned to the officer for the specified month.

- **Method:** `GET`
- **Endpoint:** `/api/app/officers/:empCode/plans`
- **Query Parameters:**
  - `month` *(string, optional)*: Month format `YYYY-MM` (e.g. `2026-10`). Defaults to current month.

#### Request Example:
```http
GET /api/app/officers/2500288/plans?month=2026-10 HTTP/1.1
Host: 52.66.31.108
```

#### Response Example (`200 OK`):
```json
{
  "emp_code": "2500288",
  "emp_name": "DEBAJIT MITRA",
  "month": "2026-10",
  "plans": [
    {
      "plan_id": "NT-2500288-2026-10",
      "period_month": "2026-10",
      "cycle_code": "MONTHLY",
      "channel": "NON_TRADE",
      "status": "APPROVED",
      "counts": {
        "dealers": 43,
        "visits": 93
      },
      "employee": {
        "emp_code": "2500288",
        "name": "DEBAJIT MITRA",
        "role": "Officer"
      },
      "approver": {
        "emp_code": "1100160",
        "name": "DEBASHISH DEY",
        "role": "ASM"
      }
    }
  ]
}
```

---

### 3.2 Get Day-by-Day Plan Detail & Daily Counters

Retrieves the officer's full monthly schedule grouped day-by-day. Use this to render the daily visit cards, beat schedule, and completion tick-marks on mobile.

- **Method:** `GET`
- **Endpoint:** `/api/app/officers/:empCode/plans/:planId`
  - `:planId`: Plan identifier (e.g. `NT-2500288-2026-10`)

#### Request Example:
```http
GET /api/app/officers/2500288/plans/NT-2500288-2026-10 HTTP/1.1
Host: 52.66.31.108
```

#### Response Example (`200 OK`):
```json
{
  "plan": {
    "plan_id": "NT-2500288-2026-10",
    "period_month": "2026-10",
    "channel": "NON_TRADE",
    "status": "APPROVED",
    "employee": {
      "emp_code": "2500288",
      "emp_name": "DEBAJIT MITRA",
      "role": "Officer"
    },
    "approver": {
      "emp_code": "1100160",
      "name": "DEBASHISH DEY",
      "role": "ASM"
    },
    "counts": {
      "dealers": 43,
      "visits": 93,
      "working_days": 23
    },
    "category_mix": {
      "Zero-lifter": 28,
      "Penetrate": 42,
      "Retain": 23
    },
    "days": [
      {
        "visit_date": "2026-10-01",
        "visit_count": 4,
        "visits": [
          {
            "detail_id": 14000563221,
            "sequence": 1,
            "dealer": {
              "dealer_id": 1284,
              "sap_code": "1100001902",
              "sfa_code": "1400056322",
              "name": "ECO PROTECTION ENGINEERS PRIVATE LI",
              "type": "Zero-lifter",
              "area": "AGARTALA",
              "zone": "NT",
              "route_name": "AGARTALA"
            },
            "final_category": "Zero-lifter",
            "priority_score": 1,
            "purpose_of_visit": "Non-Trade Visit (Zero-lifter)",
            "visit_status": "ACTIVE",
            "executed": true,
            "execution": {
              "check_in_time": "11:21:31",
              "check_out_time": "11:35:34",
              "duration": "14m 3s",
              "visit_status": "Productive",
              "remarks": null
            },
            "source": "NON_TRADE"
          },
          {
            "detail_id": 14000003941,
            "sequence": 2,
            "dealer": {
              "dealer_id": 1285,
              "sap_code": "1100000394",
              "sfa_code": "1400000394",
              "name": "K.B.INDUSTRIES",
              "type": "Penetrate",
              "area": "AGARTALA",
              "zone": "NT",
              "route_name": "AGARTALA"
            },
            "final_category": "Penetrate",
            "priority_score": 2,
            "purpose_of_visit": "Non-Trade Visit (Penetrate)",
            "visit_status": "ACTIVE",
            "executed": false,
            "execution": null,
            "source": "NON_TRADE"
          }
        ]
      }
    ]
  }
}
```

---

### 3.3 Record Visit Punch (Check-In / Check-Out)

Punches a live visit execution. Automatically maps against the officer's Non-Trade counter plan, logs check-in/out duration, and recalculates adherence instantly (0-second latency).

- **Method:** `POST`
- **Endpoint:** `/api/app/officers/:empCode/visits/punch`

#### Request Payload:
```json
{
  "visitDate": "2026-10-05",
  "dealerCode": "1400056322",
  "checkInTime": "10:15:00",
  "checkOutTime": "10:45:00",
  "visitStatus": "Productive",
  "purposeOfVisit": "Commercial Stock Review & Order Collection",
  "remarks": "Order committed for 400 bags"
}
```

#### Field Specifications:
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `visitDate` | String | **Yes** | Date in format `YYYY-MM-DD` |
| `dealerCode`| String | **Yes** | Ship-To Party Code (`14xxxxxx`) or SAP Code (`11xxxxxx`) |
| `checkInTime`| String | No | Time in format `HH:mm:ss` (defaults to current time) |
| `checkOutTime`| String | No | Time in format `HH:mm:ss` (defaults to check-in + 30m) |
| `visitStatus`| String | No | `'Productive'` or `'Non productive'` (default: `'Productive'`) |
| `purposeOfVisit`| String | No | Description of visit activity |
| `remarks` | String | No | Officer field notes / remarks |

#### Response Example (`201 Created`):
```json
{
  "success": true,
  "message": "Punched ECO PROTECTION ENGINEERS PRIVATE LI on 2026-10-05.",
  "planned": true,
  "channel": "NON_TRADE",
  "cycle_code": "MONTHLY",
  "sfa_row": {
    "Date of Visit": "2026-10-05",
    "Customer Code": "1400056322",
    "Customer Name": "ECO PROTECTION ENGINEERS PRIVATE LI",
    "Type": "Zero-lifter",
    "Route": "AGARTALA",
    "Branch": "AGARTALA",
    "Employee Code": "2500288",
    "Employee Name": "DEBAJIT MITRA",
    "Check In Time": "10:15:00",
    "Check Out Time": "10:45:00",
    "Duration": "30 Minute(s)",
    "Visit Status(Productive / Non productive)": "Productive",
    "Purpose Of Visit": "Commercial Stock Review & Order Collection",
    "Remarks": "Order committed for 400 bags"
  }
}
```

---

## 4. Manager / Approver Endpoints (ASM & HOS)

### 4.1 Team Adherence Overview

Returns live adherence statistics for all subordinate officers reporting to the manager.

- **Method:** `GET`
- **Endpoint:** `/api/app/approvers/:empCode/team-adherence`
- **Query Parameters:**
  - `month` *(string, optional)*: `YYYY-MM` (e.g. `2026-10`)

#### Response Example (`200 OK`):
```json
{
  "approver": {
    "emp_code": "1100160",
    "name": "DEBASHISH DEY",
    "role": "ASM"
  },
  "month": "2026-10",
  "team": [
    {
      "emp_code": "2500288",
      "emp_name": "DEBAJIT MITRA",
      "role": "Officer",
      "channel": "NON_TRADE",
      "planned_visits": 93,
      "prorated_due": 93,
      "adhered": 55,
      "adherence_pct": 59.1,
      "unplanned_visits": 12,
      "total_visits_done": 67,
      "status": "APPROVED"
    },
    {
      "emp_code": "2500232",
      "emp_name": "PREETAM KARMAKAR",
      "role": "Officer",
      "channel": "NON_TRADE",
      "planned_visits": 42,
      "prorated_due": 42,
      "adhered": 8,
      "adherence_pct": 19.0,
      "unplanned_visits": 25,
      "total_visits_done": 33,
      "status": "APPROVED"
    }
  ]
}
```

---

### 4.2 Manager Pending Inbox

Returns journey plans requiring review or sign-off by the manager.

- **Method:** `GET`
- **Endpoint:** `/api/app/approvers/:empCode/inbox`
- **Query Parameters:**
  - `month` *(string, optional)*: `YYYY-MM`

#### Response Example (`200 OK`):
```json
{
  "approver": {
    "emp_code": "1100160",
    "name": "DEBASHISH DEY"
  },
  "plans": [
    {
      "plan_id": "NT-2500288-2026-10",
      "period_month": "2026-10",
      "channel": "NON_TRADE",
      "status": "APPROVED",
      "employee": {
        "emp_code": "2500288",
        "name": "DEBAJIT MITRA"
      },
      "counts": {
        "dealers": 43,
        "visits": 93
      }
    }
  ]
}
```

---

## 5. Web Portal & Backend Sync Endpoints

### 5.1 Real-Time Adherence Engine API
Calculates adherence across all employees, roles (Officer, ASM, HOS), and category buckets (Zero-lifter, Penetrate, Retain).

- **Method:** `GET`
- **Endpoint:** `/api/nontrade/adherence`
- **Query Parameters:**
  - `periodMonth`: `YYYY-MM` (e.g. `2026-10`)
  - `asOnDate`: `YYYY-MM-DD` (Cutoff date for prorated due)

---

### 5.2 Live SFA Sync Trigger
Manually or periodically pulls latest punches from `visit_execution_logs` into Non-Trade adherence.

- **Method:** `POST`
- **Endpoint:** `/api/nontrade/sync-sfa`
- **Payload:**
```json
{
  "periodMonth": "2026-10"
}
```
- **Response:**
```json
{
  "success": true,
  "message": "Successfully synchronized live SFA visits for 2026-10",
  "synced": 310
}
```

---

### 5.3 Plan Rollout to Field App
Releases monthly draft journey plans to the Field App so officers can see their counters.

- **Method:** `PUT`
- **Endpoint:** `/api/nontrade/plans/rollout`
- **Payload:**
```json
{
  "periodMonth": "2026-10"
}
```
- **Response:**
```json
{
  "success": true,
  "message": "Non-Trade plans for 2026-10 rolled out successfully to the Field App.",
  "updatedPlans": 6179
}
```

---

## 6. Common Status Codes & Error Formats

| Status Code | Reason | Description |
| :--- | :--- | :--- |
| `200 OK` | Success | Request succeeded with data payload |
| `201 Created` | Created | Visit punch successfully logged |
| `400 Bad Request` | Validation Error | Missing parameters (e.g. `visitDate`, `dealerCode`) |
| `404 Not Found` | Resource Missing | Plan or officer not found |
| `500 Server Error` | Backend Issue | Database query or internal runtime error |

#### Standard Error Response Format:
```json
{
  "error": "Non-Trade Plan not found for employee 2500288 in period 2026-10."
}
```
