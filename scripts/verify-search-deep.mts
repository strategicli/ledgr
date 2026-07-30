// Fuzzy search verification (ADR-172). The pure layers need no DB — expansion,
// the fuzzy-date grammar, and the confidence curve are all deterministic
// functions. The generated-SQL assertions use .toSQL() (no connection opened),
// which is why .env.local is loaded: getDb() must be constructible.
//   npx tsx scripts/verify-search-deep.mts
import { readFileSync } from "node:fs";
// Type-only: erased at compile, so it doesn't run the module before env is loaded.
import type { Criterion } from "../src/lib/search-deep";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { expandTerm, termToTsQuery, expansionCount } = await import("../src/lib/synonyms");
const { parseFuzzyWhen, parseNaturalDate } = await import("../src/lib/nl-date");
const { deepSearchQuery, dateScore, CONFIDENCE } = await import("../src/lib/search-deep");

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail)})` : ""}`);
  if (!ok) failures += 1;
}

const OWNER = "00000000-0000-0000-0000-000000000001";
const TODAY = "2026-07-29";

// ---------------------------------------------------------------- expansion
console.log("\n--- Term expansion (WordNet + dictionary + number words)");
{
  const teaching = expandTerm("teaching");
  check("teaching keeps the typed word first", teaching[0] === "teaching");
  check("teaching reaches WordNet synonyms", teaching.includes("instruction"), teaching.join(", "));

  check("digit -> word", expandTerm("4").includes("four"));
  check("word -> digit", expandTerm("four").includes("4"));
  check("ordinal both ways", expandTerm("3rd").includes("third") && expandTerm("third").includes("3rd"));

  // The Edgewood-vocabulary gap WordNet can't know, and the fix for it.
  check(
    "WordNet alone does NOT link teaching -> preaching (why the dictionary exists)",
    !expandTerm("teaching").includes("preaching")
  );
  const withDict = expandTerm("teaching", { teaching: ["preaching", "message"] });
  check("dictionary adds its words", withDict.includes("preaching") && withDict.includes("message"));
  check(
    "dictionary entries come before WordNet's (they win the cap)",
    withDict.indexOf("preaching") < withDict.indexOf("instruction"),
    withDict.join(", ")
  );

  check("a multi-word term is a phrase, not expanded", expandTerm("staff meeting").length === 1);
  check("a phrase is quoted for tsquery", termToTsQuery("staff meeting") === '"staff meeting"');
  check("empty term yields no query", termToTsQuery("   ") === "");

  const tsq = termToTsQuery("teaching");
  check("tsquery OR-joins the expansion", tsq.includes(" OR "), tsq);
  check(
    "tsquery starts with the typed word",
    tsq.startsWith("teaching"),
    tsq
  );
  check(
    "expansion is capped",
    expandTerm("run", { run: Array.from({ length: 40 }, (_, i) => `w${i}`) }).length <= 12
  );
  check("unknown word survives with no synonyms", expandTerm("zzzqqx").length === 1);
  check("expansionCount excludes the term itself", expansionCount("zzzqqx") === 0);
}

