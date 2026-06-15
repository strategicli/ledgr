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

export type SearchOptions = {
  type?: string;
  relatedTo?: string;
  // updated_at window: from inclusive, to exclusive (the route turns
  // calendar days into these instants in the app timezone).
  from?: Date;
  to?: Date;
  limit?: number;
};

const SEARCH_LIMIT = 50;

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
      rank: sql<number>`ts_rank(${items.search}, ${query})`,
      snippet: sql<
        string | null
      >`ts_headline('english', left(coalesce(${items.bodyText}, ''), 4000), ${query}, 'StartSel=[[, StopSel=]], MaxWords=18, MinWords=8, MaxFragments=2, FragmentDelimiter=" … "')`,
    })
    .from(items)
    .where(and(...where))
    .orderBy(
      sql`ts_rank(${items.search}, ${query}) desc`,
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
