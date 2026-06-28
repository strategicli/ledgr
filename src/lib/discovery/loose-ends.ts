// Loose Ends (Discover, ADR-127 Phase 3): the scorer inverted across the
// corpus. Instead of "what relates to THIS item", it asks "which items are
// barely connected, and what should they link to" — the surface that actively
// drives the graph toward completeness. Each under-connected item is returned
// with its top suggestions inline (one-click Link on the page). Owner-scoped,
// body-free, bounded.
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { scoreRelated } from "@/lib/discovery/score";

export type LooseEndSuggestion = {
  id: string;
  title: string;
  type: string;
  signals: { kind: string; label: string }[];
};

export type LooseEnd = {
  id: string;
  title: string;
  type: string;
  degree: number; // confirmed, non-mention edges
  suggestions: LooseEndSuggestion[];
};

// "Under-connected" = at most this many confirmed, non-mention edges. Mentions
// are body-managed noise here, suggested edges aren't real links yet.
const DEGREE_MAX = 3;
const SCAN = 40; // least-connected items to score per run
const SHOW = 20; // returned (only those that actually have a suggestion)
const PER_ITEM = 3; // top suggestions surfaced per loose end
const CHUNK = 8; // scoring concurrency

export async function findLooseEnds(
  ownerId: string,
  opts: { limit?: number } = {}
): Promise<LooseEnd[]> {
  const db = getDb();

  // Aggregate the confirmed, non-mention edge degree once (relations is small),
  // left-join to items, take the least-connected first. Bounded by SCAN.
  const rows = (
    await db.execute(sql`
      with deg as (
        select item_id, count(*)::int as c
        from (
          select source_id as item_id from relations where match_state = 'confirmed' and role <> 'mention'
          union all
          select target_id as item_id from relations where match_state = 'confirmed' and role <> 'mention'
        ) e
        group by item_id
      )
      select i.id, i.title, i.type, coalesce(d.c, 0) as degree
      from items i
      left join deg d on d.item_id = i.id
      where i.owner_id = ${ownerId} and i.deleted_at is null and i.is_template = false
        and coalesce(d.c, 0) <= ${DEGREE_MAX}
      order by coalesce(d.c, 0) asc, i.updated_at desc
      limit ${SCAN}
    `)
  ).rows as { id: string; title: string; type: string; degree: number }[];

  const limit = Math.min(Math.max(opts.limit ?? SHOW, 1), SHOW);
  const out: LooseEnd[] = [];
  // Score in small concurrent chunks; keep only items that have a suggestion (a
  // truly orphaned item with no candidate is silently skipped, not shown empty).
  for (let i = 0; i < rows.length && out.length < limit; i += CHUNK) {
    const scored = await Promise.all(
      rows.slice(i, i + CHUNK).map((r) =>
        scoreRelated(ownerId, r.id, { includeLinked: false, limit: PER_ITEM }).then(
          (s) => ({ r, s })
        )
      )
    );
    for (const { r, s } of scored) {
      if (out.length >= limit) break;
      if (s.length === 0) continue;
      out.push({
        id: r.id,
        title: r.title,
        type: r.type,
        degree: Number(r.degree),
        suggestions: s.map((c) => ({
          id: c.id,
          title: c.title,
          type: c.type,
          signals: c.signals,
        })),
      });
    }
  }
  return out;
}
