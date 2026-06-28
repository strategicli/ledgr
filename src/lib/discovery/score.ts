// Deterministic relatedness scorer (Discover, ADR-127). No model in the loop
// (Principle 3): plain SQL probes against indexes we already maintain (the FTS
// tsvector, pg_trgm, the relations graph, the properties GIN) plus arithmetic.
// Pure and strategy-agnostic — the nightly job (refresh.ts) precomputes it into
// item_relatedness, and the endpoint runs it live on a cache miss, off the same
// code. Owner-scoped and body-free throughout: it reads the anchor's title and
// scalar metadata, never any item's body.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, itemRelatedness, types } from "@/db/schema";
import { ItemError, listColumns } from "@/lib/items";
import type { RelatednessSignal, ScoredCandidate } from "@/lib/discovery/types";

// The starter mix, in one named, readable place (ADR-127). Unitless and
// comparable only within one anchor; tuned from real use via the reason chips.
// Co-citation ranks the head when it fires (high precision); text + shared
// attributes carry the cold, unlinked item; temporal is a booster, never a
// driver (it only ever adds to an item another signal already surfaced).
export const WEIGHTS = {
  cocitation: 0.5,
  text: 0.34,
  sharedAttr: 0.24,
  temporal: 0.12,
} as const;

// Below this combined score a row is hidden, so a sparse item degrades to
// "nothing yet" rather than showing weak, random rows.
export const SCORE_FLOOR = 0.12;

// Bounds so a probe is never a full scan (Principle 8): cap each gatherer's
// fan-out and the final scored pool.
const POOL = 50;
const TEXT_K = 25;
const TRGM_K = 20;
const COCITE_K = 30;
const ATTR_K = 25;
const ATTR_VALUE_CAP = 6; // distinct select values probed per anchor
const TRGM_THRESHOLD = 0.3; // looser than people-match (0.45): coverage, not a claim
const TEMPORAL_HALF_LIFE_DAYS = 10;
const TEMPORAL_MIN = 0.35; // only count temporal within ~10 days

type Acc = {
  cocitation?: number; // normalized 0..1 within this anchor
  cociteCount?: number; // distinct shared neighbors (for the chip)
  text?: number; // normalized 0..1
  sharedAttr?: number; // 0 or 1
  sharedAttrLabel?: string;
};

