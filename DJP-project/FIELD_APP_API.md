# Star Cement PJP / DJP — Field App API

Everything a mobile or web client needs to implement the officer and approver
experience. Every response below is a **real capture** from the running API against the
AGARTALA demo data, not an invented example.

- **Base URL** — `http://<host>:3000/api` (port from `PORT`, default 3000)
- **Content type** — `application/json` on every request that has a body
- **Version** — no version prefix; breaking changes are announced in the project docs

---

## 1. Authentication and identity

There are **no tokens and no session**. Every route carries the employee's code in the
path, and each handler verifies that the person named in the path actually owns (or
approves) the thing being touched.

```
GET /api/app/officers/11003102/plans      ← 11003102 is the officer
GET /api/app/approvers/11003201/inbox     ← 11003201 is his L1
```

**What this means for your app:** store the employee code at login and put it in the
path. The server will refuse cross-employee access — asking for a plan that belongs to
someone else returns `409` with a message naming both codes — but it will not stop a
client that lies about who it is. Treat the employee code as an identifier, not a
credential, and put a real auth layer in front of this before it leaves a controlled
network.

---

## 2. Conventions

### Dates
| Where | Format | Example |
|---|---|---|
| Month / period | `YYYY-MM` | `2026-06` |
| Any single date | `YYYY-MM-DD` | `2026-06-14` |
| Times (punch) | `HH:MM` or `HH:MM:SS` | `10:05` |
| Timestamps in responses | `YYYY-MM-DD HH:MM:SS` | `2026-09-15 08:51:57` |

A date in any other shape is a `400` naming the expected format. Do not send
`14-06-2026` — DD-MM-YYYY is a **display** format only (it is what the Excel exports
show); the API speaks ISO.

### Cycles
A month has two cycles. `C1` is days 1–15, `C2` is 16 to month end. The exact day
boundaries come from business rules and are returned in `cycle_window` — read them,
don't hard-code 15.

### Dealer codes — the one thing that trips clients up
A counter has two codes and **either may be null**:

- `sap_code` — the SAP customer code (e.g. `1000000058`)
- `sfa_code` — the SFA code the visit log uses (e.g. `NER150`)

**A prospect has no SAP code at all.** Its `sap_code` is `null` and only the `sfa_code`
identifies it. Endpoints that take a dealer code accept **either**, so the safe client
rule is:

```js
const dealerCode = dealer.sap_code || dealer.sfa_code;   // never the other way round
```

### Plan statuses
```
DRAFT ──submit──> SUBMITTED ──approve──> APPROVED   (final)
                      │
                   rectify (once)
                      ↓
                   RECTIFY ──submit──> SUBMITTED ──approve──> APPROVED
```
- Editable only while `DRAFT` or `RECTIFY`
- **One** send-back per plan (`MAX_RECTIFICATIONS = 1`). The second is refused with `409`
- There is no L2. One approver, named on the plan as `approver`

Never derive buttons from the status yourself — every plan carries an `actions` object
that already applies these rules for the caller (see §4.3).

### Error envelope
Every failure is `{ "error": "<sentence>" }`. The message is written to be shown to a
user as-is.

| Code | Meaning | Client should |
|---|---|---|
| `400` | malformed input | fix the request; show the message |
| `403` | not yours to touch | show the message; refresh the plan |
| `404` | no such plan / visit / counter | refresh the list |
| `409` | valid request, business rule says no | **show the message** — daily cap, duplicate, second rectify, wrong status |
| `500` | server fault | retry once, then report |

`409` is the interesting one: it means the request was well-formed and the rules refused
it. Surface the text.

---

## 3. Endpoint map

### Officer
| Method | Path | Purpose |
|---|---|---|
| GET | `/app/officers/:empCode/summary` | home-screen counters |
| GET | `/app/officers/:empCode/plans` | his plans |
| GET | `/app/officers/:empCode/plans/:planId` | one plan, day by day |
| GET | `/app/officers/:empCode/dealers` | counters he may add |
| POST | `/app/officers/:empCode/plans/:planId/visits` | add a visit |
| PUT | `/app/officers/:empCode/plans/:planId/visits/:detailId` | move a visit |
| DELETE | `/app/officers/:empCode/plans/:planId/visits/:detailId` | remove a visit |
| POST | `/app/officers/:empCode/plans/:planId/submit` | send to L1 |
| POST | `/app/officers/:empCode/visits/punch` | record a visit he made |
| GET | `/app/officers/:empCode/adherence` | his adherence + counters |

### Approver (L1)
| Method | Path | Purpose |
|---|---|---|
| GET | `/app/approvers/:empCode/inbox` | plans awaiting him |
| GET | `/app/approvers/:empCode/plans/:planId` | review a plan |
| POST | `/app/approvers/:empCode/plans/:planId/decision` | approve or send back |
| GET | `/app/approvers/:empCode/team-adherence` | one line per officer |
| GET | `/app/approvers/:empCode/adherence/daily` | team, day by day |
| GET | `/app/approvers/:empCode/adherence/counters` | team counter tracker |

