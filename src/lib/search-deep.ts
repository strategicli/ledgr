// Fuzzy search: stacked guesses, each with its own confidence (ADR-172).
//
// Ordinary search (lib/search.ts) answers "find the rows containing these words".
// This answers a different question: "I half-remember it — here is everything I
// think I know, weighted by how sure I am." Each criterion the owner adds carries
// its own confidence, and confidence means different things for different kinds of
// criteria:
//
//   CONTINUOUS (a date)  — the dial bends how sharply the score falls off, and is
//     NEVER a hard filter at any setting. "Sure" is a cliff just past the stated
//     window; "Might" is a long gentle tail. Even at Sure, an item outside the
//     window is scored low rather than excluded, so a strong text match can still
//     surface it. That is the whole point of the feature: the owner is saying how
//     much to trust their memory, not drawing a line the search can't see past.
//
//   CATEGORICAL (term, type, relation, tag) — there is no continuum between note
//     and meeting, so there is no curve to bend. "Sure" is a real WHERE filter
//     (exactly today's search behavior); lower stops boost without excluding.
//
// Deterministic end to end (Principle 3): synonym expansion is a hash lookup
// against a committed WordNet map, the date curve is arithmetic, and the ranking
// is one SQL query over indexes we already maintain (items_search_gin,
// items_type_idx, items_properties_gin). No model, no network, no embeddings.
//
// The scoring shape is Discover's (lib/discovery/score.ts): normalize each signal
// to 0..1, multiply by a named weight, sum. The difference is that here the owner
// sets the weights instead of a hardcoded WEIGHTS table.
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { listColumns } from "@/lib/items";
import { rankSql } from "@/lib/search";
import { RECENCY_MILD, recencyMultiplier } from "@/lib/recency";
import { termToTsQuery, type PersonalDictionary } from "@/lib/synonyms";
import { type FuzzyWhen } from "@/lib/nl-date";

