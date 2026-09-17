# Complete workflow test pack

Everything needed to exercise the build end to end — upload, classify, generate, approve, measure adherence, regenerate — with an expected value for each step.

Planning month throughout: **2026-09**. Sales data runs to Jun'26, so the sales anchor resolves to 2026-06 either way.

---

## Files

### Upload these (in this order)

| # | File | Rows | Upload as |
|---|---|---|---|
| 1 | `TEST_01_Dealer_Mapping.xlsx` | 18 | Dealer Mapping |
| 2 | `TEST_03_SBG_Master.xlsx` | 18 | SBG Master |
| 3 | `TEST_04_Sales_History_RSAR.xlsx` | 20 | Sales History (RSAR) |
| 4 | `TEST_02_Dealer_Performance.xlsx` | 18 | Dealer Performance |
| 5 | `TEST_05_Prospect_Dealers.xlsx` | 15 | Prospect Dealers |
| 6 | `TEST_06_SFA_Report.xlsx` | 19 visits + 7 employees | SFA Report — **after** generating plans |

Dealer Mapping must go before SBG. SBG only ever *updates* dealers that already exist, so the other way round leaves every dealer with `sbg_potential = NULL` — which silently breaks the area-percentile chain and therefore Final Category.

### Expected outcomes

| File | What it covers |
|---|---|
| `EXPECTED_WORKFLOW.xlsx` | **Start here.** Seven sheets, one per stage, with the run order |
| `EXPECTED_RESULTS.xlsx` | Final Category (column U) per dealer, planning month 2026-07 |
| `RUN_REVIEW_2026-09.xlsx` | The same at 2026-09, with your last run diffed against it |
| `EXPECTED_ADHERENCE.xlsx` | Adherence under the prorata method, to the dealer |
| `ADHERENCE_TECHNIQUE.md` | The method derived from the client's own formulas |
| `README_Final_Category_Spec.md` | The column-U rule, and where the code diverges |
| `UI_WALKTHROUGH.md` | Click-by-click through the admin panel |

---

## Setup

```bash
node src/scripts/migrate-app-plan-workflow.js     # workflow columns, safe to re-run
node src/scripts/backfill-employee-names.js       # dry run
node src/scripts/backfill-employee-names.js --apply
npm start
npm run dev:frontend
```

---

## Stage 1 — classification

Upload the five files, set the month to 2026-09, press **Generate**, and pick **September 2026** in the modal. The default comes from your latest sales month + 1, so June data offers July — override it to September for this pack.

`EXPECTED_WORKFLOW.xlsx → 1_Final_Category` has all 33 rows.

| Category | Count |
|---|---|
| Prospective | 15 |
| Growing | 5 |
| De-growing | 4 |
| Need to Grow | 3 |
| Zero Lifter | 3 |
| Churn | 3 |

Two rows deliberately differ between the 2026-07 and 2026-09 anchors — `1000001154` and `1000001615`. That is not a bug, it is the DOA tiers moving with the planning month. Both columns are in the sheet.

The `AK` column is the need-to-grow flag. Three dealers carry it, and all three must come out as **Need to Grow** — if they say Growing or De-growing, `classifyDealer()` is still ignoring the flag.

## Stage 2 — officer plans and routing

**Officer Plans & Adherence → Officer Plans**, month 2026-09, cycle Both.

`EXPECTED_WORKFLOW.xlsx → 2_Plans_And_Routing`. The three that catch the most:

- **Roles covered: 4.** If it says 2, the `rsm_code` / `zh_code` fix is not in and RSM/ZH plans were never created.
- **The officer column shows names, not codes.** A bare `11001813` means the backfill has not run.
- **Needs attention: 0.** Anything above zero is a plan with no approver — it can never be submitted and appears in nobody's inbox.

No Churn dealer may appear on any plan. HARI OM, ADIL and ROY get zero visits at every grade.

## Stage 3 — the approval workflow