### Admin / reporting
| Method | Path | Purpose |
|---|---|---|
| GET | `/app/admin/plan-periods` | months that have plans |
| GET | `/app/admin/plans` | every plan, filterable |
| GET | `/app/admin/plans/:planId` | any plan, no ownership check |
| GET | `/app/admin/adherence` | full adherence report |
| GET | `/app/admin/adherence/daily` | day-by-day running total |
| GET | `/app/admin/adherence/counters` | counter tracker (their sheet) |
| GET | `/app/admin/cycle-handover` | what changes after the 15th |
| POST | `/generation/regenerate-c2` | rebuild C2 from adherence |
| POST | `/app/routing/restamp` | re-resolve L1 approvers |

---

## 4. Officer endpoints

### 4.1 Home counters

```
GET /app/officers/:empCode/summary?month=2026-06
```

| Query | Required | Notes |
|---|---|---|
| `month` | no | `YYYY-MM`. Omit for all months. |

```json
{
  "emp_code": "11003102",
  "role": "SO",
  "month": "2026-06",
  "my_plans": {
    "DRAFT": 1
  },
  "awaiting_my_approval": 0,
  "action_required": 1
}
```

`action_required` = DRAFT + RECTIFY plans. Use it for the badge on the home tile.
`awaiting_my_approval` is non-zero only if this person is also somebody's L1 — the same
code can be both.

---

### 4.2 His plans

```
GET /app/officers/:empCode/plans?month=2026-06&cycle=C1&status=DRAFT
```

| Query | Required | Notes |
|---|---|---|
| `month` | no | `YYYY-MM` |
| `cycle` | no | `C1` / `C2` |
| `status` | no | `DRAFT` / `SUBMITTED` / `RECTIFY` / `APPROVED` |

```json
{
  "emp_code": "11003102",
  "emp_name": "PARTHA SARKAR",
  "role": "SO",
  "count": 1,
  "plans": [
    {
      "plan_id": 1,
      "period_month": "2026-06",
      "cycle_code": "C1",
      "status": "DRAFT",
      "employee": {
        "emp_code": "11003102",
        "emp_name": "PARTHA SARKAR",
        "role": "SO"
      },
      "approver": {
        "emp_code": "11003201",
        "name": "BIKRAM KUMAR HALDER",
        "role": "ASM"
      },
      "counts": {
        "visits": 70,
        "dealers": 34,
        "working_days": 12
      },
      "date_range": {
        "from": "2026-06-01",
        "to": "2026-06-15"
      },
      "rectification": {
        "count": 0,
        "remaining": 1,
        "requested_by": null,
        "requested_at": null,
        "remarks": null
      },
      "timestamps": {
        "created_at": "2026-09-15 08:51:57",
        "submitted_at": null,
        "resubmitted_at": null,
        "approved_at": null,
        "last_edited_at": null
      },
      "actions": {
        "can_edit": true,
        "can_submit": true,
        "can_approve": false,
        "can_rectify": false,
        "rectify_blocked_reason": null
      }
    }
  ]
}
```

---

### 4.3 One plan, day by day

```
GET /app/officers/:empCode/plans/:planId
```

This is the screen the officer spends his time on. It returns the plan summary **plus**
`days`, `cycle_window`, `category_mix` and `history`.

```json
{
  "plan": {
    "plan_id": 1,
    "period_month": "2026-06",
    "cycle_code": "C1",
    "status": "DRAFT",
    "employee": {
      "emp_code": "11003102",
      "emp_name": "PARTHA SARKAR",
      "role": "SO"
    },
    "approver": {
      "emp_code": "11003201",
      "name": "BIKRAM KUMAR HALDER",
      "role": "ASM"
    },
    "counts": {
      "visits": 70,
      "dealers": 34,
      "working_days": 12
    },
    "date_range": {
      "from": "2026-06-01",
      "to": "2026-06-15"
    },
    "rectification": {
      "count": 0,
      "remaining": 1,
      "requested_by": null,
      "requested_at": null,
      "remarks": null
    },
    "timestamps": {
      "created_at": "2026-09-15 08:51:57",
      "submitted_at": null,
      "resubmitted_at": null,
      "approved_at": null,
      "last_edited_at": null
    },
    "actions": {
      "can_edit": true,
      "can_submit": true,
      "can_approve": false,
      "can_rectify": false,
      "rectify_blocked_reason": null
    },
    "category_mix": {
      "Growing": 20,
      "De-growing": 37,
      "Unclassified": 3,
      "Zero Lifter": 10
    },
    "cycle_window": {
      "from": "2026-06-01",
      "to": "2026-06-15",
      "daily_cap": 8,
      "days": [
        {
          "visit_date": "2026-06-01",
          "visit_count": 6,
          "full": false
        },
        {
          "visit_date": "2026-06-02",
          "visit_count": 6,
          "full": false
        },
        "\u2026 13 more"
      ]
    },
    "days": [
      {
        "visit_date": "2026-06-01",
        "visit_count": 6,
        "visits": [
          {
            "detail_id": 1,
            "sequence": 1,
            "dealer": {
              "dealer_id": 23,
              "sap_code": "1000000058",
              "sfa_code": "NER150",
              "name": "RADHIKA ENTERPRISE",
              "type": "DEALER",
              "area": "AGARTALA",
              "zone": "NE2",
              "block": "AMC (SADAR)"
            },
            "final_category": "Growing",
            "grade": "D",
            "priority_score": 33,
            "purpose_of_visit": "PJP Scheduled Visit (D - Growing)",
            "visit_status": "ACTIVE",
            "executed": false,
            "execution": null,
            "source": "AUTO"
          },
          "\u2026 5 more"
        ]
      },
      "\u2026 11 more days"
    ],
    "history": []
  }
}
```

