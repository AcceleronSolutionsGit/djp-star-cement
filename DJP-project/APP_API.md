# Field App API — plans, editing, and L1 approval

Backend only. Every route is scoped by the employee code in the path; there are no tokens and no session. The app sends the ID, and each handler checks that the person named in the path actually owns (or approves) the plan being touched.

## Install

```bash
node src/scripts/migrate-app-plan-workflow.js     # adds the workflow columns, safe to re-run
npm start
```

Then re-stamp any plans that already exist so they get a role and an approver:

```bash
curl -X POST localhost:3000/api/app/routing/restamp -H 'Content-Type: application/json' \
  -d '{"periodMonth":"2026-09"}'
```

New generation runs do this automatically.

## Workflow

```
generation ──▶ DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED
                 ▲                    │
                 │                    │ rectify (once only)
                 └──── RECTIFY ◀──────┘
```

- The agent may edit only while the plan is **DRAFT** or **RECTIFY**.
- While **SUBMITTED** the agent is locked out; the plan is with the approver.
- **Only L1 approves.** No second level, no escalation.
- L1 may send a plan back **exactly once**. On the next submission the only action available is Approve; a second `RECTIFY` returns `409` with `allowed_actions: ["APPROVE"]`.
- Remarks are mandatory when sending back — the agent needs to know what to fix.

## Agent endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/app/officers/:empCode/summary?month=` | home counters |
| `GET` | `/api/app/officers/:empCode/plans?month=&cycle=&status=` | **list view** |
| `GET` | `/api/app/officers/:empCode/plans/:planId` | **detail view** |
| `GET` | `/api/app/officers/:empCode/dealers?month=&cycle=` | dealers this officer may add |
| `POST` | `/api/app/officers/:empCode/plans/:planId/visits` | add a visit |
| `PUT` | `/api/app/officers/:empCode/plans/:planId/visits/:detailId` | move / re-sequence |
| `DELETE` | `/api/app/officers/:empCode/plans/:planId/visits/:detailId` | drop a visit |
| `POST` | `/api/app/officers/:empCode/plans/:planId/submit` | send to L1 |

### List view

```
GET /api/app/officers/11001774/plans?month=2026-09
```

```json
{
  "emp_code": "11001774",
  "emp_name": "DEBABRATA CHAKRABORTY- FKT",
  "role": "SO",
  "count": 2,
  "plans": [{
    "plan_id": 41,
    "period_month": "2026-09",
    "cycle_code": "C1",
    "status": "RECTIFY",
    "employee":  { "emp_code": "11001774", "emp_name": "DEBABRATA CHAKRABORTY- FKT", "role": "SO" },
    "approver":  { "emp_code": "11001393", "name": "DEBABRATA GHOSH", "role": "ASM" },
    "counts":    { "visits": 11, "dealers": 5, "working_days": 5 },
    "date_range":{ "from": "2026-09-01", "to": "2026-09-07" },
    "rectification": {
      "count": 1, "remaining": 0,
      "requested_by": "11001393",
      "requested_at": "2026-09-02 11:14:03",
      "remarks": "Move the Falakata cluster to one day and drop the duplicate on the 4th."
    },
    "timestamps": { "created_at": "...", "submitted_at": "...", "resubmitted_at": null,
                    "approved_at": null, "last_edited_at": "..." },
    "actions": {
      "can_edit": true, "can_submit": true,
      "can_approve": false, "can_rectify": false,
      "rectify_blocked_reason": "This plan has already been sent back once. The only remaining action is Approve."
    }
  }]
}
```

`actions` is computed server-side so the app never has to encode the state rules itself — render the buttons straight off those four booleans.

### Detail view

```
GET /api/app/officers/11001774/plans/41
```

Returns everything in the list-view shape plus:

```json
{
  "category_mix": { "Need to Grow": 2, "De-growing": 5, "Zero Lifter": 2, "Growing": 2 },
  "days": [{
    "visit_date": "2026-09-01",
    "visit_count": 3,
    "visits": [{
      "detail_id": 512,
      "sequence": 1,
      "dealer": { "dealer_id": 88, "sap_code": "1000001153", "sfa_code": "WBR128",
                  "name": "R P ENTERPRISE", "type": "DEALER",
                  "area": "ALIPURDUAR", "zone": "NB1", "block": "MADARIHAT" },
      "final_category": "Need to Grow",
      "grade": "A",
      "priority_score": 95,
      "purpose_of_visit": "PJP Scheduled Visit (A - Need to Grow)",
      "visit_status": "ACTIVE",
      "source": "AUTO"
    }]
  }],
  "history": [
    { "action_by": "11001774", "action_type": "SUBMITTED", "remarks": null, "created_at": "..." },
    { "action_by": "11001393", "action_type": "RECTIFY", "approver_role": "ASM", "remarks": "...", "created_at": "..." }
  ]
}
```

