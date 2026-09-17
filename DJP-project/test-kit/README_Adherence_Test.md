# Adherence test — C1 SFA execution vs C1 plan

Period **2026-09** · C1 window **2026-09-01 … 2026-09-15** · role **SO**

## Files

| File | Sheets |
|---|---|
| `TEST_06_SFA_Report.xlsx` | `SFA Report` (16 visit rows), `Employee list` (5) — upload this |
| `EXPECTED_ADHERENCE.xlsx` | `Expected_Adherence`, `Expected_Summary`, `Expected_ByEmployee`, `Planned_C1_seed`, `Adherence_Defects` |

`Planned_C1_seed` is the C1 plan the expectations are computed against — **33 plan rows across 15 unique (employee, dealer) pairs, 3 SOs**. Seed `sales_plans` / `sales_plan_details` from it, or generate C1 for 2026-09 from the test kit and confirm your generator produces the same set before you compare adherence. Visit counts come from your own matrix (`Final Category × Grade → so_visits`), and the dates are the C1 working days for September 2026 with Sundays and the 2nd/4th Saturday removed.

## Expected

| Metric | Value |
|---|---|
| planned rows | 33 |
| unique (emp, dealer) pairs | 15 |
| completedCount | **9** |
| missedCount | **6** |
| `adherencePct` as the code computes it | **27%** (`9 / 33`) |
| dealer-level adherence (what it should be) | **60%** (`9 / 15`) |

Per SO: `11001774` 2 completed / 3 missed · `11001975` 2 / 1 · `11002168` 5 / 2.

## What each visit row is testing

| Dealer | Log | Expected | Point |
|---|---|---|---|
| R P ENTERPRISE | 03-Sep, planned date | COMPLETED | happy path |
| GARG ENTERPRISES | 11-Sep, not a planned date | COMPLETED | matching is dealer-level, the planned date is ignored |
| RADHA HARDWARE | 16-Sep | MISSED | C2 window, outside C1 |
| MAHESWARI CEMENT | 09-Sep, logged as `WBM273` | MISSED | **code-shape trap** — SFA code vs SAP code |
| MAA BHABANI | no visit | MISSED | plain miss |
| PUNAM TRADING | visited by `11001774` | MISSED for `11001975` | employee key must be part of the match |
| SAHA & CO. | 04-Sep, "Non Productive" | COMPLETED | `visit_status` is never read |
| SADHANA ENTERPRISE | 08-Sep, emp code `" 11001975 "`, name lowercased | COMPLETED | trim + upper-case works |
| MD EMRAN ALI KHAN | 02-Sep | COMPLETED | happy path |
| KARIM ENTERPRISE | 09-Sep | COMPLETED | happy path |
| MURARI MOHAN RETAIL | 15-Sep | COMPLETED | day 15 is inside the window |
| ANSARI ENTERPRISE | 01-Sep | COMPLETED | 1 visit against 3 planned rows — deflates the % |
| MAHAMMAD HARDWARE | 31-Aug | MISSED | before the window |
| MD SAHAJAHAN | 05-Sep **and** 12-Sep | COMPLETED once | must not double-count |
| ADIL HARDWARE | 07-Sep | ignored | Churn, 0 planned visits |
| ROY SUPPLIERS | 03-Sep | ignored | not on any plan |

## Seven defects this exercises

1. **SFA code vs SAP code.** The plan stores `dealer_sap_code`, the SFA log carries `customer_code` — which in your real exports is the SFA code. Any dealer logged that way reads as missed. Resolve both sides through `master_dealers` before comparing. (MAHESWARI)
2. **`adherencePct` mixes two denominators.** `completedDealers` is de-duplicated to one entry per (emp, dealer); `plannedVisits.length` is not. Any dealer with more than one C1 visit drags the percentage down — here 60% is reported as 27%.
3. **C1 window is hard-coded** to `-01` … `-15` in `analyseC1Adherence()`, while `loadRules()` reads `c1_start_day` / `c1_end_day` from `business_rules`. Re-configure the cycle and adherence silently keeps using 1–15.
4. **`visit_status` is selected but never used** — a non-productive visit counts as a completed one. Decide which you want and make it explicit.
5. **Planned date is effectively ignored.** `actualByEmpDealer.has(comboKey)` means any visit to that dealer in the window closes out every planned visit to it. If that is intentional, call it dealer-level adherence in the API, because it is not date adherence.
6. **`cycle_code IS NULL` is treated as C1**, so legacy or mis-tagged rows leak into C1 adherence. Backfill `cycle_code`, then tighten the predicate to `= 'C1'`.
7. **The importer wipes `visit_execution_logs` on every upload.** Adherence can only ever be measured against the most recent file. Scope the delete to the batch or period being replaced.

## One question, not a defect

`AutoPlanGenerator` sets `count = Math.round(freq)` and schedules that many visits **inside the chosen cycle**. So a dealer with `so_visits = 3` gets 3 visits in C1 and 3 more in C2 — 6 a month against a matrix value of 3. If the matrix is monthly, C1 and C2 should split it; if the matrix is per cycle, this is right and the column name is misleading. Worth settling before the plan volumes are signed off.