**Fields worth knowing:**

| Field | Why it matters |
|---|---|
| `actions` | the server has already applied every workflow rule — bind your buttons to these booleans and never re-derive them |
| `actions.rectify_blocked_reason` | a sentence to show when `can_rectify` is false |
| `cycle_window.days[]` | **every legal day**, with how full each is. Use this for day pickers — `days[]` only has days that already have visits |
| `cycle_window.daily_cap` | max visits per day for this role (SO 8, ASM 5, RSM 3) |
| `visit.detail_id` | the id for move and remove |
| `visit.executed` / `execution` | whether that visit has been punched, and when |
| `visit.source` | `AUTO` from the generator, `AGENT` if the officer added it |
| `dealer.sap_code` | **null for a prospect** — fall back to `sfa_code` |

---

### 4.4 Counters he may add

```
GET /app/officers/:empCode/dealers?month=2026-06&cycle=C1
```

```json
{
  "emp_code": "11003102",
  "role": "SO",
  "month": "2026-06",
  "cycle": "C1",
  "count": 34,
  "dealers": [
    {
      "sap_code": null,
      "sfa_code": "NSNE90001",
      "dealer_name": "TRIPURA BUILD CENTRE",
      "area": "AGARTALA",
      "zone": "NE2",
      "final_category": "Prospective",
      "grade": "C",
      "priority_score": 1,
      "required_visits": 3,
      "block": null,
      "already_planned": 0
    },
    {
      "sap_code": "1000000058",
      "sfa_code": "NER150",
      "dealer_name": "RADHIKA ENTERPRISE",
      "area": "AGARTALA",
      "zone": "NE2",
      "final_category": "Growing",
      "grade": "D",
      "priority_score": 33,
      "required_visits": 2,
      "block": "AMC (SADAR)",
      "already_planned": 2
    },
    "\u2026 32 more"
  ]
}
```

Only counters targeted to **this** officer for **this** cycle. `already_planned` is how
many times the dealer is already on the plan — show it so he does not double-book by
accident.

---

### 4.5 Add a visit

```
POST /app/officers/:empCode/plans/:planId/visits
```

```json
{
  "visitDate": "2026-06-14",
  "dealerSapCode": "1000004165",
  "purposeOfVisit": "Routine Visit"
}
```

| Field | Required | Notes |
|---|---|---|
| `visitDate` | **yes** | `YYYY-MM-DD`, inside the plan's own cycle window |
| `dealerSapCode` | **yes*** | or `dealerSfaCode`, or `dealerCode` — any one |
| `purposeOfVisit` | no | defaults to a generated line naming the category |

`200`:
```json
{
  "success": true,
  "message": "MAAKALI ENTERPRISE (AGARTALA) added to 2026-06-14.",
  "detail_id": 178,
  "plan_id": 1
}
```

Refusals:

| Code | When |
|---|---|
| `400` | no date or code; date outside the plan month or cycle |
| `400` | the dealer is not one of his targets this cycle — the body also carries a `hint` naming the `/dealers` endpoint |
| `403` | plan is not his, or is SUBMITTED/APPROVED (not editable) |
| `404` | plan not found |
| `409` | the day is at its cap, or that dealer is already on that day |

Some errors carry a second field beside `error` — `hint` on add, `allowed_actions` on a
refused second send-back. Show `error`; use the extra field to decide what to offer next.

---

### 4.6 Move a visit

```
PUT /app/officers/:empCode/plans/:planId/visits/:detailId
{ "visitDate": "2026-06-13" }
```

```json
{
  "success": true,
  "message": "MAAKALI ENTERPRISE (AGARTALA) moved to 2026-06-13.",
  "plan_id": 1,
  "detail_id": 178
}
```

Same refusals as add. Moving to the day it is already on is refused as a duplicate.

---

### 4.7 Remove a visit

```
DELETE /app/officers/:empCode/plans/:planId/visits/:detailId
```

```json
{
  "success": true,
  "message": "MAAKALI ENTERPRISE (AGARTALA) removed from 2026-06-13.",
  "plan_id": 1
}
```

---

### 4.8 Submit

```
POST /app/officers/:empCode/plans/:planId/submit
{}
```

```json
{
  "success": true,
  "message": "Plan 1 submitted to BIKRAM KUMAR HALDER for approval.",
  "plan_id": 1,
  "status": "SUBMITTED",
  "is_resubmission": false,
  "visits_submitted": 70,
  "approver": {
    "emp_code": "11003201",
    "name": "BIKRAM KUMAR HALDER",
    "role": "ASM"
  },
  "rectification_remaining": 1
}
```

| Code | When |
|---|---|
| `400` | the plan has no visits — an empty plan cannot be submitted |
| `409` | already SUBMITTED or APPROVED |
| `409` | the plan has no L1 approver — it cannot reach anyone's inbox |

`is_resubmission` is `true` when the plan was in RECTIFY. After a resubmission
`rectification_remaining` is `0` and the L1's only remaining action is Approve.

---

### 4.9 Punch a visit

```
POST /app/officers/:empCode/visits/punch
```