// ------------------------------------------------------------- fuzzy dates
console.log("\n--- Fuzzy date grammar (backward-looking, range-shaped)");
{
  const win = parseFuzzyWhen("within the last week", TODAY);
  check("'within the last week' parses", win !== null);
  check("… ends today (a recent range, not a point)", win?.to === TODAY, win?.to);
  check("… starts a week back", win?.from === "2026-07-22", win?.from);

  const around = parseFuzzyWhen("last month sometime", TODAY);
  check("'last month sometime' parses", around !== null);
  check(
    "… plateaus around a month back",
    !!around && around.from! < "2026-07-01" && around.to! > "2026-06-15",
    `${around?.from}..${around?.to}`
  );
  check("… is labelled for the UI chip", !!around?.label, around?.label);

  const before = parseFuzzyWhen("at least six months ago", TODAY);
  check("'at least six months ago' parses", before !== null);
  check("… is open-ended backward", before?.from === null, String(before?.from));
  check("… cuts off six months back", before?.to === "2026-01-30", before?.to);

  check("'about a month ago' parses", parseFuzzyWhen("about a month ago", TODAY) !== null);
  check("'two weeks ago' parses", parseFuzzyWhen("two weeks ago", TODAY) !== null);
  check("'3 days ago' parses", parseFuzzyWhen("3 days ago", TODAY) !== null);
  check("'past few weeks' parses", parseFuzzyWhen("past few weeks", TODAY) !== null);
  check("'more than a year ago' parses", parseFuzzyWhen("more than a year ago", TODAY) !== null);
  check("an exact date still works", parseFuzzyWhen("2026-06-01", TODAY)?.from === "2026-06-01");
  check("gibberish returns null (caller keeps its date inputs)", parseFuzzyWhen("purple", TODAY) === null);

  // Vaguer phrases self-fuzz: the plateau widens with the stated distance.
  const week = parseFuzzyWhen("a week ago", TODAY)!;
  const halfYear = parseFuzzyWhen("six months ago", TODAY)!;
  check(
    "a vaguer phrase gets a wider window automatically",
    halfYear.softDays > week.softDays * 5,
    `week=${week.softDays}d, 6mo=${halfYear.softDays}d`
  );

  // parseNaturalDate must be untouched (task capture depends on it).
  check("parseNaturalDate still forward-looking", parseNaturalDate("tomorrow", TODAY) === "2026-07-30");
  check("… and still handles 'next week'", parseNaturalDate("next week", TODAY) === "2026-08-05");
}

// ---------------------------------------------------------- the date dial
console.log("\n--- The date dial bends the curve and never draws a line");
{
  const SOFT = 14;
  check(
    "inside the plateau every confidence is ~1.0",
    (["might", "probably", "sure"] as const).every((c) => dateScore(0, SOFT, c) > 0.999)
  );
  check(
    "all three agree at the window edge (the dial pivots, it doesn't move your guess)",
    (["might", "probably", "sure"] as const).every((c) => Math.abs(dateScore(SOFT, SOFT, c) - 0.5) < 1e-9)
  );

  const at2x = { might: dateScore(2 * SOFT, SOFT, "might"), probably: dateScore(2 * SOFT, SOFT, "probably"), sure: dateScore(2 * SOFT, SOFT, "sure") };
  check(
    "outside the window: sure < probably < might (monotonic)",
    at2x.sure < at2x.probably && at2x.probably < at2x.might,
    `2x out: sure=${at2x.sure.toFixed(3)} probably=${at2x.probably.toFixed(3)} might=${at2x.might.toFixed(3)}`
  );
  check("'sure' falls off a cliff", at2x.sure < 0.05, at2x.sure.toFixed(4));
  check("'might' keeps a long tail", at2x.might > 0.25, at2x.might.toFixed(3));
  check(
    "NO confidence ever reaches zero, even far out",
    (["might", "probably", "sure"] as const).every((c) => dateScore(10 * SOFT, SOFT, c) > 0),
    `sure @10x = ${dateScore(10 * SOFT, SOFT, "sure").toExponential(1)}`
  );
  check("only 'sure' locks a categorical criterion", CONFIDENCE.sure.locks && !CONFIDENCE.probably.locks && !CONFIDENCE.might.locks);
}

