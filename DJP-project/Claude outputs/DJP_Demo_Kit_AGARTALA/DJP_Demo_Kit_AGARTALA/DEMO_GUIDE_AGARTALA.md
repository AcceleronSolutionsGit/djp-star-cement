# Demo Kit — AGARTALA, built from the client's own data

Centred on the three dealers you named. Planning month **2026-06**, which is the anchor
M.xlsx itself uses (`B2 = 46174 = 2026-06-01`), so every expected value can be read
straight off the client master.

| SAP | Dealer | Expected | Grade | Why |
|---|---|---|---|---|
| **1000000013** | BANKA BEHARI PAUL | **De-growing** | C | O 140 **<** Q 164.25 |
| **1000000021** | AJOY BHATTACHARJEE | **Growing** | D | O 50 **≥** Q 5 |
| **1000000022** | ANJAN DEBNATH | **Growing** | A | O 2005.85 **≥** Q 1811.5 |

All three are in AGARTALA, zone NE2, under **BIKRAM KUMAR HALDER** (ASM) →
**GHALIB FAHAD AYUBI** (RSM) → **BRIJESH SINGH** (ZH). All three are Old-tier dealers
(DOA 2012–2013), so the rule compares this month's sales against the same month last
year.

**56 of the 58 AGARTALA dealers classify exactly as M.xlsx does.** The two that differ
do so for one specific, explainable reason — see *The one disagreement* below.

---

## What's in the kit

| File | Sheet | Rows | Contents |
|---|---|---|---|
| `TEST_01_Dealer_Mapping.xlsx` | Dealer SO Mapping | 58 | every AGARTALA dealer + hierarchy |
| `TEST_02_Dealer_Performance.xlsx` | DLRWISE | 58 | each dealer's **own** monthly sales |
| `TEST_03_SBG_Master.xlsx` | SBG | 58 | counter potential and block |
| `TEST_04_Sales_History_RSAR.xlsx` | RSAR | 327 | **sub-dealers**, linked to their parents |
| `TEST_05_Prospect_Dealers.xlsx` | Prospect | 3 | prospective dealers |
| `TEST_06_SFA_Report.xlsx` | SFA Report | 9 | the 15th-of-month feedback |
| `EXPECTED_RESULTS_AGARTALA.xlsx` | 5 sheets | — | expected vs engine, per dealer |

The three named dealers are **highlighted in amber** in every file.

### Real vs synthesised

**Real, from the client files:** SAP and SFA codes, dealer names, zone, area, block,
ZH / RSM / ASM, counter potential, DOA, and the O / R / Q / S sales figures — all taken
from M.xlsx. The 327 sub-dealer rows and their parent links come from
`RSAR SALE- NE-APRIL-24 TO JUNE-26`, including the rows you pasted.

**Synthesised:** the SO layer — M.xlsx leaves column I blank for all 387 AGARTALA rows,
and the approval workflow needs someone to submit a plan, so four SOs are assigned by
block. The monthly Dealer Performance series is built to reproduce O, R and S exactly
(57 of 58 exactly; one dealer's S cannot be the mean of a non-negative series, so O and
R are kept exact there instead). Prospects and the SFA log are invented.

---

## Running the demo

**Upload in this order.** Dealer Mapping establishes the dealers; Dealer Performance
goes after it so its DOA wins.

1. `TEST_01_Dealer_Mapping.xlsx`
2. `TEST_03_SBG_Master.xlsx`
3. `TEST_02_Dealer_Performance.xlsx`
4. `TEST_04_Sales_History_RSAR.xlsx`
5. `TEST_05_Prospect_Dealers.xlsx`

Then **Generate Plans** → month **2026-06** → **C1 + C2**.

| | |
|---|---|
| Dealer targets | **61** (58 dealers + 3 prospects) |
| Visits required | **180.5** |
| Day-slots allocated | **204** |
| Unallocated | **0** |
| Officer plans | **7** — 4 SO, 1 ASM, 1 RSM, 1 ZH |

### The moment to stop on

Open the Master Sheet and find **ANJAN DEBNATH (1000000022)**.

> "He has **59 sub-dealers** beneath him. Between them they sold 1,972 MT last month.
> He himself sold 2,005.85 — and it's his own figure the system classifies him on.
> The sub-dealer total is recorded next to it, but it never decides his category.
>
> That matters because the two numbers are close here. On a dealer with strong
> sub-dealers and weak sales of his own, judging him on the roll-up would show a healthy
> counter that had actually stopped buying."

Then **BANKA BEHARI PAUL (1000000013)** — the one that comes out De-growing:

> "140 MT last month against 164.25 the same month last year. He's been trading since
> 2012, so the rule compares him year-on-year rather than month-on-month. That's the
> client's own formula, and it's what their master says for this dealer."

---

## The 15th

Upload `TEST_06_SFA_Report.xlsx` — 9 visits.

- **ANJAN DEBNATH is visited twice** (3rd and 9th) → capped adherence counts one,
  uncapped counts both.
- **AJOY BHATTACHARJEE is not visited at all** → he lands in the missed set.

**Adherence** (month 2026-06, cycle C1, as-on 2026-06-15): 104 dealers on plan,
8 visited, 96 missed, **5.1%**. Low on purpose — 9 visits against a full-area plan.

Then **Regenerate C2**. AJOY BHATTACHARJEE appears in the missed set and moves to the
front of the second cycle. C1 is left untouched.

---

## The one disagreement — worth raising with the client

AGARTALA in M.xlsx has **387 rows: 58 dealers and 329 RSAR sub-dealers.** In the client
master the sub-dealers are counters in their own right, each with its own potential, and
Area Potential sums all 387:

```
  M.xlsx Area Potential ....... 54,835.54    (58 dealers + 329 sub-dealers)
  Engine Area Potential ....... 30,546.04    (58 dealers + 3 prospects)
```

Our pipeline treats RSAR as sub-dealer **sales** attached to a parent — which is the
correct reading of *"RSAR is for sub dealers, Dealer Performance is for dealers"* — so
sub-dealers never become rows and never contribute potential.

**What it costs:**

- **Final Category — 56 of 58 match.** The two that differ are `MADAN GOPAL TRADERS` and
  `PARTHA DAS - AGT`. Both are *Need to Grow* in M.xlsx. Need-to-grow fires when area
  potential percentile > 60% **and** counter share < 20%. Both clear the share test; both
  clear the percentile test **only** when sub-dealers are counted:

  | Dealer | Percentile with sub-dealers | without |
  |---|---|---|
  | MADAN GOPAL TRADERS | 70.5% | 45.6% |
  | PARTHA DAS - AGT | 66.8% | 42.1% |

- **Grade — 27 of 58 differ**, for the same reason: grade is a percentile of area volume.
- **Everything else is identical.** No dealer differs on a growth comparison — O, R, Q
  and S all agree.

**The question:** should a sub-dealer count as a counter when ranking an area?

If **yes**, sub-dealers need to become dealer rows and area potential roughly doubles
here — grades and need-to-grow then reproduce M.xlsx exactly. If **no**, current
behaviour is right and the master over-counts, because a sub-dealer buying through its
parent isn't an independent counter.

Worth settling before grades reach the field, since it changes how often a dealer gets
visited.

---

## Verifying

```bash
node test/e2e/prepare-e2e.mjs && node test/e2e/agartala.test.mjs
```

16 checks — the three named dealers against M.xlsx, all 58 against column U, the
area-model delta with its single cause pinned down, sub-dealer separation, the approval
chain, and the C2 rebuild. Rebuild the files with
`node test/e2e/build-kit-agartala.mjs`.