// Title → an OR tsquery so candidates surface on ANY shared word (websearch's
// default ANDs every term, which is far too strict for a guess). Significant
// words only; capped.
function titleToOrQuery(title: string): string {
  const words = (title.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(0, 8);
  return [...new Set(words)].join(" or ");
}

/**
 * Score the items most likely worth linking to `anchorId`, best first.
 * `includeLinked` keeps already-edged items (badged) for an explorer surface;
 * the panel/live path leaves it false so the gather excludes them up front.
 */
export async function scoreRelated(
  ownerId: string,
  anchorId: string,
  opts: { includeLinked?: boolean; limit?: number } = {}
): Promise<ScoredCandidate[]> {
  const db = getDb();

  // Anchor metadata — body-free (title, parent, type, properties, dates).
  const anchorRows = await db
    .select({
      id: items.id,
      title: items.title,
      parentId: items.parentId,
      type: items.type,
      properties: items.properties,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .where(and(eq(items.id, anchorId), eq(items.ownerId, ownerId), isNull(items.deletedAt)));
  if (anchorRows.length === 0) throw new ItemError("not_found", "item not found");
  const anchor = anchorRows[0];

  // Existing edges (either direction) — to exclude or badge.
  const nbr = await db.execute(sql`
    select case when source_id = ${anchorId} then target_id else source_id end as id
    from relations
    where source_id = ${anchorId} or target_id = ${anchorId}
  `);
  const linkedIds = new Set((nbr.rows as { id: string }[]).map((r) => r.id));

  const acc = new Map<string, Acc>();
  const touch = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = {};
      acc.set(id, a);
    }
    return a;
  };

  // --- Signal: keyword / text (FTS OR-query, ranked by ts_rank) ---
  const q = titleToOrQuery(anchor.title);
  if (q) {
    const res = await db.execute(sql`
      select i.id, ts_rank(i.search, websearch_to_tsquery('english', ${q})) as rank
      from items i
      where i.owner_id = ${ownerId} and i.deleted_at is null and i.is_template = false
        and i.id <> ${anchorId}
        and i.search @@ websearch_to_tsquery('english', ${q})
      order by rank desc
      limit ${TEXT_K}
    `);
    const rows = res.rows as { id: string; rank: number }[];
    const max = Math.max(...rows.map((r) => Number(r.rank)), 1e-6);
    for (const r of rows) touch(r.id).text = Math.max(touch(r.id).text ?? 0, Number(r.rank) / max);
  }

  // --- Signal: trigram title similarity (folds into the text signal) ---
  if (anchor.title.trim()) {
    const res = await db.execute(sql`
      select i.id, word_similarity(lower(i.title), lower(${anchor.title})) as sim
      from items i
      where i.owner_id = ${ownerId} and i.deleted_at is null and i.is_template = false
        and i.id <> ${anchorId}
        and word_similarity(lower(i.title), lower(${anchor.title})) >= ${TRGM_THRESHOLD}
      order by sim desc
      limit ${TRGM_K}
    `);
    for (const r of res.rows as { id: string; sim: number }[]) {
      touch(r.id).text = Math.max(touch(r.id).text ?? 0, Number(r.sim));
    }
  }

  // --- Signal: co-citation (shared neighbors, IDF-damped by neighbor degree) ---
  {
    const res = await db.execute(sql`
      with nbrs as (
        select distinct case when source_id = ${anchorId} then target_id else source_id end as nbr
        from relations
        where source_id = ${anchorId} or target_id = ${anchorId}
      ),
      deg as (
        select n.nbr, count(*)::float as d
        from nbrs n
        join relations r on (r.source_id = n.nbr or r.target_id = n.nbr)
        group by n.nbr
      ),
      cocite as (
        select case when r.source_id = n.nbr then r.target_id else r.source_id end as cand,
               sum(1.0 / ln(2.0 + d.d)) as score,
               count(distinct n.nbr) as shared
        from nbrs n
        join relations r on (r.source_id = n.nbr or r.target_id = n.nbr)
        join deg d on d.nbr = n.nbr
        group by cand
      )
      select c.cand as id, c.score, c.shared
      from cocite c
      join items i on i.id = c.cand
      where c.cand <> ${anchorId}
        and i.owner_id = ${ownerId} and i.deleted_at is null and i.is_template = false
      order by c.score desc
      limit ${COCITE_K}
    `);
    const rows = res.rows as { id: string; score: number; shared: number }[];
    const max = Math.max(...rows.map((r) => Number(r.score)), 1e-6);
    for (const r of rows) {
      const a = touch(r.id);
      a.cocitation = Number(r.score) / max;
      a.cociteCount = Number(r.shared);
    }
  }

  // --- Signal: shared attribute (same parent, then shared select values) ---
  if (anchor.parentId) {
    const res = await db.execute(sql`
      select i.id from items i
      where i.owner_id = ${ownerId} and i.deleted_at is null and i.is_template = false
        and i.id <> ${anchorId} and i.parent_id = ${anchor.parentId}
      limit ${ATTR_K}
    `);
    for (const r of res.rows as { id: string }[]) {
      const a = touch(r.id);
      a.sharedAttr = 1;
      a.sharedAttrLabel ??= "same parent";
    }
  }

  // Shared select / multi-select values: a short, recognizable chip ("same
  // series"). Only the type's select-kind keys, so freeform text never makes a
  // noisy chip; capped.
  const typeRow = await db
    .select({ propertySchema: types.propertySchema })
    .from(types)
    .where(eq(types.key, anchor.type));
  const schema = (typeRow[0]?.propertySchema ?? []) as { key: string; kind: string }[];
  const selectKeys = schema
    .filter((p) => p.kind === "select" || p.kind === "multi_select")
    .map((p) => p.key);
  const props = (anchor.properties ?? {}) as Record<string, unknown>;
  let valuesProbed = 0;
  for (const key of selectKeys) {
    if (valuesProbed >= ATTR_VALUE_CAP) break;
    const raw = props[key];
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (v): v is string => typeof v === "string" && v.length > 0
    );
    const isArray = Array.isArray(raw);
    for (const v of values) {
      if (valuesProbed >= ATTR_VALUE_CAP) break;
      valuesProbed += 1;
      const contains = JSON.stringify(isArray ? { [key]: [v] } : { [key]: v });
      const res = await db.execute(sql`
        select i.id from items i
        where i.owner_id = ${ownerId} and i.deleted_at is null and i.is_template = false
          and i.id <> ${anchorId}
          and i.properties @> ${contains}::jsonb
        limit ${ATTR_K}
      `);
      for (const r of res.rows as { id: string }[]) {
        const a = touch(r.id);
        a.sharedAttr = 1;
        a.sharedAttrLabel ??= v.slice(0, 40);
      }
    }
  }

  // Rank by the edge-free signals, cap the pool, then fetch list rows + apply
  // the temporal booster (needs the candidate's updated_at).
  const prelim = (a: Acc) =>
    (a.cocitation ?? 0) * WEIGHTS.cocitation +
    (a.text ?? 0) * WEIGHTS.text +
    (a.sharedAttr ?? 0) * WEIGHTS.sharedAttr;

  let ids = [...acc.keys()];
  if (!opts.includeLinked) ids = ids.filter((id) => !linkedIds.has(id));
  if (ids.length === 0) return [];
  ids.sort((x, y) => prelim(acc.get(y)!) - prelim(acc.get(x)!));
  ids = ids.slice(0, POOL);

  const rows = await db
    .select(listColumns)
    .from(items)
    .where(
      and(
        inArray(items.id, ids),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt),
        eq(items.isTemplate, false)
      )
    );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const anchorTime = anchor.updatedAt.getTime();
  const out: ScoredCandidate[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const a = acc.get(id)!;
    const days = Math.abs(anchorTime - row.updatedAt.getTime()) / 86_400_000;
    const decay = Math.exp(-days / TEMPORAL_HALF_LIFE_DAYS);
    const temporal = decay >= TEMPORAL_MIN ? decay : 0;

    const contribs: { signal: RelatednessSignal; w: number }[] = [];
    if (a.cocitation)
      contribs.push({
        signal: {
          kind: "cocitation",
          label: `shares ${a.cociteCount} link${a.cociteCount === 1 ? "" : "s"}`,
        },
        w: a.cocitation * WEIGHTS.cocitation,
      });
    if (a.text)
      contribs.push({
        signal: { kind: "text", label: "similar wording" },
        w: a.text * WEIGHTS.text,
      });
    if (a.sharedAttr)
      contribs.push({
        signal: { kind: "sharedAttr", label: a.sharedAttrLabel ?? "shared field" },
        w: a.sharedAttr * WEIGHTS.sharedAttr,
      });
    if (temporal)
      contribs.push({
        signal: { kind: "temporal", label: "edited together" },
        w: temporal * WEIGHTS.temporal,
      });

    const score = contribs.reduce((s, c) => s + c.w, 0);
    if (score < SCORE_FLOOR) continue;
    contribs.sort((x, y) => y.w - x.w);
    out.push({
      ...row,
      score,
      signals: contribs.slice(0, 3).map((c) => c.signal),
      linked: linkedIds.has(id),
    });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, opts.limit ?? POOL);
}

