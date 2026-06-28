// The Related Explorer's data (Discover, ADR-127 Phase 2): an item's whole
// neighborhood — existing links AND discovered candidates — unified into one
// score-sorted list, linked rows flagged. The scorer (includeLinked) supplies
// scores + reason chips for everything it can reach; any plain manual link the
// signals didn't surface is unioned in so the map is complete. Owner-scoped and
// body-free through both sources. Computed live per anchor (a re-anchor is just
// another bounded compute), so it never depends on the panel cache, which is
// deliberately unlinked-only.
import { listRelatedItems } from "@/lib/relations";
import { scoreRelated } from "@/lib/discovery/score";
import type { ScoredCandidate } from "@/lib/discovery/types";

export async function exploreNeighborhood(
  ownerId: string,
  anchorId: string
): Promise<ScoredCandidate[]> {
  const [scored, related] = await Promise.all([
    scoreRelated(ownerId, anchorId, { includeLinked: true, limit: 60 }),
    listRelatedItems(ownerId, anchorId),
  ]);
  const byId = new Map<string, ScoredCandidate>();
  for (const c of scored) byId.set(c.id, c);
  // Union in any existing link the scorer didn't gather (a manual link with no
  // textual/graph signal): a plain "linked" row with no computed reason.
  for (const r of related) {
    const seen = byId.get(r.id);
    if (seen) {
      seen.linked = true;
      continue;
    }
    byId.set(r.id, { ...r, score: 0, signals: [], linked: true });
  }
  return [...byId.values()].sort((a, b) => b.score - a.score);
}
