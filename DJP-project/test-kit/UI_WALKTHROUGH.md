# Running the test kit through the admin panel

New screen: **Sales Planning → Officer Plans & Adherence**. Two tabs — *Officer Plans* (every role's generated plan, with drill-down) and *C1 Adherence* (read-only, changes nothing).

Before the first run:

```bash
node src/scripts/migrate-app-plan-workflow.js
npm start
npm run dev:frontend
```

---

## Part 1 — plans

**1. Upload the five inputs.** *Monthly Excel Ingestion*, one at a time, matching each file to its type:

| File | Upload as |
|---|---|
| `TEST_01_Dealer_Mapping.xlsx` | Dealer Mapping |
| `TEST_03_SBG_Master.xlsx` | SBG Master |
| `TEST_04_Sales_History_RSAR.xlsx` | Sales History (RSAR) |
| `TEST_02_Dealer_Performance.xlsx` | Dealer Performance |
| `TEST_05_Prospect_Dealers.xlsx` | Prospect Dealers |

Order matters for the first two: SBG only ever *updates* dealers that Dealer Mapping has already created, so a dealer loaded the other way round gets `sbg_potential = NULL` and no counter potential. Watch the batch list — each should land as VALIDATED, not FAILED.

**2. Set the period to 2026-09** in the header, then **Generate DJP**. It runs C1 and C2, then auto-generates plans for every SO, ASM, RSM and ZH and stamps each one with its L1 approver.

**3. Open Officer Plans & Adherence → Officer Plans.** Month `2026-09`, cycle `ALL`.

What you should see:

- **Roles covered: 4.** If it says 2, the RSM/ZH fix didn't take — `autoPlanGenerator.js` needs the `rsm_code` / `zh_code` change.
- Three SOs — 11001774, 11001975, 11002168 — plus their ASM, RSM and ZH.
- Every row has an **L1 Approver**. SO rows → DEBABRATA GHOSH (ASM). The ASM row → RITWICK CHATTERJEE (RSM). The RSM row → GIRIDHARI MUKHERJEE (ZH). The ZH row shows ADMIN.
- **Needs attention: 0.** Anything above zero is a red banner naming the problem — a plan with no approver (broken hierarchy) or no visits.
- All statuses DRAFT.

**4. Click any row** for the day-wise plan: visits grouped by date with the dealer's Final Category, grade and block, plus the approval trail. This is the same payload the field app renders, so what you see here is what the officer sees.

**5. Sanity checks worth doing.**

- Filter Role = `SO`, click 11001774's C1 plan. The Churn dealer **HARI OM TRADERS** must not appear anywhere — Churn is 0 visits at every grade. If it does, the visit matrix isn't being applied.
- No date should hold more than 8 visits, and no dealer twice on one day.
- A C1 plan must not contain a date after the 15th.

---

## Part 2 — adherence

**6. Upload `TEST_06_SFA_Report.xlsx`** on *Monthly Excel Ingestion* as the SFA Report / Feedback type. It has two sheets, `SFA Report` (15 visits) and `Employee list`; the importer needs those exact names.

Note: the importer runs `DELETE FROM visit_execution_logs` on every upload, so this replaces any earlier log entirely.

**7. Officer Plans & Adherence → C1 Adherence.** Month `2026-09`, then **Run C1 adherence**. Read-only — it will not touch your C2 plans.

### What the tiles must say

| Tile | Expected |
|---|---|
| Dealers on the C1 plan | **14** |
| Visited | **8** |
| Missed | **6** |
| Adherence (dealer level) | **57%** |
| Code mismatches | **1** |
| Unplanned visits | **3** |

Two banners should appear:

- **Amber** — the engine reports a lower percentage than 57%. It divides 8 de-duplicated completions by the raw planned-row count instead of by the 14 unique officer-dealer pairs. The exact number depends on how many rows your generator produced; the gap is the point, not the value.
- **Red** — one visit was logged as `WBM273` while the plan stores `1000001148`. MAHESWARI CEMENT was actually visited but counts as missed. Resolve the codes and adherence becomes **64%**.

### Per officer

| SO | Planned | Visited | Missed | % |
|---|---|---|---|---|
| 11001774 DEBABRATA CHAKRABORTY- FKT | 5 | 2 | 3 | 40% |
| 11001975 ARINDAM PAUL | 2 | 1 | 1 | 50% |
| 11002168 SUBHASISH KARMAKAR | 7 | 5 | 2 | 71% |

Click a row to expand the missed dealers — those are what C2 prioritises.

### What each visit is testing

| Dealer | Log | Expected | Point |
|---|---|---|---|
| R P ENTERPRISE | 03-Sep | visited | happy path |
| GARG ENTERPRISES | 11-Sep, not a planned date | visited | matching is dealer-level; the planned date is ignored |
| RADHA HARDWARE | 16-Sep | missed | C2 window |
| MAHESWARI CEMENT | 09-Sep as `WBM273` | missed | **code-shape trap** |
| MAA BHABANI | no visit | missed | plain miss |
| PUNAM TRADING | logged by 11001774 | missed for 11001975 | the employee is part of the key |
| SAHA & CO. | 04-Sep, "Non Productive", emp code `" 11001975 "` | visited | status is never read; padding and case are trimmed |
| MD EMRAN / KARIM | 02-Sep, 09-Sep | visited | happy path |
| MURARI MOHAN | 15-Sep | visited | day 15 is inside the window |
| ANSARI | 01-Sep | visited | 1 visit against 3 planned rows — this is what deflates the raw % |
| MD YOUSUF | no visit | missed | plain miss |
| MAHAMMAD | 31-Aug | missed | before the window |
| MD SAHAJAHAN | 05-Sep **and** 12-Sep | visited once | must not double-count |
| ADIL / ROY | 07-Sep, 03-Sep | ignored | Churn, never planned → unplanned visits |

**8. Then regenerate C2.** *Monthly Excel Ingestion → Regenerate C2*. The toast should report **6 missed C1 dealers prioritised**, and those dealers now sort to the front of each officer's C2 plan — check 11001774's C2 plan and MAA BHABANI, RADHA and MAHESWARI should lead it.

---

## One caveat

These numbers assume the classification engine is still unfixed. **SADHANA ENTERPRISE (1000001154)** currently classifies as Churn, so it gets 0 visits and never reaches a plan. Once you apply the DOA-tier fix it becomes Zero Lifter, joins the C1 plan, and is never visited in the log — so the figures shift to **15 planned, 6 visited… 9 missed, 53%**.

That is not a broken test. It is the same dealer that fails in `RUN_REVIEW_2026-09.xlsx`, showing up again from a different angle — which is a useful cross-check that both fixes landed.

Every other dealer in the kit is immune, because the SO visit matrix gives Growing, De-growing and Need to Grow the same frequency. Only Churn (0 visits) changes whether a dealer reaches a plan at all.