```json
{
  "visitDate": "2026-06-01",
  "dealerCode": "1000000058",
  "checkInTime": "10:05",
  "checkOutTime": "10:39",
  "visitStatus": "Productive",
  "purposeOfVisit": "Routine Visit",
  "remarks": null
}
```

| Field | Required | Default |
|---|---|---|
| `visitDate` | **yes** | — |
| `dealerCode` | **yes** | also accepts `dealerSapCode` / `dealerSfaCode` |
| `checkInTime` | no | `10:05:00` |
| `checkOutTime` | no | `10:39:00` |
| `duration` | no | computed, e.g. `"34 Minute(s)"` |
| `visitStatus` | no | `Productive` (or `Non productive`) |
| `purposeOfVisit` | no | the planned purpose |
| `remarks` | no | `null` |

`201`:
```json
{
  "message": "Punched RADHIKA ENTERPRISE on 2026-06-01.",
  "planned": true,
  "cycle_code": "C1",
  "sfa_row": {
    "Date of Visit": "2026-06-01",
    "Customer Code": "NER150",
    "Customer Name": "RADHIKA ENTERPRISE",
    "Type": "Dealer",
    "Route": "AGARTALA",
    "Branch": "AGARTALA",
    "Employee Code": "11003102",
    "Employee Name": "PARTHA SARKAR",
    "Check In Time": "10:05:00",
    "Check Out Time": "10:39:00",
    "Duration": "34 Minute(s)",
    "Visit Status(Productive / Non productive)": "Productive",
    "Purpose Of Visit": "PJP Scheduled Visit (D - Growing)",
    "Remarks": null
  }
}
```

**This writes one row to the SFA visit log** — same table, same column names as the SFA
report upload, so adherence and the C2 rebuild cannot tell a punch from an import. The
`sfa_row` object echoes it under the client's own column headers.

- `planned: false` means the visit was **not** on his plan. It is still recorded, and
  reported separately as an unplanned visit. Show the message.
- **A second visit to the same counter on another day is allowed** — officers do go back.
- The same counter twice on the same day is `409`: the SFA system counts that once.

| Code | When |
|---|---|
| `400` | bad or missing date / code |
| `404` | the code is not on his plan and not a counter that month |
| `409` | already punched that counter that day |

---

### 4.10 His adherence

```
GET /app/officers/:empCode/adherence?month=2026-06&cycle=C1&asOn=2026-06-15
```

```json
{
  "emp_code": "11003102",
  "emp_name": "PARTHA SARKAR",
  "role": "SO",
  "month": "2026-06",
  "cycle": "C1",
  "as_on_date": "2026-06-15",
  "elapsed_fraction": 1,
  "has_plan": true,
  "totals": {
    "dealers_on_plan": 34,
    "dealers_visited": 6,
    "dealers_missed": 28,
    "planned_visits": 70,
    "mtd_due": 70,
    "adhered": 7,
    "adhered_capped": 7,
    "pending": 63
  },
  "adherence": {
    "capped_pct": 10,
    "raw_pct": 10,
    "over_visited": false
  },
  "dealers": [
    {
      "sap_code": "1000000029",
      "dealer_name": "DEBNATH CEMENT HOUSE AND IRON STORES",
      "cycle": "C1",
      "planned": 2,
      "adhered": 0,
      "adhered_capped": 0,
      "pending": 2,
      "planned_dates": [
        "2026-06-01",
        "2026-06-02"
      ],
      "visit_dates": [],
      "state": "PENDING"
    },
    {
      "sap_code": "1000003249",
      "dealer_name": "PRIYA CARRING CENTRE",
      "cycle": "C1",
      "planned": 2,
      "adhered": 0,
      "adhered_capped": 0,
      "pending": 2,
      "planned_dates": [
        "2026-06-01",
        "2026-06-02"
      ],
      "visit_dates": [],
      "state": "PENDING"
    },
    "\u2026 32 more"
  ],
  "method": "MTD due = planned x elapsed fraction of the cycle; capped adherence never exceeds 100%"
}
```

`state` per counter is `DONE` / `PARTIAL` / `PENDING`, and the array is sorted **PENDING
first** — what still needs doing is at the top. `has_plan: false` (with `totals: null`)
means he has no plan that month; it is a `200`, not an error.

---

## 5. Approver endpoints

### 5.1 Inbox

```
GET /app/approvers/:empCode/inbox?month=2026-06&status=SUBMITTED
```

Returns `{ approver, filter, count, plans[] }`, where each plan has the same shape as
§4.2 but with `actions` computed for the **approver** (`can_approve`, `can_rectify`
true; `can_edit` false). A plan reaches exactly one inbox: the one named in its
`approver.emp_code`.

### 5.2 Review a plan

```
GET /app/approvers/:empCode/plans/:planId
```

Identical payload to §4.3 with approver-side `actions`. `category_mix` is the summary an
approver actually reads before deciding:

```json
{ "Growing": 20, "De-growing": 37, "Unclassified": 3, "Zero Lifter": 10 }
```

### 5.3 Decide

```
POST /app/approvers/:empCode/plans/:planId/decision
{ "action": "APPROVE", "remarks": "Approved." }
{ "action": "RECTIFY", "remarks": "Add the two counters you missed in Dukli." }
```

