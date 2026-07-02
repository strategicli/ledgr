// Column layout for overlapping timed task blocks in the Planner time-grid
// (Slice 4). Without this, two tasks at the same time render at the same
// left/right and the later one fully hides the earlier one — a task can sit
// buried with no sign it's there. Given each block's start/end minutes, this
// splits the column width among blocks that overlap in time so every block
// stays visible.
//
// Pure geometry (no DOM/React), so it's node-testable and shared with the verify
// script. Calendar-overlay events are intentionally NOT laid out here — they
// stay full-width context behind the tasks (ADR-133 read-only framing); only
// editable task blocks compete for width.

export type OverlapInput = {
  id: string;
  startMin: number;
  endMin: number;
};

// Fractional horizontal placement, 0..1 of the column's inner width.
export type OverlapLayout = { left: number; width: number };

// Assign each block a lane so overlapping blocks share the width evenly. Blocks
// are grouped into "clusters" — maximal runs that transitively overlap — and the
// width is split by the widest simultaneous overlap in the cluster, so a cluster
// of 3 where only 2 ever overlap at once still uses half-width columns.
export function layoutOverlaps(blocks: OverlapInput[]): Map<string, OverlapLayout> {
  const out = new Map<string, OverlapLayout>();
  if (blocks.length === 0) return out;

  // Stable order: by start, then longer-first, then id (deterministic ties).
  const sorted = [...blocks].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.id.localeCompare(b.id),
  );

  // Walk in order, breaking into clusters whenever a block starts at/after the
  // running max-end of the current cluster (no overlap with anything so far).
  let cluster: OverlapInput[] = [];
  let clusterMaxEnd = -Infinity;
  const flush = () => {
    for (const [id, layout] of layoutCluster(cluster)) out.set(id, layout);
    cluster = [];
    clusterMaxEnd = -Infinity;
  };
  for (const b of sorted) {
    if (cluster.length > 0 && b.startMin >= clusterMaxEnd) flush();
    cluster.push(b);
    clusterMaxEnd = Math.max(clusterMaxEnd, b.endMin);
  }
  flush();
  return out;
}

// Lane assignment within one cluster: greedily place each block in the first
// lane whose last block has ended. `lanes` is the max concurrency → column count.
function layoutCluster(cluster: OverlapInput[]): Map<string, OverlapLayout> {
  const out = new Map<string, OverlapLayout>();
  if (cluster.length === 0) return out;
  if (cluster.length === 1) {
    out.set(cluster[0].id, { left: 0, width: 1 });
    return out;
  }

  const laneEnds: number[] = []; // end minute of the last block in each lane
  const laneOf = new Map<string, number>();
  for (const b of cluster) {
    let lane = laneEnds.findIndex((end) => end <= b.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(b.endMin);
    } else {
      laneEnds[lane] = b.endMin;
    }
    laneOf.set(b.id, lane);
  }
  const lanes = laneEnds.length;
  const width = 1 / lanes;
  for (const b of cluster) {
    out.set(b.id, { left: (laneOf.get(b.id) ?? 0) * width, width });
  }
  return out;
}
