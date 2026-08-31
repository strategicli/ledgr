// Full-text search (slice 13, PRD §4.2): Postgres FTS over the stored
// generated tsvector (title + body_text, ADR-003), riding items_search_gin.
// websearch_to_tsquery parses Google-ish syntax (words, "quoted phrases",
// OR, -exclusions) and never throws on user input, so the raw query string
// binds straight in. Filters: type, relatedTo (confirmed relations, either
// direction), and an updated-at date window.
import { and, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { listColumns } from "@/lib/items";
import { RECENCY_MILD, recencyMultiplier, type RecencyWeight } from "@/lib/recency";

export type SearchOptions = {
  type?: string;
  relatedTo?: string;
  // updated_at window: from inclusive, to exclusive (the route turns
  // calendar days into these instants in the app timezone).
  from?: Date;
  to?: Date;
  limit?: number;
  // Recency weighting folded into ts_rank (see @/lib/recency). Defaults to the
  // mild full-search curve; quick search passes the strong one.
  recency?: RecencyWeight;
};

const SEARCH_LIMIT = 50;

// Relevance = ts_rank, doubled when the WHOLE query also matches the title.
//
// The boost is not a nicety, it breaks a tie that would otherwise be decided by
// noise. ts_rank saturates: once a lexeme appears a handful of times in a body,
// its contribution is ~1.0, so a long note that merely mentions the words scores
// 0.99999994 against an exact-title item's 1.0 — a 6e-8 gap that recency then
// swamps. That is how "Life Plan Development 2025-2026" landed sixth in a search
// for its own title (2026-08-31). The A-weight on the title in the generated
// tsvector can't fix this on its own, because weights only matter before
// saturation. Doubling a title hit does.
//
// `@@` means EVERY query term is in the title (websearch_to_tsquery ANDs them),
// so this fires for "the thing I named" and not for a partial word overlap.
// Recomputing to_tsvector over the title per row is cheap: titles are short and
// the row set is already filtered by the GIN index.
export function rankSql(query: SQL): SQL<number> {
  return sql<number>`(ts_rank(${items.search}, ${query}) * (case
    when to_tsvector('english', coalesce(${items.title}, '')) @@ ${query} then 2
    else 1 end))`;
}

// Exposed as a query builder (items.ts pattern) so verification can assert
// owner scoping and the absence of body in the generated SQL. The snippet
// is the one deliberate brush with body content on a list read: ts_headline
// returns a ~18-word excerpt computed in the database, not the body itself,
// and left() caps its input so a sermon-length body can't make a search row
// expensive.
export function searchItemsQuery(
  ownerId: string,
  q: string,
  opts: SearchOptions = {}
) {
  const query = sql`websearch_to_tsquery('english', ${q})`;
  const where: SQL[] = [
    eq(items.ownerId, ownerId),
    isNull(items.deletedAt),
    // Template prototypes stay out of search/FTS (ADR-093) — app search,
    // MCP search_items, and the typeaheads that ride this query.
    eq(items.isTemplate, false),
    sql`${items.search} @@ ${query}`,
  ];
  if (opts.type) where.push(eq(items.type, opts.type));
  if (opts.relatedTo) {
    where.push(sql`exists (
      select 1 from relations r
      where r.match_state = 'confirmed'
        and ((r.source_id = ${items.id} and r.target_id = ${opts.relatedTo})
          or (r.target_id = ${items.id} and r.source_id = ${opts.relatedTo}))
    )`);
  }
  if (opts.from) where.push(gte(items.updatedAt, opts.from));
  if (opts.to) where.push(lt(items.updatedAt, opts.to));

  return getDb()
    .select({
      ...listColumns,
      rank: rankSql(query),
      snippet: sql<
        string | null
      >`ts_headline('english', left(coalesce(${items.bodyText}, ''), 4000), ${query}, 'StartSel=[[, StopSel=]], MaxWords=18, MinWords=8, MaxFragments=2, FragmentDelimiter=" … "')`,
    })
    .from(items)
    .where(and(...where))
    .orderBy(
      // Relevance scaled by the recency curve, so a fresh row outranks an
      // equally-relevant stale one; updated_at stays as the final tiebreak.
      sql`${rankSql(query)} * ${recencyMultiplier(opts.recency ?? RECENCY_MILD)} desc`,
      desc(items.updatedAt)
    )
    .limit(Math.min(Math.max(opts.limit ?? SEARCH_LIMIT, 1), SEARCH_LIMIT));
}

export type SearchResult = Awaited<ReturnType<typeof searchItems>>[number];

export async function searchItems(
  ownerId: string,
  q: string,
  opts: SearchOptions = {}
) {
  if (!q.trim()) return [];
  const rows = await searchItemsQuery(ownerId, q, opts);
  // A title-only hit gets a markerless headline (the body's opening words);
  // drop those rather than show noise under the title.
  return rows.map((row) => ({
    ...row,
    snippet: row.snippet && row.snippet.includes("[[") ? row.snippet : null,
  }));
}