| Field | Required | Notes |
|---|---|---|
| `action` | **yes** | `APPROVE` or `RECTIFY` (`APPROVED` also accepted) |
| `remarks` | on RECTIFY | **required** when sending back — the officer needs to know what to fix |

APPROVE `200`:
```json
{
  "success": true,
  "message": "Plan 1 approved by 11003201.",
  "plan_id": 1,
  "status": "APPROVED",
  "approved_by": "11003201",
  "approver_role": "ASM",
  "via": "L1"
}
```

RECTIFY `200`:
```json
{
  "success": true,
  "message": "Plan 1 sent back to PARTHA SARKAR for rectification. This was the only send-back available \u2014 the next submission must be approved.",
  "plan_id": 1,
  "status": "RECTIFY",
  "rectification_count": 1,
  "rectification_remaining": 0,
  "remarks": "Add the two counters you missed in Dukli."
}
```

| Code | When |
|---|---|
| `400` | action is neither APPROVE nor RECTIFY; RECTIFY with no remarks |
| `403` | this person is not the plan's L1 |
| `409` | the plan is not SUBMITTED |
| `409` | second RECTIFY — response includes `allowed_actions: ["APPROVE"]` |

### 5.4 Team adherence

```
GET /app/approvers/:empCode/team-adherence?month=2026-06&cycle=C1
```

```json
{
  "approver_emp_code": "11003201",
  "month": "2026-06",
  "cycle": "C1",
  "as_on_date": "2026-06-15",
  "team_size": 4,
  "totals": {
    "planned_visits": 130,
    "mtd_due": 130,
    "adhered": 10,
    "capped_pct": 7.7
  },
  "team": [
    {
      "emp_code": "11003103",
      "emp_name": "RAJIB CHAKRABORTY",
      "role": "SO",
      "has_plan": true,
      "dealers_on_plan": 5,
      "dealers_visited": 0,
      "dealers_missed": 5,
      "planned_visits": 10,
      "mtd_due": 10,
      "adhered": 0,
      "pending": 10,
      "capped_pct": 0
    },
    {
      "emp_code": "11003101",
      "emp_name": "SUBRATA DEB",
      "role": "SO",
      "has_plan": true,
      "dealers_on_plan": 11,
      "dealers_visited": 1,
      "dealers_missed": 10,
      "planned_visits": 26,
      "mtd_due": 26,
      "adhered": 1,
      "pending": 25,
      "capped_pct": 3.8
    },
    "\u2026 2 more"
  ]
}
```

Sorted **weakest first**. `totals.capped_pct` is `sum(adhered) / sum(mtd_due)` — a sum,
not an average of percentages, so a man with two counters cannot outweigh one with forty.

---

## 6. Reporting endpoints

These are the numbers an admin or an L1 reads. All are read-only.

### 6.1 Day by day, accumulating

```
GET /app/admin/adherence/daily?month=2026-06&cycle=C1&asOn=&role=&empCode=
GET /app/approvers/:empCode/adherence/daily?month=&cycle=&asOn=
```

| Query | Notes |
|---|---|
| `month` | **required**, `YYYY-MM` |
| `cycle` | `C1` (default) / `C2` |
| `asOn` | `YYYY-MM-DD`; days after it come back `is_future: true` |
| `role` | `SO` / `ASM` / `RSM` / `ZH` (admin route only) |
| `empCode` | one officer (admin route only) |

```json
{
  "scope": "officer 11003102",
  "period_month": "2026-06",
  "cycle_code": "C1",
  "as_on_date": "2026-06-15",
  "cycle_window": {
    "from": "2026-06-01",
    "to": "2026-06-15"
  },
  "officers_in_scope": 1,
  "totals": {
    "planned_in_cycle": 70,
    "logged_in_cycle": 8,
    "log_rows_read": 8,
    "cum_planned": 70,
    "cum_adhered": 8,
    "cum_pct": 11.4
  },
  "method": "cum_pct = visits made on or before the date / visits due on or before it, capped per counter. Not the prorated MTD figure \u2014 this one is exact to the date.",
  "days": [
    {
      "date": "2026-06-01",
      "is_future": false,
      "planned": 6,
      "logged": 1,
      "same_day": 1,
      "unplanned": 0,
      "cum_planned": 6,
      "cum_adhered": 1,
      "cum_pct": 16.7
    },
    {
      "date": "2026-06-02",
      "is_future": false,
      "planned": 6,
      "logged": 0,
      "same_day": 0,
      "unplanned": 0,
      "cum_planned": 12,
      "cum_adhered": 1,
      "cum_pct": 8.3
    },
    {
      "date": "2026-06-03",
      "is_future": false,
      "planned": 6,
      "logged": 1,
      "same_day": 0,
      "unplanned": 0,
      "cum_planned": 18,
      "cum_adhered": 2,
      "cum_pct": 11.1
    },
    "\u2026 12 more"
  ]
}
```

| Field | Meaning |
|---|---|
| `planned` | visits scheduled that day |
| `logged` | SFA visits that day, **de-duplicated** per counter per day |
| `same_day` | planned that day and visited that day |
| `unplanned` | logged against a counter on nobody's plan |
| `cum_planned` | every visit due on or before that day |
| `cum_adhered` | of those, how many made on or before it — capped per counter |
| `cum_pct` | `cum_adhered / cum_planned` |
| `log_rows_read` | raw row count before de-duplication, for reconciliation |