// Read an anchor's precomputed candidates from the cache, re-joined to live
// list rows and re-checked against current edges (so a row linked since the
// last compute is correctly flagged). Returns null when the anchor has no cache
// rows yet, so the caller can fall back to a live compute.
export async function readCachedRelated(
  ownerId: string,
  anchorId: string
): Promise<ScoredCandidate[] | null> {
  const db = getDb();
  const cacheRows = await db
    .select({
      candidateId: itemRelatedness.candidateId,
      score: itemRelatedness.score,
      signals: itemRelatedness.signals,
    })
    .from(itemRelatedness)
    .where(eq(itemRelatedness.itemId, anchorId));
  if (cacheRows.length === 0) return null;

  const ids = cacheRows.map((r) => r.candidateId);
  const rows = await db
    .select(listColumns)
    .from(items)
    .where(
      and(
        inArray(items.id, ids),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt),
        eq(items.isTemplate, false)
      )
    );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const nbr = await db.execute(sql`
    select case when source_id = ${anchorId} then target_id else source_id end as id
    from relations
    where source_id = ${anchorId} or target_id = ${anchorId}
  `);
  const linkedIds = new Set((nbr.rows as { id: string }[]).map((r) => r.id));

  const out: ScoredCandidate[] = [];
  for (const c of cacheRows) {
    const row = byId.get(c.candidateId);
    if (!row) continue; // candidate deleted/templated since compute
    out.push({
      ...row,
      score: Number(c.score),
      signals: (c.signals ?? []) as RelatednessSignal[],
      linked: linkedIds.has(c.candidateId),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

// The endpoint entry point: the unlinked, ranked, paged suggestions for the
// Discover panel. Reads the cache, falling back to a live compute on a miss, so
// a brand-new (uncached) item is never blank. The anchor is ownership-checked.
export async function suggestedRelations(
  ownerId: string,
  anchorId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ candidates: ScoredCandidate[]; nextOffset: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);

  const owned = await getDb()
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, anchorId), eq(items.ownerId, ownerId), isNull(items.deletedAt)));
  if (owned.length === 0) throw new ItemError("not_found", "item not found");

  const cached = await readCachedRelated(ownerId, anchorId);
  const all = cached ?? (await scoreRelated(ownerId, anchorId, { includeLinked: false }));
  const unlinked = all.filter((c) => !c.linked);
  return {
    candidates: unlinked.slice(offset, offset + limit),
    nextOffset: offset + limit < unlinked.length ? offset + limit : null,
  };
}
