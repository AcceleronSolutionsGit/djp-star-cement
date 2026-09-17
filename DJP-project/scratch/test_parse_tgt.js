import { parseMonthKey } from '../src/imports/sales-history.importer.js';

const testHeaders = [
  "June'26 Tgt",
  "Prorata Tgt",
  "30-Jun-26",
  "June'26 SALE",
  "May'26 DEALER",
  "July'26 Tgt",
  "August 2026 Target"
];

for (const h of testHeaders) {
  const isTarget = /\b(tgt|target)\b/i.test(h) && !/prorata/i.test(h);
  const isProrata = /prorata/i.test(h);
  const cleaned = h.replace(/\b(tgt|target|prorata|sale|dealer)\b/gi, '').trim();
  const parsed = parseMonthKey(cleaned);
  console.log({ h, isTarget, isProrata, cleaned, parsed });
}
