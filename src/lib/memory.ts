// AI Memory subsystem (ADR-137). The plumbing behind the `memory` type: the
// always-on "stump" index an AI loads at the start of a session, and the shape
// helpers shared by the MCP tools (tools.ts) and the Build → AI Memory page.
//
// Deterministic by default (Principle 3): nothing here calls a model. The AI
// decides *what* is worth remembering and calls `remember`; this decides which
// stored memories are worth *pushing* every session vs. leaving to be pulled on
// demand. Every read is body-free (Principle 8) and owner-scoped — it reuses the
// same items/relations/views libs the rest of the app does, so the memory
// surface can never drift from the app's own contract.
import { relatedSummaryFor } from "@/lib/relations";
import { queryViewItems } from "@/lib/views";

export const MEMORY_TYPE = "memory";

// The two facets that drive the stump index (mirrors the type's property_schema
// in drizzle/0040_memory_type.sql). `kind` = what a memory is about; `horizon` =
// how long it stays true. Both are plain selects; the third field, `pinned`
// (checkbox), forces a stump always-on regardless of horizon/age.
export const MEMORY_KINDS = ["user", "feedback", "project", "reference"] as const;
export const MEMORY_HORIZONS = ["evergreen", "seasonal", "episodic"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryHorizon = (typeof MEMORY_HORIZONS)[number];

// How long a seasonal/episodic memory rides in the always-on set after its last
// touch. Evergreen and pinned ignore this; anything older drops out of the
// pushed stumps but stays fully discoverable via includeAll / search_items.
const ALWAYS_ON_WINDOW_DAYS = 45;

export type MemoryStump = {
  id: string;
  title: string;
  kind: MemoryKind | null;
  horizon: MemoryHorizon | null;
  pinned: boolean;
  updatedAt: Date;
  // Up to 4 confirmed neighbours (relatedSummaryFor cap) — the entry points for
  // the "follow the graph" recall. The AI decides whether to pull any of them.
  linked: { id: string; title: string; type: string }[];
};

// Read a memory item's built-in facets tolerantly from its properties jsonb: an
// unknown/renamed/missing value degrades to a sensible default rather than
// throwing (the same posture as parseSettings), so the user editing the type's
// properties in Build can never break the stump reader.
export function memoryFacets(raw: unknown): {
  kind: MemoryKind | null;
  horizon: MemoryHorizon | null;
  pinned: boolean;
} {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = (MEMORY_KINDS as readonly string[]).includes(p.kind as string)
    ? (p.kind as MemoryKind)
    : null;
  const horizon = (MEMORY_HORIZONS as readonly string[]).includes(p.horizon as string)
    ? (p.horizon as MemoryHorizon)
    : null;
  return { kind, horizon, pinned: p.pinned === true };
}

// The stump index. Default = the always-on set: every evergreen (or
// horizon-unset) memory, every pinned one, plus seasonal/episodic touched within
// ALWAYS_ON_WINDOW_DAYS. Pass includeAll to get the full store (the Build page's
// browse view, or an explicit deep recall). Newest-touch first, body-free.
export async function getMemoryStumps(
  ownerId: string,
  opts: { includeAll?: boolean; limit?: number } = {}
): Promise<MemoryStump[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const rows = await queryViewItems(
    ownerId,
    { type: MEMORY_TYPE },
    { field: "updatedAt", dir: "desc" },
    limit
  );
  const cutoff = Date.now() - ALWAYS_ON_WINDOW_DAYS * 86_400_000;
  const chosen = rows.filter((r) => {
    if (opts.includeAll) return true;
    const { horizon, pinned } = memoryFacets(r.properties);
    if (pinned) return true;
    // evergreen — or an unset horizon — is always-on; seasonal/episodic ages out.
    if (horizon === "evergreen" || horizon == null) return true;
    return new Date(r.updatedAt).getTime() >= cutoff;
  });
  const linkedMap = await relatedSummaryFor(
    ownerId,
    chosen.map((r) => r.id)
  );
  return chosen.map((r) => {
    const { kind, horizon, pinned } = memoryFacets(r.properties);
    return {
      id: r.id,
      title: r.title,
      kind,
      horizon,
      pinned,
      updatedAt: r.updatedAt,
      linked: linkedMap.get(r.id) ?? [],
    };
  });
}