**This percentage is not the headline percentage.** The headline (§4.10, §5.4) prorates:
`MTD due = planned × elapsed fraction of the cycle`. This one counts what was actually
due by each date. Both are correct answers to different questions; label them differently
in your UI or people will think one is broken.

### 6.2 Counter tracker — the client's own sheet

```
GET /app/admin/adherence/counters?month=&cycle=&asOn=&empCode=&role=&search=
GET /app/approvers/:empCode/adherence/counters?month=&cycle=&asOn=&search=
```

One row per counter, four role blocks, five figures each — the exact shape of
*Target vs Adhe SO_ASM_RSM_ZM*.

```json
{
  "scope": "officer 11003102",
  "period_month": "2026-06",
  "cycle_code": "C1",
  "as_on_date": "2026-06-15",
  "elapsed_fraction": 1,
  "count": 34,
  "columns": {
    "dimensions": [
      "Zone",
      "\u2026 13 more"
    ],
    "per_role": [
      "No. of visits Planned in (DJP)",
      "\u2026 4 more"
    ]
  },
  "method": "Adherence % = adhered / IF(MTD planned < 1, planned, MTD planned). Pending = MTD planned - adhered, and is negative when ahead of schedule.",
  "totals": {
    "SO": {
      "planned": 70,
      "mtd_planned": 70,
      "adhered": 8,
      "adherence_pct": 11.4,
      "pending": 62,
      "counters": 34
    },
    "ASM": {
      "planned": 0,
      "mtd_planned": 0,
      "adhered": 0,
      "adherence_pct": 0,
      "pending": 0,
      "counters": 0
    },
    "RSM": {
      "planned": 0,
      "mtd_planned": 0,
      "adhered": 0,
      "adherence_pct": 0,
      "pending": 0,
      "counters": 0
    },
    "ZH": {
      "planned": 0,
      "mtd_planned": 0,
      "adhered": 0,
      "adherence_pct": 0,
      "pending": 0,
      "counters": 0
    }
  },
  "counters": [
    {
      "customer_code": "1000004165",
      "sfa_code": "NEN235",
      "dealer_name": "NEW MAHENDRA BHANDAR",
      "zone": "NE2",
      "region": "NE2",
      "cust_type": "Dealer",
      "area": "AGARTALA",
      "block": "JIRANIA",
      "zsh_name": "BRIJESH SINGH",
      "rsm_name": "GHALIB FAHAD AYUBI",
      "asm_name": "BIKRAM KUMAR HALDER",
      "so_name": "PARTHA SARKAR",
      "counter_strategy": null,
      "grade": "C",
      "category": "De-growing",
      "priority": 12,
      "by_role": {
        "SO": {
          "planned": 3,
          "mtd_planned": 3,
          "adhered": 0,
          "adherence_pct": 0,
          "pending": 3,
          "emp_code": "11003102",
          "emp_name": "PARTHA SARKAR",
          "planned_dates": [
            "2026-06-06",
            "\u2026 2 more"
          ],
          "visit_dates": []
        },
        "ASM": {
          "planned": 0,
          "mtd_planned": 0,
          "adhered": 0,
          "adherence_pct": 0,
          "pending": 0,
          "emp_code": null,
          "emp_name": null,
          "planned_dates": [],
          "visit_dates": []
        },
        "RSM": {
          "planned": 0,
          "mtd_planned": 0,
          "adhered": 0,
          "adherence_pct": 0,
          "pending": 0,
          "emp_code": null,
          "emp_name": null,
          "planned_dates": [],
          "visit_dates": []
        },
        "ZH": {
          "planned": 0,
          "mtd_planned": 0,
          "adhered": 0,
          "adherence_pct": 0,
          "pending": 0,
          "emp_code": null,
          "emp_name": null,
          "planned_dates": [],
          "visit_dates": []
        }
      }
    },
    "\u2026 33 more"
  ]
}
```

The two formulas, taken verbatim from their workbook:

```
Adherence % = adhered / IF(MTD planned < 1, planned, MTD planned)
Pending     = MTD planned − adhered           ← negative means AHEAD of schedule
```

Do not clamp `pending` at zero and do not cap `adherence_pct` at 100 in the client —
both carry meaning. Rows are sorted furthest-behind first. `search` matches dealer name,
either code, officer, area, block or category.

### 6.3 What changes after the 15th

```
GET /app/admin/cycle-handover?month=2026-06&empCode=
```

