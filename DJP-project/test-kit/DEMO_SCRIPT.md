# Star Cement PJP/DJP — Demo Script

A click-by-click run of the whole system, with the number to point at on each screen.
Budget **20–25 minutes**. Every figure below is what the end-to-end run actually
produced on the test-kit data, so if your screen shows something different, the data
differs — not the demo.

---

## Before the demo (do this once, not in front of the client)

```bash
# 1. Migrations — schema.sql alone is NOT enough (see Deploy notes at the end)
node src/scripts/migrate-schema.js
node src/scripts/migrate-add-sbg-columns.js
node src/scripts/migrate-phase2-calc-columns.js      # 10 columns the PJP engine writes
node src/scripts/migrate-app-plan-workflow.js        # the app workflow columns
node src/scripts/migrate-c2-review.js                # the C2 Review history tables

# 2. Seed the rules
node src/scripts/init-db.js

# 3. Start
npm run dev          # API on :5000
cd frontend && npm run dev
```

**Check before you present:** Admin → Business Rules shows `daily_visit_capacity = 8`.
If that page is empty, `init-db` did not run and Step 3 will fail in front of the client.

Have `test-kit/` open in a second window. Keep `EXPECTED_RESULTS.xlsx` closed but ready.

---

## The story to tell (30 seconds, before touching anything)

> Every month Star Cement has to decide which of thousands of dealers each officer
> visits, on which day. Today that is a spreadsheet. This does it from the source
> files, routes each plan to the right approver, and then — on the 15th, when the SFA
> team reports what actually happened — it rebuilds the second half of the month so
> the dealers that were missed get seen first.

That last sentence is the one that matters. The rest is plumbing.

---

## Step 1 — Upload (3 min)

**Admin panel → Uploads**

Upload in this order. Order matters: Dealer Mapping establishes the dealers and the
hierarchy that everything else attaches to.

| # | File | What it is | Rows |
|---|---|---|---|
| 1 | `TEST_01_Dealer_Mapping.xlsx` | dealers + the full SO→ASM→RSM→ZH hierarchy | 18 |
| 2 | `TEST_03_SBG_Master.xlsx` | authoritative potential and block | 18 |
| 3 | `TEST_02_Dealer_Performance.xlsx` | monthly sales and targets | 18 |
| 4 | `TEST_04_Sales_History_RSAR.xlsx` | sub-dealer sales history | 20 |
| 5 | `TEST_05_Prospect_Dealers.xlsx` | prospective dealers, not yet trading | 15 |

**Point at:** each upload's row count matching the file. If Dealer Mapping reports
fewer than 18, stop — everything downstream inherits that.

**Worth saying:** "Dealer Performance and RSAR are two different sales sources for the
same dealers. They are deliberately kept in separate tables — the engine reads them
independently, so one can never quietly overwrite the other."

---

## Step 2 — Generate the plan (4 min)

**DJP → Generate Plans**

1. Click **Generate Plans**.
2. **Pick the month.** It defaults to the latest sales month + 1 — so uploading June
   data gives you July, not today's month. *Say this out loud; it was a real bug and
   it is the kind of detail a client tests.*
3. Choose **C1 + C2**.
4. Run.

Takes a few seconds on this data. On the full client file it is minutes — the
generator was O(N³) and is now O(N log N), so a 1,380-dealer area went from 20 seconds
to well under one.

**What you get (C1):**

| | |
|---|---|
| Dealer targets | **33** (18 dealers + 15 prospects) |
| Visits required | **157** |
| Day-slots allocated | **85** |
| Unallocated (over capacity) | **0** |

**Open the dealer table and point at the Final Category column** — this is column U of
the client's own master, reproduced:

| Final Category | Count |
|---|---|
| Prospective | 15 |
| De-growing | 6 |
| Growing | 5 |
| Churn | 4 |
| Zero Lifter | 2 |
| Need to Grow | 1 |

**The line to use:** "This column is the client's own `IFS` formula, reverse-engineered
from their master file. On their real data it matches 12,656 rows out of 12,658 —
the two misses have a blank date of appointment, so no formula could classify them."

**Then point at the grade column:** A 16, B 1, C 6, D 10.