export const CONFIDENCES = ["might", "probably", "sure"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

// The dial, in one named readable place (the Discover WEIGHTS pattern).
//   weight    — how much this criterion contributes to the summed score.
//   sharpness — the exponent on a CONTINUOUS criterion's falloff curve.
//   locks     — whether "this confidence" turns a CATEGORICAL criterion into a
//               real WHERE filter. Only ever true at `sure`, and never consulted
//               for a date criterion.
//
// Three stops, not a 1-10 scale: the numbers would be false precision nobody
// calibrates consistently. The stored vocabulary is the WORD, never these numbers,
// so the whole curve family stays retunable without invalidating a saved search URL.
//
// ponytail: weights and exponents are tuned by feel, like recency.ts's W and H.
// Expect one tuning pass after living with it; dial here, nowhere else.
export const CONFIDENCE: Record<Confidence, { weight: number; sharpness: number; locks: boolean }> = {
  might: { weight: 0.3, sharpness: 1, locks: false },
  probably: { weight: 0.6, sharpness: 2.5, locks: false },
  sure: { weight: 1.0, sharpness: 6, locks: true },
};

// Which date an item's "when" means. The owner picks this explicitly because both
// readings are legitimate and they are not the same question: "I made this around
// then" (created) vs "I was last working on it around then" (updated). A `property`
// source targets a date-kind custom field, so an event's own date or a sermon's
// preach date can be the thing you half-remember.
export type DateSource =
  | { field: "created" }
  | { field: "updated" }
  | { field: "property"; key: string };

export type Criterion =
  // A word. Expands through the owner's dictionary + WordNet + number words.
  | { kind: "term"; value: string; confidence: Confidence }
  // A vague date range (lib/nl-date.ts parseFuzzyWhen) against a chosen source.
  | { kind: "date"; source: DateSource; when: FuzzyWhen; confidence: Confidence }
  | { kind: "type"; value: string; confidence: Confidence }
  // A linked item. `role` narrows to one typed relation field (a relation-kind
  // property stores its value as edges with role = the field key, not in
  // properties); omitted, it matches a link in either direction, which is what
  // the old `person=` filter did.
  | { kind: "relation"; value: string; role?: string; confidence: Confidence }
  // A select / multi_select custom field value ("I remember it was tagged X").
  | { kind: "property"; key: string; value: string; confidence: Confidence };

export type DeepSearchOptions = {
  personal?: PersonalDictionary;
  limit?: number;
};

const SEARCH_LIMIT = 50;

// Below this a row is noise rather than a weak guess, so it's dropped instead of
// padding the list (the Discover SCORE_FLOOR idea). Deliberately low: this feature
// exists to surface the thing you only half-remember.
export const SCORE_FLOOR = 0.02;

// The date-score threshold used only to BOUND the scan when a date is the sole
// criterion (see dateScanBound). Not a filter on results: at this score a row
// cannot plausibly rank, so excluding it changes nothing visible.
const NEGLIGIBLE = 0.01;

// --- Per-criterion SQL ------------------------------------------------------

// The item date a `date` criterion measures against. A property source is guarded
// by a shape check so a hand-edited or free-text value can't abort the query with
// a cast error — an unparseable value reads as null, and the signal degrades to 0.
function dateSourceSql(source: DateSource): SQL {
  if (source.field === "created") return sql`${items.createdAt}::date`;
  if (source.field === "updated") return sql`${items.updatedAt}::date`;
  return sql`case
    when ${items.properties}->>${source.key} ~ '^\\d{4}-\\d{2}-\\d{2}$'
    then (${items.properties}->>${source.key})::date
    else null end`;
}

// Days the item's date falls OUTSIDE the plateau [from, to]; 0 anywhere inside it,
// and null when the item has no such date. A null bound is open on that side.
function daysOutsideSql(source: DateSource, when: FuzzyWhen): SQL {
  const sig = dateSourceSql(source);
  const beforeFrom = when.from ? sql`(${when.from}::date - ${sig})` : sql`0`;
  const afterTo = when.to ? sql`(${sig} - ${when.to}::date)` : sql`0`;
  return sql`greatest(${beforeFrom}, ${afterTo}, 0)`;
}

// The continuous signal: 1.0 inside the plateau, decaying outside it at a rate the
// confidence dial sets. Same power-law family as recency.ts, plus the sharpness
// exponent. Never reaches 0, so a date guess can always be overcome by a strong
// text match. coalesce keeps an item with no such date at 0 rather than null.
// Every bound parameter that takes part in arithmetic is cast explicitly. Without
// it Postgres has to guess a bind parameter's type from the operator, and with
// `-` on a date it guesses `date - date -> integer` (see the ::int on the scan
// bound below, which failed as `date >= integer` until it was cast).
function dateSignalSql(c: Criterion & { kind: "date" }): SQL {
  const { sharpness } = CONFIDENCE[c.confidence];
  const soft = Math.max(c.when.softDays, 0.5);
  // The `is null` arm is load-bearing, not defensive noise. GREATEST() IGNORES
  // nulls (unlike almost every other function), so an item with no such date
  // property makes daysOutside collapse to 0 — which reads as "dead centre of
  // your window" and awards FULL credit. An outer coalesce cannot catch it,
  // because nothing null ever reaches it. Test it before simplifying this.
  return sql`case when ${dateSourceSql(c.source)} is null then 0 else
    1.0 / (1 + power(${daysOutsideSql(c.source, c.when)}::numeric / ${soft}::numeric, ${sharpness}::numeric))
  end`;
}

/**
 * Pure JS mirror of the SQL date curve, for tests and any client-side reasoning
 * (the recency.ts `recencyFactor` pattern). `daysOutside` is 0 anywhere inside the
 * plateau. Never returns 0: a date guess always yields to a strong text match.
 */
export function dateScore(daysOutside: number, softDays: number, confidence: Confidence): number {
  const { sharpness } = CONFIDENCE[confidence];
  const soft = Math.max(softDays, 0.5);
  return 1 / (1 + Math.pow(Math.max(daysOutside, 0) / soft, sharpness));
}

// How far out the date score becomes negligible. Used ONLY to bound the scan when
// nothing else narrows it. Solves 1/(1+x^p) = NEGLIGIBLE for x, in days.
function dateScanBound(c: Criterion & { kind: "date" }): number {
  const { sharpness } = CONFIDENCE[c.confidence];
  const soft = Math.max(c.when.softDays, 0.5);
  return Math.ceil(soft * Math.pow(1 / NEGLIGIBLE - 1, 1 / sharpness));
}

// A confirmed link to `value`, either direction, optionally through one typed
// relation field. Mirrors the relatedTo subquery in lib/search.ts.
function relationExistsSql(c: Criterion & { kind: "relation" }): SQL {
  const role = c.role ? sql` and r.role = ${c.role}` : sql``;
  return sql`exists (
    select 1 from relations r
    where r.match_state = 'confirmed'${role}
      and ((r.source_id = ${items.id} and r.target_id = ${c.value})
        or (r.target_id = ${items.id} and r.source_id = ${c.value}))
  )`;
}

// A select or multi_select value. Both shapes ride items_properties_gin: a scalar
// select stores "value", a multi_select stores ["value", …], and @> matches an
// array containment as well as a scalar equality, so we try both.
function propertyMatchSql(c: Criterion & { kind: "property" }): SQL {
  const scalar = JSON.stringify({ [c.key]: c.value });
  const array = JSON.stringify({ [c.key]: [c.value] });
  return sql`(${items.properties} @> ${scalar}::jsonb or ${items.properties} @> ${array}::jsonb)`;
}

type Compiled = {
  // A 0..1 signal for this criterion, weighted into the score.
  signal: SQL;
  // An index-backed condition that makes a row a CANDIDATE. Null for a date
  // (not index-backed, and soft by definition).
  gate: SQL | null;
  // Set only for a locked categorical criterion: a real WHERE filter.
  hard: SQL | null;
};

function compile(c: Criterion, personal: PersonalDictionary): Compiled | null {
  const locks = CONFIDENCE[c.confidence].locks;
  switch (c.kind) {
    case "term": {
      const tsq = termToTsQuery(c.value, personal);
      if (!tsq) return null;
      const query = sql`websearch_to_tsquery('english', ${tsq})`;
      const match = sql`${items.search} @@ ${query}`;
      // Normalized within the candidate set: a raw ts_rank is ~0.05-0.3 while a
      // boolean signal is 1.0, so without this a "might" type would outweigh a
      // "sure" word. Window functions are legal in the select list and ORDER BY,
      // which is why this needs no CTE.
      return {
        // rankSql, not a bare ts_rank: a title hit doubles the score, which is
        // what keeps an exact-title item above a long body that merely repeats
        // the words (see lib/search.ts). Normalizing by the boosted max keeps
        // this signal in 0..1 exactly as before.
        signal: sql`(${rankSql(query)} / greatest(max(${rankSql(query)}) over (), 1e-6))`,
        gate: match,
        hard: locks ? match : null,
      };
    }
    case "date":
      // Criteria arrive from URL params, where an unparseable phrase yields no
      // range at all. Dropping it here (rather than trusting the caller) keeps a
      // malformed query from crashing every route that builds one.
      if (!c.when || (c.when.from === null && c.when.to === null)) return null;
      // Never gated, never locked — a date is continuous, so the dial bends the
      // curve instead of drawing a line.
      return { signal: dateSignalSql(c), gate: null, hard: null };
    case "type": {
      const match = eq(items.type, c.value);
      return {
        signal: sql`case when ${match} then 1 else 0 end`,
        gate: match,
        hard: locks ? match : null,
      };
    }
    case "relation": {
      const match = relationExistsSql(c);
      return {
        signal: sql`case when ${match} then 1 else 0 end`,
        gate: match,
        hard: locks ? match : null,
      };
    }
    case "property": {
      const match = propertyMatchSql(c);
      return {
        signal: sql`case when ${match} then 1 else 0 end`,
        gate: match,
        hard: locks ? match : null,
      };
    }
  }
}

/**
 * The scored query, exposed as a builder (the lib/search.ts + lib/items.ts
 * pattern) so verification can assert owner-scoping and the absence of `body` in
 * the generated SQL without touching a database.
 *
 * Returns null when the criteria can't be searched — nothing usable, or nothing
 * that bounds the scan. The caller reports that rather than running a query that
 * would rank the entire corpus.
 */
export function deepSearchQuery(
  ownerId: string,
  criteria: Criterion[],
  opts: DeepSearchOptions = {}
) {
  const personal = opts.personal ?? {};
  const compiled = criteria
    .map((c) => ({ c, sqlParts: compile(c, personal) }))
    .filter((x): x is { c: Criterion; sqlParts: Compiled } => x.sqlParts !== null);
  if (compiled.length === 0) return null;

  const where: SQL[] = [
    eq(items.ownerId, ownerId),
    isNull(items.deletedAt),
    // Template prototypes stay out of search (ADR-093), same as lib/search.ts.
    eq(items.isTemplate, false),
  ];

  // Locked categorical criteria become real filters.
  for (const { sqlParts } of compiled) if (sqlParts.hard) where.push(sqlParts.hard);

  // A row must satisfy at least one soft, index-backed condition to be scored.
  // Skipped when a hard filter already narrows the set (the filter IS the gate).
  const gates = compiled.map((x) => x.sqlParts.gate).filter((g): g is SQL => g !== null);
  const hasHard = compiled.some((x) => x.sqlParts.hard !== null);
  if (!hasHard) {
    if (gates.length > 0) {
      where.push(sql`(${sql.join(gates, sql` or `)})`);
    } else {
      // Date-only, nothing typed ("a note from about two months ago"). No
      // index-backed gate exists and a date is never a filter, so bound the scan
      // by the curve itself: past this distance the score is negligible and the
      // row could not rank anyway. At `sure` that's close in and cheap; at
      // `might` the tail is long, so this degrades to a bounded scan-and-rank.
      //
      // ponytail: no index on items.updated_at, so the loose case is a seq scan
      // capped by LIMIT. Tens of ms at single-user corpus size (the same bet
      // Discover's POOL cap makes). Add items_owner_updated_idx if that changes.
      const dates = compiled
        .map((x) => x.c)
        .filter((c): c is Criterion & { kind: "date" } => c.kind === "date");
      if (dates.length === 0) return null;
      for (const c of dates) {
        const bound = dateScanBound(c);
        const sig = dateSourceSql(c.source);
        if (c.when.from) where.push(sql`${sig} >= ${c.when.from}::date - ${bound}::int`);
        if (c.when.to) where.push(sql`${sig} <= ${c.when.to}::date + ${bound}::int`);
      }
    }
  }

  // score = Σ (weight × signal), then the generic recency prior — but only when
  // the owner has NOT told us about the date. If they said "at least six months
  // ago", boosting recent rows would contradict the thing they just asserted, so
  // their statement wins over the prior.
  const contribs = compiled.map(
    ({ c, sqlParts }) => sql`(${CONFIDENCE[c.confidence].weight}::numeric * ${sqlParts.signal})`
  );
  const hasDate = compiled.some((x) => x.c.kind === "date");
  const summed = sql`(${sql.join(contribs, sql` + `)})`;
  const score = hasDate ? summed : sql`(${summed} * ${recencyMultiplier(RECENCY_MILD)})`;

  return getDb()
    .select({
      ...listColumns,
      score: sql<number>`${score}`,
      // Per-criterion contributions, in the SAME ORDER as `criteria`, so the UI can
      // label why a row matched ("both words", "synonym only", "near your date")
      // without a second round trip. jsonb keeps it one column regardless of count.
      contribs: sql<number[]>`jsonb_build_array(${sql.join(contribs, sql`, `)})`,
    })
    .from(items)
    .where(and(...where))
    // ponytail: the score expression is repeated in ORDER BY, so each ts_rank is
    // evaluated about twice per candidate row. Measured 83-178ms warm over ~9k
    // items, comfortably inside budget, so it stays simple. Ordering by the
    // select-list alias isn't available (Drizzle emits no SQL aliases, it maps
    // results by position); if this ever needs to be faster, wrap the signals in
    // a CTE so each is computed once and referenced by name.
    .orderBy(sql`${score} desc`, desc(items.updatedAt))
    .limit(Math.min(Math.max(opts.limit ?? SEARCH_LIMIT, 1), SEARCH_LIMIT));
}

export type DeepSearchResult = Awaited<ReturnType<typeof deepSearch>>[number];

export async function deepSearch(
  ownerId: string,
  criteria: Criterion[],
  opts: DeepSearchOptions = {}
) {
  const query = deepSearchQuery(ownerId, criteria, opts);
  if (!query) return [];
  const rows = await query;
  return rows
    .filter((r) => Number(r.score) >= SCORE_FLOOR)
    .map((r) => ({ ...r, score: Number(r.score), contribs: (r.contribs ?? []).map(Number) }));
}