```json
{
  "period_month": "2026-06",
  "scope": "officer 11003102",
  "windows": {
    "C1": "2026-06-01 \u2192 2026-06-15",
    "C2": "2026-06-16 \u2192 month end"
  },
  "c2_exists": false,
  "summary": {
    "c1_counters": 34,
    "c1_visited": 7,
    "c1_missed": 27,
    "carried_forward": 0,
    "missed_and_dropped": 27,
    "visited_and_repeated": 0,
    "new_in_c2": 0,
    "carried_in_first_half_of_c2": 0,
    "c2_median_first_day": null
  },
  "explains": "C2 has not been generated for this month yet. The counters listed as missed are the ones a rebuild would carry forward.",
  "counters": [
    {
      "emp_code": "11003102",
      "emp_name": "PARTHA SARKAR",
      "role": "SO",
      "customer_code": "1000000023",
      "dealer_name": "BABA LOKENATH CEMENT HOUSE",
      "c1_planned": 2,
      "c1_dates": [
        "2026-06-10",
        "2026-06-11"
      ],
      "c1_visited": false,
      "c2_planned": 0,
      "c2_dates": [],
      "c2_first_day": null,
      "outcome": "MISSED_AND_DROPPED"
    },
    {
      "emp_code": "11003102",
      "emp_name": "PARTHA SARKAR",
      "role": "SO",
      "customer_code": "1000000024",
      "dealer_name": "BASUNDHARA ENTERPRISE",
      "c1_planned": 2,
      "c1_dates": [
        "2026-06-03",
        "2026-06-04"
      ],
      "c1_visited": false,
      "c2_planned": 0,
      "c2_dates": [],
      "c2_first_day": null,
      "outcome": "MISSED_AND_DROPPED"
    },
    "\u2026 32 more"
  ]
}
```

Each counter gets exactly one `outcome`:

| outcome | meaning |
|---|---|
| `CARRIED_FORWARD` | planned in C1, not visited, now in C2 |
| `MISSED_AND_DROPPED` | planned in C1, not visited, **not** in C2 |
| `NEW_IN_C2` | not in C1 at all |
| `VISITED_AND_REPEATED` | visited in C1, due again in C2 |
| `VISITED_AND_DONE` | visited in C1, not repeated |

It works **before** C2 exists: `c2_exists: false` and `explains` says the missed counters
are what a rebuild would carry forward. That is when a manager wants it.

### 6.4 Months that have plans

```
GET /app/admin/plan-periods
```

```json
{
  "count": 1,
  "latest": "2026-06",
  "periods": [
    {
      "month": "2026-06",
      "plans": 7,
      "officers": 7,
      "cycles": {
        "C1": {
          "plans": 7,
          "visits": 177,
          "by_status": {
            "DRAFT": 7
          }
        }
      },
      "by_status": {
        "DRAFT": 7
      }
    }
  ]
}
```

Use this to build month and cycle pickers. Never let a user pick a month that is not in
this list — they land on an empty screen that looks like a broken app.

### 6.5 Rebuild C2 from adherence

```
POST /generation/regenerate-c2
{ "periodMonth": "2026-06" }
```

Reads C1 adherence from the SFA log, **deletes** the existing C2 plans, targets and DJP
recommendations for that month, and runs the full pipeline again with missed counters
prioritised. C1 is untouched. Responds with `adherenceSummary` and the new
`generationCode`.

This is a long request — allow **several minutes** of client timeout, and disable the
button while it runs.

---

## 7. Implementation guide

### 7.1 Screen by screen

**Login / identity.** Capture the employee code once. Call
`GET /app/officers/:empCode/summary` — if `role` comes back `ASM`/`RSM`/`ZH` **and**
`awaiting_my_approval > 0`, show the Approvals tab as well. The same person is often both
an officer with his own plan and an approver for others; build for that, not against it.

**Home.** `summary` gives the badge numbers. One call, cheap, safe to poll on resume.

**My plans.** `GET .../plans?month&cycle`. Drive the month/cycle pickers from
`/app/admin/plan-periods` rather than a date widget.

**Plan detail.** `GET .../plans/:planId` is the only call this screen needs — it carries
the schedule, the legal days, the caps, the workflow booleans and the history. Render
`days[]` as sections; render each `visit` with `dealer.name`, `final_category`, `grade`,
and a tick when `executed`.

**Editing.** Bind to `actions.can_edit`. Day pickers come from `cycle_window.days[]` —
disable any day where `full` is true. After every add / move / remove, **re-fetch the plan
detail** rather than patching local state: the server recomputes counts, caps and
`actions`, and a stale local copy is how a client starts showing buttons the API will
refuse.

**Submit.** `actions.can_submit` → POST submit → re-fetch. Show
`rectification_remaining` so he knows whether a send-back is still possible.

**Punch.** From a visit row (pre-filled date and dealer) or from a "log a visit" screen
(any counter from `/dealers`, any day in `cycle_window`). On `201`, re-fetch the plan
detail so the tick appears, and the adherence screen if it is open. If `planned` is
`false`, show the returned message — the officer should know it counted as unplanned.

**Adherence.** `GET .../adherence` for the headline and the counter list;
`/app/admin/adherence/daily?empCode=` for his day-by-day run. Two calls, both cheap.

**Approvals.** `inbox` → `plans/:planId` → `decision`. After a decision, re-fetch the
inbox; the plan leaves it.

### 7.2 The rules the server enforces (don't duplicate them, do explain them)

| Rule | Where you see it |
|---|---|
| editable only in DRAFT / RECTIFY | `actions.can_edit` |
| one send-back per plan | `rectification.remaining`, `actions.rectify_blocked_reason` |
| daily cap per role | `cycle_window.daily_cap`, `days[].full`, else `409` |
| one dealer once per day on a plan | `409` on add / move |
| one counter once per day in the log | `409` on punch |
| visit must fall in the plan's cycle | `400` naming the window |
| only the named L1 may decide | `403` |

Mirror them for **prevention** (grey out a full day) but never as the source of truth.
When a `409` comes back anyway, show its message — it is written for the user.

### 7.3 Caching and refresh

