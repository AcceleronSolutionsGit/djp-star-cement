# Star Cement PJP/DJP — Demo Guide (Kit v2)

Every number below is what the engine actually produced on these files. If your screen
differs, the data differs — not the demo.

Budget **20–25 minutes**.

---

## What changed since the last kit

The v1 kit had RSAR and Dealer Performance numerically identical, so it could not show
which one the engine read. **This kit makes them diverge on purpose.**

> **Dealer Performance (DLRWISE)** — the *dealer's own* sales. Classifies the dealer.
> **RSAR** — the *sub-dealers* beneath it. Reported, never classifies.

Eleven of the eighteen dealers now classify differently depending on which source is
used. Four of those are built to be read aloud in a demo.

---

## Before the demo (once, not in front of the client)

```bash
node src/scripts/migrate-schema.js
node src/scripts/migrate-add-sbg-columns.js
node src/scripts/migrate-phase2-calc-columns.js    # 10 columns schema.sql omits
node src/scripts/migrate-app-plan-workflow.js
node src/scripts/migrate-c2-review.js
node src/scripts/init-db.js                        # business rules
npm run dev  &&  cd frontend && npm run dev
```

**Check:** Admin → Business Rules shows `daily_visit_capacity = 8`. If that page is
empty, `init-db` did not run and Step 2 will fail live.

---

## Step 1 — Upload (4 min)

Order matters. Dealer Mapping establishes the dealers and hierarchy everything else
attaches to; Dealer Performance goes after it so its DOA is the one that survives.

| # | File | Rows | Establishes |
|---|---|---|---|
| 1 | `TEST_01_Dealer_Mapping.xlsx` | 18 | dealers + SO → ASM → RSM → ZH hierarchy |
| 2 | `TEST_03_SBG_Master.xlsx` | 18 | counter potential, block |
| 3 | `TEST_02_Dealer_Performance.xlsx` | 18 | **the dealer's own sales** |
| 4 | `TEST_04_Sales_History_RSAR.xlsx` | 12 | **sub-dealer sales**, for 6 dealers only |
| 5 | `TEST_05_Prospect_Dealers.xlsx` | 6 | prospects, not yet trading |

**The line to use on file 4:**

> "Twelve rows for six dealers — two sub-dealers each. The other twelve dealers have no
> sub-dealers at all. That's deliberate, and you'll see why in a moment."

---

## Step 2 — Generate, and read the Final Category column (6 min)

**DJP → Generate Plans** → pick **2026-07** → **C1 + C2** → Run.

| | |
|---|---|
| Dealer targets | **24** (18 dealers + 6 prospects) |
| Day-slots allocated | **96** |
| Unallocated | **0** |

| Final Category | Count |
|---|---|
| Need to Grow | 6 |
| Prospective | 6 |
| Growing | 5 |
| Churn | 3 |
| Zero Lifter | 2 |
| De-growing | 2 |

### Now the four dealers worth stopping on

Open the dealer table and find these. This is the heart of the demo.

**1. SUNRISE TRADERS — `1000002101`**

> Its two sub-dealers sold 900 MT last month. The dealer itself sold **nothing** — and
> has sold nothing for six months. The system calls it **Churn** and plans no visits.
>
> If we judged it on its sub-dealers, it would read *Growing* and keep its visits. A
> dealer that has stopped buying would look healthy because the shops beneath it are
> still busy.

**2. PIONEER CEMENT STORE — `1000002102`**

> The opposite. No sub-dealers at all — nothing in the RSAR file. Its own sales are
> climbing: 900 → 1,200. The system calls it **Growing**.
>
> Judged on RSAR it would find no rows, read zero, and call it **Churn** — and a
> healthy dealer would lose every visit in the cycle.

**3. NORTHGATE SUPPLIERS — `1000002103`**

> Own sales sliding, 1,400 → 1,100, against 1,500 the same month last year.
> Sub-dealers climbing hard, 100 → 900. The system calls it **Need to Grow** — big
> potential in its area, low share.
>
> On RSAR the rising sub-dealer trend would mask the dealer's own decline.

**4. EASTERN BUILD MART — `1000002104`**

> A modest dealer with very large sub-dealers. Counter share on its own sales is
> **13.9%**. On sub-dealer sales it would be **30.8%** — above the 20% threshold, which
> would switch the need-to-grow flag off and quietly change how often it gets visited.

Then close the point:

> "Same eighteen dealers, same files. Which source you classify on changes the answer
> for eleven of them."

### The DOA tiers — worth 60 seconds

**NEWLEAF HARDWARE — `1000002105`**, appointed **20 June**, eleven days before the
planning month. Zero sales, because it just opened.

> "It's classified **Growing**, and it gets visits. Under the client's own rule a dealer
> appointed within fifteen days is Growing whatever its sales say. Before we implemented
> that, this dealer was **Churn** — final volume zero, and zero visits from every role.
> The newest dealer on the list got no attention at all."

Also in the sheet: `RIVERSIDE CEMENT` (120 days old, zero sales → **Zero Lifter**, not
Churn — the New tier has no Churn branch) and `DURGA CEMENT DEPOT` (blank DOA → falls
into the Old tier, exactly as Excel does).