Visits are grouped by day and ordered by sequence, so the day cards render without any client-side regrouping. Category, grade and priority are joined from `dealer_visit_targets`, and `source` distinguishes `AUTO` (generated) from `AGENT` (added by hand).

### Editing

```
POST /api/app/officers/11001774/plans/41/visits
{ "visitDate": "2026-09-08", "dealerSapCode": "1000001146", "purposeOfVisit": "Revival call" }
```

Four guards, each returning a plain-language error:

- the date must fall inside the plan's own cycle window, read from `c1_start_day` / `c1_end_day` in `business_rules` — a C2 date on a C1 plan is refused
- the date must be in the plan's month
- the dealer must be one of this officer's own targets for that period and cycle
- the day must respect the daily cap (role capacity, hard-capped at 8) and the one-visit-per-dealer-per-day rule

These are the same two scheduling constraints `AutoPlanGenerator` enforces, so an agent cannot hand-build a day the generator would never have produced.

## L1 approver endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/app/approvers/:empCode/inbox?month=&status=` | plans awaiting me |
| `GET` | `/api/app/approvers/:empCode/plans/:planId` | detail view |
| `POST` | `/api/app/approvers/:empCode/plans/:planId/decision` | `APPROVE` or `RECTIFY` |

```
POST /api/app/approvers/11001393/plans/41/decision
{ "action": "RECTIFY", "remarks": "Move the Falakata cluster to one day." }
```

```json
{
  "success": true,
  "message": "Plan 41 sent back to DEBABRATA CHAKRABORTY- FKT for rectification. This was the only send-back available — the next submission must be approved.",
  "plan_id": 41, "status": "RECTIFY",
  "rectification_count": 1, "rectification_remaining": 0
}
```

`status=ALL` on the inbox returns decided plans too, for a history tab.

## Who approves whom

The approval matrix gives the required *role*. It does not say which *person* holds that role over a given employee — and the app needs a named individual so an approver can open "plans waiting on me". `planRouting.service.js` resolves that from the SO → ASM → RSM → ZH hierarchy in `dealer_visit_targets` and writes it onto the plan at generation and again at submit.

| Plan owner | L1 approver |
|---|---|
| SO | their ASM |
| ASM | their RSM |
| RSM | their ZH |
| ZH | any ADMIN |

If an employee's rows disagree about their superior — which happens mid-handover — the most frequently occurring one wins, so a single stray row cannot silently reroute a plan. Any plan that ends up with no resolvable approver is logged at generation and refused at submit with an explicit message, rather than vanishing into nobody's inbox.

An ADMIN can act on any plan. A manager with the right role but the wrong territory cannot.

## Two bugs fixed along the way

**RSM and ZH plans were never generated.** `fetchEmployeeTargetDealers()` set `codeField` to `rsm_name` / `zh_name`, but `generatePlansForAllRoles()` passes `rsm_code` / `zh_code`. The lookup matched nothing, the function returned early with "No PJP visit targets required", and no `sales_plans` row was written. Only SO and ASM plans existed. Fixed to `rsm_code` / `zh_code`.

**Every plan was routed as an SO plan.** `emp_role` was never written at insert, so it fell to the column default of `'SO'` — meaning an ASM's own plan asked for ASM approval, i.e. self-approval. The generator now persists `resolvedRole`.

## Tests

```bash
node test/prepare-sandbox.mjs && node test/workflow.test.mjs
```

32 assertions against the real controller code, backed by in-memory SQLite — no MySQL needed. The sandbox is rebuilt from current source each run, so it cannot drift. Covers routing for both SO and ASM plans, list and detail shape, cross-officer access refusal, all four edit guards, the submit lock, inbox scoping, non-approver refusal, the full rectify-once cycle including the refused second attempt, post-approval immutability, and the ordering of the audit trail.
