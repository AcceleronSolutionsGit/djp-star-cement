# A / B / C / D Grade Calculation — Star Cement PJP Engine

> **File:** [`area-grade.engine.js`](file:///d:/OFFICE/DJP-project/DJP-project/src/engines/pjp/area-grade.engine.js)  
> Grades are the **end result of a 10-stage pipeline**. The grade (A/B/C/D) is **not computed from raw sales directly** — it comes from a **Pareto percentile of Final Volume within each Area**.

---

## The Full Pipeline (10 Stages)

```
Stage 1  → Load Dealers + Sales Data
Stage 2  → RSAR Sales Aggregation + Counter Share
Stage 3  → Area Potential Rank & Percentile
Stage 4  → Need to Grow?
Stage 5  → Final Category  (the 6-category decision tree)
Stage 6  → Final Volume    (category-specific formula)
Stage 7  → Area Volume + Rank + Percentile → GRADE (A/B/C/D)
Stage 8  → Priority Score  (Score A + B + C = 100)
Stage 9  → Visit Frequencies (Category × Grade → SO/ASM/RSM/ZH visits)
Stage 10 → Validation + Persist
```

---

## Stage 5 — Final Category (Decision Tree)

Before grading, every dealer must be classified into one of **6 Final Categories**.

### Classification Logic

```
Dealer Record
│
├── Is dealerType = PROSPECTIVE?
│       YES → Category: "Prospective"
│
├── Is status = CHURN or INACTIVE?
│       YES → Category: "Churn"
│
├── Is Current Month Sales (CM) = 0?
│   ├── AND Previous Month (PM) = 0 AND 6-Month Avg = 0?
│   │       YES → Category: "Churn"
│   └── PM > 0 OR 6M Avg > 0?
│               YES → Category: "Zero Lifter"
│
└── CM > 0 → Compare CM vs PM
    ├── CM > PM  → "Growing"
    ├── CM = PM  → "Need to Grow"
    └── CM < PM  → "De-growing"
```

### Variables

| Variable | Source | Description |
|---|---|---|
| `CM` (currentSales) | RSAR data | Current month's sales value |
| `PM` (previousMonthSales) | RSAR data | Previous month's sales |
| `6M Avg` (sixMonthAverage) | RSAR 6-month average | Average of last 6 months |
| `dealerType` | Dealer Mapping | `PROSPECTIVE` or `DEALER` |
| `status` | Master Dealers | `ACTIVE`, `CHURN`, `INACTIVE` |

### Category Descriptions

| Final Category | Condition |
|---|---|
| **Prospective** | Dealer type is PROSPECTIVE |
| **Churn** | CM=0, PM=0, 6M=0 (or status=CHURN/INACTIVE) |
| **Zero Lifter** | CM=0, but PM or 6M avg shows past activity |
| **Growing** | CM > PM |
| **Need to Grow** | CM = PM (and CM > 0) |
| **De-growing** | CM < PM (and CM > 0) |

---

## Stage 6 — Final Volume

Each Final Category has its own **Final Volume formula**.

| Final Category | Final Volume Formula |
|---|---|
| **Growing** | = Current Month Sales (CM) |
| **De-growing** | = Current Month Sales (CM) |
| **Need to Grow** | = Current Month Sales (CM) |
| **Zero Lifter** | = RSAR 6-Month Average |
| **Prospective** | = SBG Counter Potential × **0.4** |
| **Churn** | = **0** (always zero, excluded from visits) |

> **Note:** Prospective Final Volume uses SBG potential × 40%. If SBG potential is NULL, Final Volume = 0.

---

## Stage 7 — A / B / C / D Grade Assignment

This is the core of the A/B/C/D question.

### Step 1 — Compute Area Volume

```
Area Volume = SUM of Final Volume of ALL dealers in the same Area
```

All dealers sharing the same `area` (from Dealer Mapping) are grouped together.

### Step 2 — Rank Dealers by Final Volume (within Area)

Dealers are sorted **descending** by Final Volume within their area.  
Rank 1 = highest Final Volume dealer in that area.

```
Rank = (count of dealers with Final Volume strictly GREATER than this dealer) + 1
```

Ties share the same rank.

### Step 3 — Area Volume Percentile (Pareto/Cumulative)

```
Area Volume Percentile = SUM(Final Volume of dealers with rank ≥ this dealer's rank) / Area Volume
```

This is a **cumulative suffix-sum approach** — it tells you "what fraction of the area's total volume is captured by this dealer and everyone ranked at or below them".

**Example:**
```
Area = "Patna North"
Dealers by Final Volume: [500, 300, 200, 100, 50]   → Area Volume = 1150

Rank 1 (500): Percentile = (500+300+200+100+50)/1150 = 1150/1150 = 100%
Rank 2 (300): Percentile = (300+200+100+50)/1150     =  650/1150 = 56.5%
Rank 3 (200): Percentile = (200+100+50)/1150          =  350/1150 = 30.4%
Rank 4 (100): Percentile = (100+50)/1150              =  150/1150 = 13.0%
Rank 5 (50):  Percentile = (50)/1150                  =   50/1150 =  4.3%
```

### Step 4 — Assign Grade from Percentile Thresholds

| Condition | Grade |
|---|---|
| Percentile **> 60%** | **A** |
| Percentile **> 40%** (and ≤ 60%) | **B** |
| Percentile **≥ 20%** (and ≤ 40%) | **C** |
| Percentile **< 20%** | **D** |
| Final Category = `Churn` | Always **D** (regardless of percentile) |

> **Thresholds are configurable** via business rules:  
> `cat_a_min` (default: 60), `cat_b_min` (default: 40), `cat_c_min` (default: 20)

**Applying to Example above:**

| Dealer | Final Vol | Rank | Percentile | Grade |
|---|---|---|---|---|
| Dealer 1 | 500 | 1 | 100% | **A** |
| Dealer 2 | 300 | 2 | 56.5% | **B** |
| Dealer 3 | 200 | 3 | 30.4% | **C** |
| Dealer 4 | 100 | 4 | 13.0% | **D** |
| Dealer 5 | 50  | 5 | 4.3%  | **D** |

---

## Stage 8 — Priority Score (Score A + B + C)

The **Priority Score** is **independent of Grade**. It ranks dealers within each SO's territory.  
Max possible score = 100.

### Score A — Counter Potential Rank (out of 40)

```
Potential Rank = (count of dealers in same SO group with potential LESS than this dealer) + 1
Max Rank       = highest rank in the SO group

Score A = (Potential Rank / Max Rank) × 40
```

> Source: `sbg_potential` (SBG Market Mapping Counter Potential)

**Example (SO group has 4 dealers):**
```
Potentials: [1000, 800, 600, 400]
Ranks:       [1,    2,   3,   4 ]  (1 = lowest potential, 4 = highest)
Max Rank = 4

Dealer with potential 1000 → Rank 4 → Score A = (4/4) × 40 = 40
Dealer with potential 800  → Rank 3 → Score A = (3/4) × 40 = 30
Dealer with potential 600  → Rank 2 → Score A = (2/4) × 40 = 20
Dealer with potential 400  → Rank 1 → Score A = (1/4) × 40 = 10
```

### Score B — Category Score (out of 40)

Fixed score per Final Category:

| Final Category | Score B |
|---|---|
| **Zero Lifter** | **40** |
| **Prospective** | 30 |
| **Need to Grow** | 25 |
| **De-growing** | 20 |
| **Growing** | 10 |
| **Churn** | 0 |

> Score B is configurable via `business_rules.score_b` (default: 31 for unlisted categories).

### Score C — Current Sales Rank (out of 20)

```
higherSalesCount = count of dealers in same SO group with currentSales > this dealer
Score C = ((higherSalesCount + 1) / total dealers in SO group) × 20
```

**Inverted logic:** the dealer with the LOWEST sales gets Score C closest to 20 (because more dealers have higher sales than them).

**Example (SO group, 4 dealers, sales: 500, 300, 200, 100):**
```
Sales 500 → higherCount=0 → C = (0+1)/4 × 20 = 5
Sales 300 → higherCount=1 → C = (1+1)/4 × 20 = 10
Sales 200 → higherCount=2 → C = (2+1)/4 × 20 = 15
Sales 100 → higherCount=3 → C = (3+1)/4 × 20 = 20
```

### Total Score & Priority Rank

```
Total Score = Score A + Score B + Score C   (max 100)

Priority Rank = (count of dealers in SO group with Total Score GREATER) + 1
             → Rank 1 = highest scoring dealer = highest priority
```

### Priority Label

| Condition | Label |
|---|---|
| Final Category = Churn | **Low** |
| Priority Rank ≤ 2 OR Total Score ≥ 70 | **High** |
| Priority Rank ≤ 5 OR Total Score ≥ 50 | **Medium** |
| Otherwise | **Low** |

---

## Stage 9 — Visit Frequencies (Category × Grade)

Once a dealer has their Final Category and Grade, visits per month are looked up from this matrix:

### Visit Matrix (SO / ASM / RSM / ZH)

| Final Category | Grade | SO | ASM | RSM | ZH |
|---|---|---|---|---|---|
| **De-growing** | A | 2 | 3 | 2 | 1 |
| **De-growing** | B | 2 | 2 | 1 | 0 |
| **De-growing** | C | 3 | 1 | 0.5 | 0 |
| **De-growing** | D | 2 | 0.5 | 0 | 0 |
| **Growing** | A | 2 | 2 | 1 | 1 |
| **Growing** | B | 2 | 2 | 1 | 0 |
| **Growing** | C | 3 | 1 | 0.5 | 0 |
| **Growing** | D | 2 | 0.5 | 0 | 0 |
| **Need to Grow** | A | 2 | 3 | 3 | 1 |
| **Need to Grow** | B | 2 | 2 | 1 | 0 |
| **Need to Grow** | C | 3 | 1 | 0.5 | 0 |
| **Need to Grow** | D | 2 | 0.5 | 0 | 0 |
| **Zero Lifter** | A | 1 | 3 | 2 | 1 |
| **Zero Lifter** | B | 2 | 2 | 0.5 | 0 |
| **Zero Lifter** | C | 3 | 1 | 0.5 | 0 |
| **Zero Lifter** | D | 2 | 0.5 | 0 | 0 |
| **Prospective** | A | 1 | 3 | 2 | 1 |
| **Prospective** | B | 2 | 2 | 1 | 0 |
| **Prospective** | C | 3 | 1 | 0.5 | 0 |
| **Prospective** | D | 2 | 0.5 | 0 | 0 |
| **Churn** | Any | **0** | **0** | **0** | **0** |

> **0.5 visits** = this dealer is visited every alternate month. The value is preserved exactly.  
> Visit matrix is **configurable** via business rules using keys like `visit_matrix_SO_Growing_A`.

---

## Complete Worked Example

**Dealer: "Star Traders", Area: "Patna North", SO: "Rahul"**

| Step | Input | Result |
|---|---|---|
| **Current Sales (CM)** | RSAR Aug 2026 | 300 |
| **Previous Sales (PM)** | RSAR Jul 2026 | 200 |
| **6M Avg** | RSAR 6-month | 180 |
| **SBG Potential** | SBG file | 1000 |
| **Final Category** | CM(300) > PM(200) | **Growing** |
| **Final Volume** | = CM = 300 | **300** |
| **Area Volume** | Sum all in "Patna North" | 1150 |
| **Rank in Area** | 2nd highest final vol | Rank 2 |
| **Area Percentile** | (300+200+100+50)/1150 | **56.5%** |
| **Grade** | 56.5% > 40%, ≤ 60% | **B** |
| **Score A** | Potential Rank 4/4 × 40 | 40 |
| **Score B** | Growing = | 10 |
| **Score C** | 1 dealer has higher sales → (1+1)/4×20 | 10 |
| **Total Score** | 40+10+10 | **60** |
| **Priority Rank** | 1 dealer has higher score → Rank 2 | Rank 2 |
| **Priority Label** | Rank ≤ 2 | **High** |
| **SO Visits** | Growing × B | **2/month** |
| **ASM Visits** | Growing × B | **2/month** |
| **RSM Visits** | Growing × B | **1/month** |
| **ZH Visits** | Growing × B | **0/month** |

---

## Summary Flow Diagram

```
RSAR Sales
    │
    ├─→ CM, PM, 6M Avg ──→ FINAL CATEGORY ──────────────────────────────────────┐
    │                         (Prospective / Churn /                             │
    │                          Zero Lifter / Growing /                           │
    │                          Need to Grow / De-growing)                        │
    │                                │                                           │
    ├─→ SBG Potential ───────→ FINAL VOLUME ──→ Area Volume ──→ Area Percentile  │
    │   (counter potential)     (by category)      (SUM)          (suffix sum)   │
    │                                                                   │         │
    │                                                             GRADE (A/B/C/D) │
    │                                                              > 60% → A      │
    │                                                              > 40% → B      │
    │                                                              ≥ 20% → C      │
    │                                                              < 20% → D      │
    │                                                                   │         │
    │                                                                   └─────────┤
    │                                                                             │
    └─→ SBG Potential Rank ─→ Score A (40)                               VISITS  │
    └─→ Final Category ─────→ Score B (40) ──→ Total Score ──→ Priority  (matrix │
    └─→ Current Sales Rank ─→ Score C (20)                    Rank/Label  lookup)│
                                                                                  │
                                                         Category × Grade ────────┘
                                                           → SO/ASM/RSM/ZH
                                                             visits/month
```