`EXPECTED_WORKFLOW.xlsx → 3_Approval_Workflow` lists 22 calls with the status code each must return. The shape:

```
DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED
  ▲                    │
  └──── RECTIFY ◀──────┘   once only
```

The ones worth doing by hand:

- editing while SUBMITTED → **409**, "the plan is with your approver"
- a second `RECTIFY` → **409** with `allowed_actions: ["APPROVE"]`
- an approver from the wrong territory → **403**, even with the right role
- the audit trail ends up `SUBMITTED → RECTIFY → RESUBMITTED → APPROVED`, in that order

## Stage 4 — adherence

Upload `TEST_06_SFA_Report.xlsx`, then **Adherence tab → cycle C1 → Run adherence**. Leave the as-on date blank; it defaults to the 15th, the day the SFA feedback lands.

| Tile | Expected |
|---|---|
| Planned visits | **34** (16 employee-dealer pairs) |
| MTD due | **34** — C1 is fully elapsed on the 15th |
| Adhered | **14** raw, **13** capped |
| Adherence | **38.2%** capped, **41.2%** raw |
| Pending | **20** |
| Coverage | **62.5%** — 10 of 16 dealers |

Per role: SO 12/31, ASM 2/3 (66.7%). The ASM row exists to prove roles are scored separately.

**Then change the as-on date to 08-Sep** and run again. The fraction drops to 8/15 and MTD due to 18.13, while the plan itself does not move. That is the whole point of prorata — a partial month is not punished. `EXPECTED_ADHERENCE.xlsx → Mid_Cycle_Prorata` has both columns side by side.

Three things the log is built to prove, all in `Expected_By_Dealer`:

- **R P ENTERPRISE**: 3 visits against 2 planned → raw 150%, capped 100%, pending **−1**. Over-visiting is meant to be visible.
- **MAHESWARI**: logged as `WBM273`, resolved through `master_dealers.sfa_code` and counted. Before the rewrite this read as missed — and the real SFA export always sends the SFA code, so this is the normal case, not an edge one.
- **MD SAHAJAHAN**: visited twice against 2 planned → the only dealer at a clean 100%.

Two rows fall outside the window on purpose (16-Sep and 31-Aug) and three visits are unplanned (PUNAM logged by the wrong SO, plus the two Churn dealers).

## Stage 5 — C2 regeneration

**Regenerate C2 + plans** on the same tab. `EXPECTED_WORKFLOW.xlsx → 5_C2_Regeneration` names the six dealers that must lead the new C2 plans.

C1 is never touched — it has been executed, and it is the record the adherence figure was measured against.

## Stage 6 — automated suites

```bash
node test/prepare-sandbox.mjs
node test/workflow.test.mjs          # 35
node test/pipeline.test.mjs          # 17
node test/employee-names.test.mjs    # 11
node test/adherence-method.test.mjs  # 32
```

**95 assertions.** They run the real controllers and engines against in-memory SQLite, so no MySQL is needed, and the sandbox is rebuilt from current source each run so it cannot drift from what you have deployed.

---

## How the expected values were produced

The adherence numbers are not hand-computed. `test/build-expected-adherence.mjs` seeds the plan and the visit log, runs the **real engine**, and the workbook is written from its output — so the expectations cannot drift from the implementation without the build failing.

The classification figures come from the rule read out of the client's `M.xlsx` formula, which reproduces 12,656 of 12,658 rows of their master. The two exceptions have a blank DOA.

Every file was cross-checked against the others before packaging: the 19 SFA rows match the log the expectations were derived from, the 34 seed rows match the planned total, and the two anchor-sensitive dealers are the expected two.

## Still open

The guidelines document says **3-month churn**; the working master computes Churn from the **6-month** average being zero. This pack follows the 6-month rule because that is what produced the numbers we match at 99.98%. If the client confirms 3 months, the Churn population changes and every downstream grade moves with it.