---

## Step 3 — Officer plans, generated in the same run (4 min)

Scroll down on the same screen — **no second button**. This is the point: plans for
every role come out of the same run as the DJP.

| Role | Officers | Plans | Visits |
|---|---|---|---|
| SO | 16 | 16 | 52 |
| ASM | 2 | 2 | 17 |
| RSM | 2 | 2 | 8 |
| ZH | 1 | 1 | 4 |
| | | **21** | **81** |

**Point at the RSM and ZH rows.** "These used to come out empty — the code matched on
name where it should have matched on employee code, so two entire management layers
got no plan at all."

**Then the name column.** Every plan shows `DEBABRATA CHAKRABORTY- FKT`, not `11001774`.
"Some plans used to show the bare employee ID. The importer was only creating employee
records for SOs and ASMs, so RSMs and ZHs had no name to look up."

**Open any SO plan → the approver line.**

```
SO  11001774  DEBABRATA CHAKRABORTY- FKT   →  L1  ASM  DEBABRATA GHOSH
ASM 11001393  DEBABRATA GHOSH              →  L1  RSM  RITWICK CHATTERJEE
RSM 11001813  RITWICK CHATTERJEE           →  L1  ZH   GIRIDHARI MUKHERJEE
```

"The hierarchy is read from the Dealer/SO Mapping file — the client's own source of
truth — not from anything configured in the app."

> **If someone notices the 13 SOs with no approver:** be straight about it. Those
> officers appear only in the Prospect file, which carries an SO name and code but no
> ASM, RSM or ZH. They have no hierarchy anywhere in the inputs, so nothing can route
> their plan. The system logs a warning naming each one rather than inventing a
> manager. **This is a real open item** — see the findings note.

---

## Step 4 — The approval workflow (4 min)

Use **SO 11001774**, whose plan has 11 visits.

| Do this | Screen shows | Say this |
|---|---|---|
| Open his plan | 11 visits, status **DRAFT** | "He can still edit." |
| Add a visit | 12 visits | |
| Try the same dealer on the same day again | *refused* | "A dealer can't be booked twice in one day." |
| **Submit** | **SUBMITTED** | |
| Try to edit | *refused* | "Once it's with his manager, it's locked." |
| Open **ASM 11001393**'s inbox | his plan is there | "Only his manager sees it." |
| **Send back for rectification**, remark "Add the two missed counters" | **RECTIFY** · *1 of 1 used* | |
| Back as the SO — edit, **resubmit** | **SUBMITTED** | |
| As the ASM, try **Rectify again** | *refused* — "already sent back once; the only remaining action is Approve" | **This is the rule they asked for.** Land on it. |
| **Approve** | **APPROVED** | |

**Finish on the audit trail:** `SUBMITTED → RECTIFY → RESUBMITTED → APPROVED`, each
entry stamped with who did it and when.

---

## Step 5 — The 15th of the month (3 min)

**Uploads → SFA Report** → `TEST_06_SFA_Report.xlsx` (19 visit rows, 4 officers).

> "On the 15th the SFA team sends what actually happened in the first half. This is
> that file."

**Officer Plans → Adherence tab.** Month `2026-09`, cycle **C1**, as-on **2026-09-15**.

| | |
|---|---|
| Planned visits | **81** |
| MTD due (prorata to the 15th) | **81.0** |
| Adhered | **14** (capped 13) |
| Pending | **67.0** |
| **Adherence** | **16.0% capped** · 17.3% raw |
| Dealers on plan / visited / missed | 51 / 10 / **41** |

Per role:

| Role | Planned | Adhered | Pending | % |
|---|---|---|---|---|
| SO | 52 | 12 | 40.0 | 21.2% |
| ASM | 17 | 2 | 15.0 | 11.8% |
| RSM | 8 | 0 | 8.0 | 0.0% |
| ZH | 4 | 0 | 4.0 | 0.0% |

**Four things to say, in this order:**

1. **"MTD due, not the whole cycle."** Due = planned × the elapsed fraction of the
   cycle. On the 15th C1 is complete so the fraction is 1; on the 8th it is 8/15.
   Nobody is measured against work that isn't owed yet.