// -------------------------------------------------------------- generated SQL
console.log("\n--- Generated SQL: owner-scoped, body-free, date never filtered");
{
  const terms: Criterion[] = [
    { kind: "term", value: "teaching", confidence: "sure" },
    { kind: "term", value: "sermon", confidence: "might" },
  ];
  const q = deepSearchQuery(OWNER, terms)!.toSQL().sql;
  check("owner-scoped", q.includes("owner_id"));
  check("excludes soft-deleted", q.includes("deleted_at"));
  check("excludes templates", q.includes("is_template"));
  check("selects no body", !/"body"(?!_)/.test(q) && !q.includes("body_text"), "");
  check("rides the FTS vector", q.includes("websearch_to_tsquery"));
  check("normalizes rank with a window function (no CTE needed)", q.includes("over ()"));
  check("returns per-criterion contributions", q.includes("jsonb_build_array"));

  // A locked term is a real filter; a soft one only gates + scores.
  const soft = deepSearchQuery(OWNER, [{ kind: "term", value: "sermon", confidence: "might" }])!.toSQL().sql;
  check("a soft term still gates the candidate set", soft.includes("@@"));

  // The load-bearing claim: a date NEVER becomes a WHERE comparison, at any
  // confidence, as long as something else bounds the query.
  for (const confidence of ["might", "probably", "sure"] as const) {
    const withDate: Criterion[] = [
      { kind: "term", value: "teaching", confidence: "sure" },
      { kind: "date", source: { field: "updated" }, when: parseFuzzyWhen("last month sometime", TODAY)!, confidence },
    ];
    const built = deepSearchQuery(OWNER, withDate)!.toSQL();
    const whereClause = built.sql.slice(built.sql.indexOf(" where "), built.sql.indexOf(" order by "));
    check(
      `date at '${confidence}' is scored, never filtered`,
      !/updated_at"?::date\s*[<>]/.test(whereClause),
      whereClause.includes("power(") ? "no date comparison in WHERE" : ""
    );
    check(`date at '${confidence}' contributes a curve to the score`, built.sql.includes("power("));
  }

  // Date-only: no gate exists, so the curve must supply a scan bound.
  const dateOnly = deepSearchQuery(OWNER, [
    { kind: "date", source: { field: "created" }, when: parseFuzzyWhen("two weeks ago", TODAY)!, confidence: "sure" },
  ]);
  check("date-only search is allowed", dateOnly !== null);
  check(
    "… and bounds its scan from the curve",
    /created_at"?::date >=|created_at"?::date <=/.test(dateOnly!.toSQL().sql.replace(/\s+/g, " ")),
    ""
  );

  // The recency prior must yield to an explicit date statement.
  const noDate = deepSearchQuery(OWNER, terms)!.toSQL().sql;
  const yesDate = deepSearchQuery(OWNER, [
    ...terms,
    { kind: "date", source: { field: "updated" }, when: parseFuzzyWhen("at least six months ago", TODAY)!, confidence: "probably" },
  ])!.toSQL().sql;
  check("without a date criterion, the recency prior applies", noDate.includes("greatest("));
  check(
    "with a date criterion, the recency prior stands down (the owner's statement wins)",
    !/1 \+ \$?\d* ?\/ \(1 \+ \(extract/.test(yesDate) && !yesDate.includes("86400.0"),
    ""
  );

  // Property + relation criteria ride their own indexes.
  const props = deepSearchQuery(OWNER, [
    { kind: "property", key: "campus", value: "WPN", confidence: "might" },
    { kind: "relation", value: "00000000-0000-0000-0000-0000000000aa", role: "author", confidence: "sure" },
    { kind: "type", value: "note", confidence: "probably" },
  ])!.toSQL().sql;
  check("a tag criterion uses jsonb containment", props.includes("@>"));
  check("a typed relation criterion filters on role", props.includes("r.role"));
  check("a type criterion compares type", props.includes('"type"'));

  // A date against a custom date property is guarded against bad values.
  const propDate = deepSearchQuery(OWNER, [
    { kind: "term", value: "teaching", confidence: "sure" },
    { kind: "date", source: { field: "property", key: "preached_on" }, when: parseFuzzyWhen("a month ago", TODAY)!, confidence: "might" },
  ])!.toSQL().sql;
  check("a custom date property is shape-guarded before casting", propDate.includes("~"), "");

  // Regression: GREATEST() ignores nulls, so a missing date property collapsed
  // daysOutside to 0 and awarded FULL date credit instead of none. The guard is
  // an explicit `is null` arm, so assert the arm is actually in the SQL.
  check(
    "an item with no such date property scores 0, not full credit",
    /case when [\s\S]*is null then 0 else/.test(propDate),
    ""
  );

  check("no usable criteria yields no query", deepSearchQuery(OWNER, []) === null);
  check(
    "an unparseable term alone yields no query",
    deepSearchQuery(OWNER, [{ kind: "term", value: "   ", confidence: "sure" }]) === null
  );
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