| Data | Cache | Refresh when |
|---|---|---|
| `plan-periods` | session | app resume |
| `dealers` | per month+cycle | month or cycle changes |
| plan detail | never — always fresh | after every mutation, on screen focus |
| adherence / daily / counters | 60s is fine | pull to refresh, after a punch |

No websockets and no push. An officer's own actions are the only thing that changes his
plan mid-session, so re-fetching after each mutation is sufficient.

### 7.4 Offline

There is no sync endpoint. If you queue punches offline, replay them one at a time and
treat `409 already punched` as **success** — it means the row is already there, which is
the state the user wanted. Do not retry a `400` or `404`; they will never succeed.

### 7.5 Worked example — the full officer loop

```bash
BASE=http://localhost:3000/api
SO=11003102

# 1. what needs doing
curl -s "$BASE/app/officers/$SO/summary?month=2026-06"

# 2. his plan for the cycle
PLAN=$(curl -s "$BASE/app/officers/$SO/plans?month=2026-06&cycle=C1" \
       | jq -r '.plans[0].plan_id')

# 3. the schedule
curl -s "$BASE/app/officers/$SO/plans/$PLAN" | jq '.plan.days[0]'

# 4. add a counter on a free day
curl -s -X POST "$BASE/app/officers/$SO/plans/$PLAN/visits" \
  -H 'Content-Type: application/json' \
  -d '{"visitDate":"2026-06-14","dealerSapCode":"1000004165","purposeOfVisit":"Routine Visit"}'

# 5. send it to his manager
curl -s -X POST "$BASE/app/officers/$SO/plans/$PLAN/submit" \
  -H 'Content-Type: application/json' -d '{}'

# 6. the manager approves
L1=11003201
curl -s -X POST "$BASE/app/approvers/$L1/plans/$PLAN/decision" \
  -H 'Content-Type: application/json' \
  -d '{"action":"APPROVE","remarks":"Approved."}'

# 7. he goes, and records it
curl -s -X POST "$BASE/app/officers/$SO/visits/punch" \
  -H 'Content-Type: application/json' \
  -d '{"visitDate":"2026-06-01","dealerCode":"1000000058","checkInTime":"10:05","checkOutTime":"10:39"}'

# 8. how he is doing
curl -s "$BASE/app/officers/$SO/adherence?month=2026-06&cycle=C1" | jq '.adherence'
```

### 7.6 A minimal client

```js
const BASE = 'http://localhost:3000/api';

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // data.error is a sentence written to be shown to the user
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const Officer = {
  summary:  (emp, month)            => api('GET', `/app/officers/${emp}/summary?month=${month}`),
  plans:    (emp, month, cycle)     => api('GET', `/app/officers/${emp}/plans?month=${month}&cycle=${cycle}`),
  plan:     (emp, id)               => api('GET', `/app/officers/${emp}/plans/${id}`),
  dealers:  (emp, month, cycle)     => api('GET', `/app/officers/${emp}/dealers?month=${month}&cycle=${cycle}`),
  addVisit: (emp, id, v)            => api('POST', `/app/officers/${emp}/plans/${id}/visits`, v),
  moveVisit:(emp, id, det, date)    => api('PUT', `/app/officers/${emp}/plans/${id}/visits/${det}`, { visitDate: date }),
  dropVisit:(emp, id, det)          => api('DELETE', `/app/officers/${emp}/plans/${id}/visits/${det}`),
  submit:   (emp, id)               => api('POST', `/app/officers/${emp}/plans/${id}/submit`, {}),
  punch:    (emp, p)                => api('POST', `/app/officers/${emp}/visits/punch`, p),
  adherence:(emp, month, cycle)     => api('GET', `/app/officers/${emp}/adherence?month=${month}&cycle=${cycle}`)
};

export const Approver = {
  inbox:    (emp, month)            => api('GET', `/app/approvers/${emp}/inbox?month=${month}`),
  plan:     (emp, id)               => api('GET', `/app/approvers/${emp}/plans/${id}`),
  decide:   (emp, id, action, remarks) =>
              api('POST', `/app/approvers/${emp}/plans/${id}/decision`, { action, remarks }),
  team:     (emp, month, cycle)     => api('GET', `/app/approvers/${emp}/team-adherence?month=${month}&cycle=${cycle}`)
};

// Dealer code: a prospect has NO sap_code.
export const codeOf = d => d.sap_code || d.sfa_code;
```

---

## 8. Before you point an app at a live database

Three migrations must have been run, or endpoints fail in ways that look like app bugs:

```bash
node src/scripts/migrate-missing-objects.js     # sales_plan_details.source etc.
node src/scripts/migrate-app-plan-workflow.js   # sales_plans routing columns
node src/scripts/fix-routing.js <YYYY-MM> --fix # give every plan an L1 approver
```

| Symptom | Cause |
|---|---|
| `500 Unknown column 'd.source'` | first migration not run — **every** plan detail fails |
| every plan shows no approver; nothing can be submitted | second and third not run |
| empty history / no approval trail | `plan_approvals` missing `approver_role` |
| adherence is 0% everywhere | no SFA report uploaded for that month |
| no plans at all | Generate Plans has not been run for that month |

A reference implementation of every screen in this document is `public/simulator.html`,
served at `/simulator`. It calls these endpoints and nothing else — when in doubt about a
payload, open its request log and watch what it sends.
