# The client's adherence technique, derived from the live files

Sources: `Trade DJP Zone wise - 28-06-2026.xlsx` (formulas read directly out of the sheet XML) and `PJP Process Adherence Guidelines_19-09-2024.docx`.

Every formula below was checked numerically against the values in the workbook. All three reconcile to the last decimal place.

---

## 1. The governing rule: MTD is **prorata by day of month**, not a day 1–15 window

`DJP` sheet, the headline summary:

```excel
C5 = SUMIFS('Visits Plan'!$P:$P, 'Visits Plan'!$O:$O, B5)          ' Plan     (full month)
D5 = C5 * DAY($M$2) / DAY(EOMONTH($M$2,0))                         ' MTD Due  (prorata)
F5 = SUMIFS('Visits Plan'!T:T, 'Visits Plan'!$O:$O, $B5)           ' Adhered  (capped)
H5 = F5 / D5                                                       ' Adherence
```

`$M$2` is the **"as on" date** — 28-06-2026 in this file. June has 30 days, so the factor is 28/30.

Verified:

| Check | Computed | In the file |
|---|---|---|
| Plan 3753 × 28/30 | 3502.8000 | 3502.8 |
| Dealers 1706 × 28/30 | 1592.2666666666667 | 1592.2666666666667 |
| 823 ÷ 3502.8 | 0.2349548932282745 | 0.2349548932282745 |
| 111 ÷ 163 (SO summary) | 0.6809815950920245 | 0.6809815950920245 |

**This is the single biggest difference from our engine.** `analyseC1Adherence` hard-codes a day 1–15 window and counts a dealer as planned or not. The client prorates the *planned visit count* by how far through the month you are, and divides actual visits by that. Run on the 28th, 93.3% of the month's plan is due; run on the 10th, 33.3% is.

It also explains the guidelines document: adherence is run at least **twice a month** — on the 15th for the C1→C2 amendment, and on the 28th for the next month's PJP file. A fixed 1–15 window cannot produce the 28th figure at all.

## 2. Adherence is counted per **role**, per **dealer**

`Target vs Adhe SO_ASM_RSM_ZM` carries a five-column block for each of SO, ASM, RSM and ZH, per dealer:

```excel
P5 = VLOOKUP(L5,'Visits Plan'!$K$5:$AJ$14992,23,0)   ' No. of visits Planned
Q5 = VLOOKUP(L5,'Visits Plan'!$K$5:$AJ$14992,19,0)   ' MTD No. of visits Planned
R5 = VLOOKUP(L5,'Visits Plan'!$K$5:$AJ$14992,14,0)   ' No. of visits Adhered
S5 = IFERROR(R5/IF(Q5<1,P5,Q5),0)                    ' Adherence %
T5 = Q5-R5                                           ' Pending to visit
```

So: **Adherence % = Adhered ÷ MTD-planned**, falling back to the full-month plan when MTD-planned rounds below 1. Pending = MTD-planned − Adhered, and goes negative when someone over-visits.

There is a summary block beside it aggregating the same figures per employee. Both levels exist; we currently produce only a per-employee number.

## 3. Two different "adhered" numbers, deliberately

`Visits Plan`:

```excel
T5 = IF(COUNTIFS('SFA Report'!C:C, K5, 'SFA Report'!I:I, I5) > P5, P5,
        COUNTIFS(...))                                ' SO Adhered   — CAPPED at the plan
X5 = COUNTIFS('SFA Report'!C:C, K5, 'SFA Report'!I:I, I5)   ' visits completed — UNCAPPED
```

- **Capped** (`T..W`) feeds the DJP dashboard, so headline adherence never exceeds 100%.
- **Uncapped** (`X..AA`) feeds the per-dealer sheet, where you see 500% and negative pending — that is intentional, it surfaces over-visiting.

Ours is neither: it is binary per dealer, so a dealer visited three times counts once and a dealer visited zero times counts zero. That cannot produce either of the client's numbers.

## 4. The matching key — this settles the code-shape question

```excel
COUNTIFS('SFA Report'!C:C, K5, 'SFA Report'!I:I, I5)
```

- `'SFA Report'!C` = **Customer Code** → matched against `'Visits Plan'!K` = **SFA**, *not* column M (`Customer CODE`, the SAP code)
- `'SFA Report'!I` = **Employee Name** → matched against `'Visits Plan'!I` = **SO/SE NAME**

