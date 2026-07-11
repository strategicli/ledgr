// ADR-156 verification: the search recency curve, as a pure function (no DB).
// The SQL multiplier in src/lib/recency.ts mirrors recencyFactor() exactly, so
// asserting the JS curve's shape guards the ranking behavior we promised:
// steep near term, long fat tail, bounded, stronger for quick/@ search than for
// the full search page.
//   npx tsx scripts/verify-recency.mts
import { recencyFactor, RECENCY_STRONG, RECENCY_MILD } from "../src/lib/recency";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const DAY = 1;
const WEEK = 7;
const MONTH = 30;
const HALF_YEAR = 182;
const YEAR = 365;
const TWO_YEARS = 730;

for (const [label, w] of [
  ["strong", RECENCY_STRONG],
  ["mild", RECENCY_MILD],
] as const) {
  const at = (d: number) => recencyFactor(d, w);

  // Bounded: newest row approaches 1+w, never exceeds it; ancient rows → ~1.
  check(`${label}: today ≤ 1+w`, at(0) <= 1 + w.w + 1e-9, `${at(0).toFixed(3)}`);
  check(`${label}: today is the max`, at(0) > at(DAY) && at(DAY) > at(WEEK));
  check(`${label}: floor above 1`, at(1e6) > 1 && at(1e6) < 1.01);

  // Monotonic decreasing with age.
  const ages = [0, DAY, WEEK, MONTH, HALF_YEAR, YEAR, TWO_YEARS];
  const monotonic = ages.every((a, i) => i === 0 || at(ages[i - 1]) > at(a));
  check(`${label}: monotonic decreasing`, monotonic);

  // Steep near term: a week beats half a year by a wide margin.
  check(
    `${label}: 1wk ≫ 6mo`,
    at(WEEK) - at(HALF_YEAR) > 0.3 * w.w,
    `${at(WEEK).toFixed(3)} vs ${at(HALF_YEAR).toFixed(3)}`
  );

  // Fat tail: 1yr still ranks above 2yr (an exponential would flatten both).
  check(
    `${label}: 1yr > 2yr (fat tail)`,
    at(YEAR) > at(TWO_YEARS),
    `${at(YEAR).toFixed(4)} vs ${at(TWO_YEARS).toFixed(4)}`
  );

  // Negative/zero age (clock skew) is clamped, not amplified.
  check(`${label}: future clamps to today`, recencyFactor(-99, w) === at(0));
}

// Quick/@ search leans harder on recency than the full search page, everywhere.
for (const d of [0, WEEK, MONTH, YEAR]) {
  check(
    `strong > mild at ${d}d`,
    recencyFactor(d, RECENCY_STRONG) > recencyFactor(d, RECENCY_MILD)
  );
}

// The @-typeahead guarantee: a short exact-ish title (high similarity, old)
// must keep its lead over a long freshly-created task (low similarity, today).
// Ranking key is similarity × recencyFactor — same as the SQL ORDER BY.
const personScore = 1.0 * recencyFactor(YEAR, RECENCY_STRONG); // "Roger Knowlton", a year old
const taskScore = 0.3 * recencyFactor(0, RECENCY_STRONG); // "Roger Knowlton's email …", today
check(
  "@ : short exact match beats long fresh task",
  personScore > taskScore,
  `person ${personScore.toFixed(3)} vs task ${taskScore.toFixed(3)}`
);

// But among genuinely close matches, recency breaks the tie toward the fresh one.
const oldClose = 0.8 * recencyFactor(YEAR, RECENCY_STRONG);
const freshClose = 0.8 * recencyFactor(DAY, RECENCY_STRONG);
check("@ : recency breaks close-similarity ties", freshClose > oldClose);

console.log(failures === 0 ? "\nAll recency checks passed." : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