2. **"Capped and uncapped both."** An officer who visits a dealer three times when one
   was planned gets credit for one against the plan, and the raw count is kept beside it.
3. **"Every role, not just SOs."** ASM, RSM and ZH are all measured.
4. **"Pending can go negative."** That means someone is ahead — the report says so
   rather than clipping it to zero.

*Deliberately low numbers here.* The test SFA file covers 4 officers out of 21, so
adherence is meant to look poor — it makes Step 6 visible.

---

## Step 6 — The payoff: regenerate C2 (4 min)

**Officer Plans → C2 Review tab → Regenerate C2.**

> "Adherence was 16%. 41 dealer visits were missed. Watch what happens to the second
> half of the month."

**The six tiles:**

| Tile | Value |
|---|---|
| Dealers on the new C2 | 29 · 50 officer visits |
| Added / Dropped | 0 / 0 |
| Moved earlier | **7** (10 moved later) |
| **Missed in C1, now covered** | **28 of 28** |
| Unchanged | 33 |

**Land on "28 of 28."** Every dealer missed in the first half is on the second-half
plan. Not one was dropped.

**Then the change table** — filter to **Moved earlier**:

```
GARG ENTERPRISES           was 23 Sep   →  now 18 Sep   [missed in C1]
PUNAM TRADING              was 18,19    →  now 16,17    [missed in C1]
MD YOUSUF ALI ENTERPRISE   was 23,24    →  now 16,17    [missed in C1]
ANSARI ENTERPRISE          was 25,28,29 →  now 16,17,30 [missed in C1]
```

> "Missed dealers moved to the front of the cycle. The first working day of C2 is the
> 16th, and that is where they went."

**The two points worth making about the screen itself:**

- **"Nothing was added or dropped — 7 moved earlier."** Regenerating deletes the old
  C2 outright, so the system snapshots the plan on both sides and shows the difference.
  Without that you would see the new schedule and have no way to know what changed.
- **A reorder is shown as one MOVED row, not an add plus a drop.** A naive comparison
  would report these 17 moves as 17 adds and 17 drops and bury the real changes.

**Last thing:** switch to the **Officer Plans** tab, filter **C1**. The approved plan
from Step 4 is untouched.

> "C1 is the record adherence was measured against. Regenerating it would destroy that
> record, so the system never touches it."

---

## If something goes wrong mid-demo

| Symptom | Cause | Say |
|---|---|---|
| "…is not valid JSON" on Generate | the request outran the 30-min timeout | "That's a timeout, not a data problem" — click Generate again |
| Generate produces the wrong month | month picker left on its default | reopen the modal and set the month |
| C2 Review says "history is not set up yet" | `migrate-c2-review.js` not run | skip to Officer Plans filtered to C2 — the plans are correct, only the diff is missing |
| Plans show an ID instead of a name | employees imported before the importer fix | `node src/scripts/backfill-employee-names.js --apply` |
| RSM/ZH sections empty | pre-fix data still in the database | regenerate |

---

## Verification, if they ask how you know it works

```bash
node test/e2e/prepare-e2e.mjs && node test/e2e/e2e.test.mjs
```

Runs all eight stages on this exact data against the real engines — only the database
driver is substituted. **54 checks, 0 failures.** Four supporting suites add 134 more.

---

## Deploy notes — read before installing anywhere new

1. **`schema.sql` is not sufficient on its own.** The PJP engine writes 10 columns to
   `dealer_visit_targets` that `schema.sql` does not declare (`counter_share`,
   `need_to_grow`, `area_potential*`, `area_volume*`, `potential_rank`, `doa`). They
   come from `migrate-phase2-calc-columns.js`. Skip it and the **first Run DJP fails**
   with `no column named counter_share`. The end-to-end run hit exactly this.
2. **`generation_runs` has no migration at all.** Three endpoints insert into it and no
   file creates it. On this project's existing database it exists from earlier manual
   work; a fresh deploy has to create it by hand.
3. **`approval_matrix`** comes from `models/migration_approval_matrix.sql`. Without it
   the service falls back to defaults and logs on every plan — harmless, noisy.