And the live SFA Report data confirms it: `SDNE13791`, `NSNE03180`, `B014` are SFA codes. The SAP code never appears in that file.

**Our engine matches `dealer_sap_code` against `customer_code`.** That is the mismatch I flagged from the test kit, now confirmed from the client's own file — the SFA export simply does not contain SAP codes. Resolve `customer_code` through `master_dealers.sfa_code` before comparing, or key the plan on the SFA code.

Employee is matched on **name** in the client's sheet; the SFA export does carry `Employee Code` (`11002057`), so matching on code is the sounder choice — just don't assume the plan's key and the log's key are the same field.

## 5. Distinct visit *days* vs visit *rows*

`NE + ROE` holds one row per (dealer, role) with `Date of Visit 1..5`, `COUNTS`, `MTD DUE`:

```excel
P3 = IF(COUNTIFS(J3:N3,">="&$C$1)=0, O3, COUNTIFS(J3:N3,"<="&$C$1))
```

`COUNTS` (up to 5) is **distinct visit days**; `COUNTIFS('SFA Report')` is **raw visit rows**. In the sample dealer these differ — 1 day, 5 rows. Both measures are used, in different places. Whichever we adopt has to be stated explicitly, because they are not interchangeable.

## 6. Process rules from the guidelines document

| Rule | Status in our build |
|---|---|
| RSSD & Sub-Dealer customers for SO/SR/MT visits only | implemented — `SO_ONLY_TYPES` in `loadDealersWithMappings` |
| SO plans approved by respective ASM | implemented — L1 routing |
| **3-month churn definition** | **not implemented** — our Churn is `6-month avg = 0` |
| Prospective list shared by the 26th | process, no code needed |
| Unplanned mid-month visits need ASM approval | implemented — `requestUnplannedVisit` |
| 15th: SFA summary → sales team amends next 15 days → ASM approval | partly — we regenerate C2, but adherence is locked to a 1–15 window |
| 16th: review meeting if needed | process |
| Churn list with probability shared with ASM | partly — `churn.controller.js` exists, no probability |

Two things to settle with the client:

- **Churn is defined as 3 months in the guidelines**, but column U of the master uses `S = 0` where S is the 6-month average. The document and the working file disagree. The file is what produced the numbers we are matching, so I have kept the 6-month rule — worth confirming which governs.
- The guidelines skip from item 5 to item 8. Items 6 and 7 are missing from the document; if they exist in a later revision we should see it.

---

## 7. Template conformance — checked, and they match

The workbook's only true external inputs are the **SFA Report** and the **Employee list**; everything else (`Visits Plan`, `NE + ROE`, `Target vs Adhe`, the role pivots) is derived from the DJP output.

`TEST_06_SFA_Report.xlsx` has been rewritten to the client's exact layout:

| Sheet | Client's columns | Ours |
|---|---|---|
| `SFA Report` | SI, Date of Visit, Customer Code, Customer Name, Route, Type, Branch, Employee Code, Employee Name, Check In Time, Check Out Time, Duration, Visit Status(Productive / Non productive), Remarks, Purpose Of Visit | **identical, same order** |
| `Employee list` | ZONE, Region, Name, Desig | **identical, same order** |

All 14 fields `importSfaReport()` reads are present in both. The importer keys on header name, so the added `SI` column and the previous Remarks/Purpose ordering were never going to break it — but the test file now mirrors the real export exactly, including realistic `Duration` strings, `Purpose Of Visit = "Routine Visit,,"`, and `Type` values of Dealer / Sub Dealer / Non Star.

One change of substance: the MAHESWARI row is now logged as `WBM273` because that is what the real export contains. It is no longer an artificial trap — it is the normal case.

## 8. What has to change in `sfa-adherence.engine.js`

| # | Now | Should be |
|---|---|---|
| 1 | window hard-coded to day 1–15 | an **as-on date**, with MTD due = plan × day ÷ days-in-month |
| 2 | binary per dealer — visited or not | **count** visits; keep a capped and an uncapped figure |
| 3 | SO plans only, in effect | per role: SO, ASM, RSM, ZH |
| 4 | one % per employee | per dealer **and** per employee |
| 5 | `dealer_sap_code` vs `customer_code` | resolve through `master_dealers.sfa_code` |
| 6 | `completed ÷ raw planned rows` | `adhered ÷ MTD planned`, falling back to full-month plan when MTD < 1 |
| 7 | no pending figure | `pending = MTD planned − adhered`, negative allowed |