---

## Step 3 — Officer plans, same run (3 min)

Scroll down. No second button — plans for every role come out of the same run.

Point at three things:

- **All four roles have plans.** RSM and ZH used to come out empty — the code matched on
  name where it should have matched on employee code.
- **Names, not IDs.** Every plan shows `DEBABRATA CHAKRABORTY- FKT`, not `11001774`.
- **The approver chain** — SO → ASM → RSM → ZH, read from the Dealer/SO Mapping file,
  not configured in the app.

---

## Step 4 — Approval workflow (4 min)

Use **SO 11001774**.

| Do | Screen | Say |
|---|---|---|
| Open the plan | DRAFT | "He can still edit." |
| Add a visit | count rises | |
| Same dealer, same day again | refused | "Can't book a dealer twice in one day." |
| **Submit** | SUBMITTED | |
| Try to edit | refused | "It's with his manager now." |
| Open ASM 11001393's inbox | his plan is there | "Only his manager sees it." |
| **Send back**, remark "Add the two missed counters" | RECTIFY · 1 of 1 used | |
| Edit, **resubmit** | SUBMITTED | |
| Try **Rectify** again | **refused — 409** | **The rule they asked for. Land on it.** |
| **Approve** | APPROVED | |

Finish on the audit trail: `SUBMITTED → RECTIFY → RESUBMITTED → APPROVED`.

---

## Step 5 — The 15th (3 min)

Upload `TEST_06_SFA_Report.xlsx` — 9 visits, 2 officers reporting.

**Officer Plans → Adherence**, month `2026-07`, cycle **C1**, as-on **2026-07-15**.

Four things to say:

1. **MTD due, not the whole cycle.** Due = planned × elapsed fraction. On the 15th C1 is
   complete, so the fraction is 1; on the 8th it is 8/15. Nobody is measured against work
   that isn't owed yet.
2. **Capped and uncapped.** `HERITAGE CEMENT AGENCY` was visited twice (3rd and 6th) when
   once was planned — one counts against the plan, both are kept in the raw count.
3. **Every role**, not just SOs.
4. **Pending can go negative** — that means ahead of plan, and the report says so.

Only 2 of the officers reported, so adherence is meant to look poor. That's what makes
the next step visible.

---

## Step 6 — Regenerate C2 (4 min)

**Officer Plans → C2 Review → Regenerate C2.**

> "Adherence was low and a set of dealers were missed. Watch the second half of the month."

Six tiles. Land on **"Missed in C1, now covered"** — every missed dealer is on the new C2.

Filter the change table to **Moved earlier** and read a row out:

```
dealer   was 23 Jul  →  now 17 Jul   [missed in C1]
```

Two points about the screen:

- **Nothing added, nothing dropped — visits moved.** Regenerating deletes the old C2
  outright, so the system snapshots both sides and shows the difference. Without that
  you'd see the new schedule and have no way to know what changed.
- **A reorder shows as one MOVED row**, not an add plus a drop — otherwise the real
  changes drown in noise.

Then switch to **Officer Plans**, filter **C1**. The approved plan from Step 4 is
untouched.

> "C1 is the record adherence was measured against. Regenerating it would destroy that
> record, so the system never touches it."

---

## If something goes wrong

| Symptom | Cause | Do |
|---|---|---|
| "…is not valid JSON" | request outran the timeout | click Generate again |
| Wrong month generated | month picker left on default | reopen the modal, set 2026-07 |
| "C2 regeneration history is not set up" | `migrate-c2-review.js` not run | skip to Officer Plans filtered to C2 |
| ID shown instead of a name | employees imported before the fix | `node src/scripts/backfill-employee-names.js --apply` |
| `no column named counter_share` | `migrate-phase2-calc-columns.js` not run | run it, regenerate |

---

## Verifying it yourself

```bash
node test/e2e/prepare-e2e.mjs
node test/e2e/kit-v2.test.mjs      # 21 checks — proves the source separation
node test/e2e/category.test.mjs    # 13 checks — all rows vs the client master
node test/e2e/e2e.test.mjs         # 54 checks — all eight stages
```

`kit-v2.test.mjs` computes every expected category from the client's formula
independently, using Dealer Performance only, then runs the real engine and compares.
It also computes what the *same* formula would give on RSAR — so if anyone ever points
classification back at sub-dealer sales, the test names the dealers that flipped.

**Full suite: 222 assertions, 0 failures.**

---

## Still open

- **`generation_runs` has no migration.** Three endpoints insert into it, no file creates
  it. A fresh deploy fails on the first Run DJP.
- **DOA source is decided by upload order.** Three importers write it; last one wins.
  Dealer Performance currently wins only because it's uploaded third. Fix agreed: flip
  `COALESCE(?, doa)` to `COALESCE(doa, ?)` in the Dealer Mapping and SBG importers.
- **Prospect-only officers get un-approvable plans.** The Prospect template carries an SO
  name and code but no ASM/RSM/ZH, so those officers have no hierarchy and their plans
  reach nobody's inbox.
