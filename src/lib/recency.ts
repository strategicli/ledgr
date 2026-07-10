// Recency weighting for search ranking (ADR-156). Relevance alone treats a note
// from two years ago the same as one edited this morning; in practice the owner
// is usually reaching for something worked on recently — most so in the @
// typeahead and quick search, less so in an intentional full search. We fold a
// recency *multiplier* into the relevance score (ts_rank for FTS, similarity for
// the @ typeahead) rather than using recency as a tiebreak (it never fired,
// since relevance scores effectively never tie) or as a hard sort key (which
// would bury a short, rarely-edited person under a long, freshly-edited task
// that merely contains the words).
//
// The curve is power-law, not exponential, on purpose: steep near term, long
// gentle tail.
//   multiplier = 1 + W / (1 + age_days / H)
//   W = boost strength (today's row ranks up to (1+W)× its relevance)
//   H = age in days at which the boost has fallen to half of W
// A power-law keeps a fat tail — a 1-year-old row still ranks above a 2-year-old
// one — whereas an exponential flattens both to ~no boost past a few H, losing
// that ordering. The recency signal is GREATEST(created_at, updated_at):
// whichever is newer, so a fresh create and a fresh edit both count.
//
// (Relation-recency — bumping an old item because it was just linked to — was
// considered and dropped: it needs a per-row subquery into relations for a
// deliberately small effect. Revisit here if linked-to-but-unedited items still
// feel buried.)
//
// ponytail: W/H are tuned by feel, not measured; dial per surface if ranking
// feels off. No index needed — the multiplier sorts an already-filtered,
// limit-capped result set, so the sort is over a handful of rows.
import { sql, type SQL } from "drizzle-orm";
import { items } from "@/db/schema";

export type RecencyWeight = { w: number; h: number };

// @ typeahead + quick search: lean hard on recency.
export const RECENCY_STRONG: RecencyWeight = { w: 2, h: 14 };
// Full search page: milder — a deliberate deep search is likelier reaching back.
export const RECENCY_MILD: RecencyWeight = { w: 0.5, h: 30 };

// SQL multiplier in (1, 1+w], highest for the newest rows. Multiply a relevance
// score (ts_rank, similarity) by it inside ORDER BY.
export function recencyMultiplier({ w, h }: RecencyWeight): SQL<number> {
  return sql<number>`(1 + ${w} / (1 + (extract(epoch from (now() - greatest(${items.createdAt}, ${items.updatedAt}))) / 86400.0) / ${h}))`;
}

// Pure JS mirror of the SQL curve, for tests and any client-side reasoning.
export function recencyFactor(ageDays: number, { w, h }: RecencyWeight): number {
  return 1 + w / (1 + Math.max(ageDays, 0) / h);
}
