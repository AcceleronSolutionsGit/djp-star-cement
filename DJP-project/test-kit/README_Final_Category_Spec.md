# DJP Test Kit — Final Category (column U) · 100% accuracy pack

Planning month **2026-07** · anchor cell `$B$2` = **2026-07-01** · current sales month = **Jun'26**

---

## 1. What column U actually is

I pulled the live formula out of `M.xlsx` → sheet `Master ` → cell `U5`:

```excel
=IFS(
  T5="New",                                          "Prospective",
  T5>=$B$2-15,                                       "Growing",
  T5<=DATE(YEAR($B$2)-1,MONTH($B$2)-1,1),  IFS(S5=0,"Churn", O5=0,"Zero Lifter", AK5="yes","Need to Grow", O5>=Q5,"Growing", O5<Q5,"De-growing"),
  T5<=$B$2-180,                            IFS(S5=0,"Churn", O5=0,"Zero Lifter", AK5="yes","Need to Grow", S5>O5,"De-growing", S5<=O5,"Growing"),
  T5>$B$2-180,                             IFS(           O5=0,"Zero Lifter", AK5="yes","Need to Grow", R5>O5,"De-growing", R5<=O5,"Growing"))
```

I re-implemented it and replayed it over the whole client master: **12,656 / 12,658 rows match (99.98%)**.
The only 2 misses are rows with a **blank DOA** — Excel reads blank as `0`, which lands in the *Old* tier. Treat blank DOA as "very old" and it is 100%.

### Symbol map

| Sym | Meaning | Source file |
|---|---|---|
| `$B$2` | planning anchor = 1st of planning month | — |
| `T` | DOA | Dealer Performance (`"New"` for prospects) |
| `N` | Counter Potential | **SBG** (`sbg_potential`) |
| `O` | current-month sale (Jun'26) | Dealer Performance |
| `R` | **previous-month sale (May'26)** | Dealer Performance — **this is the column your export is missing** |
| `Q` | same month last year (Jun'25) | Dealer Performance |
| `S` | last-6-months average | 6-month sales series |
| `P` | counter share | `= O / N` |
| `AL` `AM` `AN` | area potential total / rank / percentile | derived, grouped by **AREA** |
| `AK` | Need-to-grow flag | `=IF(AND(AN>60%, P<20%, T<>"New"),"Yes","No")` |

### DOA tiers for this kit

| Cut-off | Date | Behaviour |
|---|---|---|
| `$B$2 − 15` | 2026-06-16 | DOA on/after → **Growing**, regardless of sales |
| `DATE(Y−1,M−1,1)` | 2025-06-01 | DOA on/before → **Old** tier, compares `O` vs `Q` |
| `$B$2 − 180` | 2026-01-02 | DOA on/before (and after Old cut-off) → **Mid** tier, compares `S` vs `O` |
| — | after 2026-01-02 | **New** tier, compares `R` vs `O` — **no Churn branch in this tier** |

---

## 2. The missing Dealer-Performance column

Your DLRWISE export carries `Jun'26 Tgt`, `Prorata Tgt`, `Jun'26 SALE` and `Jun-25 SALE`, but **not the previous-month sale (`May'26 SALE`)**. That is column `R`, and the *New* tier (DOA after 2026-01-02) classifies **entirely** on `R` vs `O`. Without it every recently-appointed dealer is mis-categorised.

When you send it, join on **SAP code** (`master_dealers.sap_code`) and write it into `dealer_performance_history` as `period_year_month = '2026-05'`. In `TEST_02_Dealer_Performance.xlsx` the column is already present and named `May-26 SALE`, matching `02_Dealer_Performance_Template.csv`.

---

## 3. Gaps between the spec and `classification.engine.js`

| # | Current code | Should be |
|---|---|---|
| 1 | `classifyDealer()` ignores DOA — no tiers, always CM vs PM | four DOA tiers, each with its own comparison |
| 2 | `needToGrow` is computed in `pjp.engine.js` stage 4 and passed in, but the function never reads it | `AK = "Yes"` ⇒ **Need to Grow** (ranks above every growth comparison) |
| 3 | `Need to Grow` is emitted when `CM == PM` | remove that branch — equality means **Growing** (`O>=Q`, `S<=O`, `R<=O` are all inclusive) |
| 4 | Churn = `CM=0 AND PM=0 AND 6M=0` | Churn = `S = 0` alone, and only in the Old / Mid tiers |
| 5 | Zero Lifter reachable in every tier | in the New tier a zero-sales dealer is a Zero Lifter and **can never be Churn** |
| 6 | RSAR-first precedence for `currentSales` / `previousSales` / 6M avg | in the client master `O`, `R`, `Q` and `S` are all **Dealer Performance**; RSAR is sub-dealer retail and does not reconcile (I checked: 4/303 and 3/721 rows agree) |

**6 of the 33 rows in this kit come out differently under the current code** — they are flagged `MISMATCH` in the expected-results sheet, so you can use them as the regression targets.

---

## 4. Files

| File | Rows | Notes |
|---|---|---|
| `TEST_01_Dealer_Mapping.xlsx` | 18 | template 01 shape; real SAP/SFA/SO/ASM/RSM/ZH from your ROE tagging file |
| `TEST_02_Dealer_Performance.xlsx` | 18 | template 02 shape, **including `May-26 SALE`** |
| `TEST_03_SBG_Master.xlsx` | 18 | template 03 shape; potentials are the real SBG ROE values |
| `TEST_04_Sales_History_RSAR.xlsx` | 20 | 2 dealers deliberately split into 2 sub-dealer rows to test roll-up by `LinkedDealerCode` |
| `TEST_05_Prospect_Dealers.xlsx` | 15 | template 05 shape; real rows from `Prospect_Dealer_List-Jul2026` |
| `EXPECTED_RESULTS.xlsx` | 33 | expected Final Category + every intermediate, per row |

`EXPECTED_RESULTS.xlsx` sheets: `Expected_Category` (the checklist), `Rule_Spec`, `Area_Rollups`, `RSAR_Reconciliation`.

The kit is **internally consistent on purpose**: RSAR aggregated by `LinkedDealerCode` equals the Dealer-Performance monthly series exactly, SBG potential equals Dealer-Mapping counter potential, and DOA is identical in all three files. So whichever source your loader picks, the answer is the same — a mismatch can only mean a logic bug, never a data-precedence bug.

## 5. Coverage

18 dealers + 15 prospects = **33 rows**, hitting every branch of the formula:

- Prospective ×15 · Growing ×6 · De-growing ×4 · Need to Grow ×3 · Zero Lifter ×3 · Churn ×2
- Need to Grow reached from all three tiers (Old / Mid / New)
- `O = Q`, `S = O`, `R = O` equality boundaries → all must resolve to **Growing**
- DOA exactly on the 180-day cut-off, on both sides (`1000002033` = Mid → Zero Lifter; `1000001615` = New → Zero Lifter with `S = 0`, proving Churn is unreachable there)
- A dealer with `AN > 60%` but share ≥ 20% → **not** Need to Grow (`1000001141`, `1000001609`)
- A brand-new dealer with zero sales → **Growing** (`1000001154`)
