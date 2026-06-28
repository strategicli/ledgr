// Nightly relatedness refresh (Discover, ADR-127). Bounded, dirty-driven +
// rolling: never-computed and edited-since-last-compute anchors jump the queue,
// then the stalest by computed_at fill the remaining budget — so active items
// stay fresh and the cold corpus trickles in a slice a night. Idempotent per
// anchor (replace its cache rows). The endpoint's live-compute fallback covers
// anything not yet cached, so this job is an optimization, not a correctness
// dependency (Principle 8). The cache is built panel-first (unlinked
// candidates); a future explorer computes the linked neighborhood live.
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { itemRelatedness, jobState } from "@/db/schema";
import { scoreRelated } from "@/lib/discovery/score";

export const RELATEDNESS_JOB_KEY = "relatedness";

// Per-run caps so the daily job stays well inside a serverless function budget;
// the rolling cursor means a skipped tail is just picked up the next night.
const BATCH = 200;
const TIME_BUDGET_MS = 45_000;

export type RelatednessResult = {
  scanned: number;
  upserted: number;
  budgetHit: boolean;
};

export async function refreshRelatedness(
  ownerId: string,
  // `ids` recomputes exactly those anchors (an on-demand / test path); omitted,
  // the job picks the dirty + stalest batch itself (the nightly path).
  opts: { ids?: string[] } = {}
): Promise<RelatednessResult> {
  const db = getDb();
  const started = Date.now();

  // Never-computed + dirty (edited since its last compute) first, then the
  // stalest by computed_at. Bounded by BATCH.
  const anchorIds = opts.ids
    ? opts.ids
    : (
        (
          await db.execute(sql`
            select i.id
            from items i
            left join (
              select item_id, max(computed_at) as c from item_relatedness group by item_id
            ) r on r.item_id = i.id
            where i.owner_id = ${ownerId} and i.deleted_at is null and i.is_template = false
            order by (case when r.c is null or i.updated_at > r.c then 0 else 1 end),
                     coalesce(r.c, to_timestamp(0)) asc
            limit ${BATCH}
          `)
        ).rows as { id: string }[]
      ).map((r) => r.id);

  let scanned = 0;
  let upserted = 0;
  let budgetHit = false;
  for (const id of anchorIds) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      budgetHit = true;
      break;
    }
    scanned += 1;
    const scored = await scoreRelated(ownerId, id, { includeLinked: false, limit: 50 });
    // Replace this anchor's rows. Not transactional with the insert: a crash
    // between the two leaves the anchor uncached, which the live fallback covers.
    await db.delete(itemRelatedness).where(eq(itemRelatedness.itemId, id));
    if (scored.length > 0) {
      await db.insert(itemRelatedness).values(
        scored.map((c) => ({
          itemId: id,
          candidateId: c.id,
          score: c.score,
          signals: c.signals,
        }))
      );
      upserted += scored.length;
    }
  }
  return { scanned, upserted, budgetHit };
}

export type RelatednessState = { lastRunAt: string; lastResult: RelatednessResult };

// Last successful run, for /health. A failing run is captured to error_log and
// never writes job_state, so this stays the last-good stamp.
export async function getRelatednessState(): Promise<RelatednessState | null> {
  const rows = await getDb()
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, RELATEDNESS_JOB_KEY));
  return (rows[0]?.value ?? null) as RelatednessState | null;
}
