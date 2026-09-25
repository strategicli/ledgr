// Shared shapes for deterministic related-item discovery (Discover, ADR-127).
// Client-safe: no DB imports, so the panel and the API can both type against
// these.
import type { ItemListRow } from "@/lib/items";

// Why a candidate ranked. Stored on the cache row and rendered as a reason
// chip, so the guess shows its work (deterministic systems can).
export type RelatednessSignalKind =
  | "text" // FTS / trigram title overlap
  | "cocitation" // shares linked neighbors (IDF-damped)
  | "sharedAttr" // same parent, or a shared select/multi-select value
  | "temporal"; // created/edited close together

export type RelatednessSignal = {
  kind: RelatednessSignalKind;
  label: string;
};

// A scored suggestion: the body-free list row plus its score and reasons.
// `linked` is true when an edge to the anchor already exists (either
// direction); the Discover panel filters these out, a future explorer keeps and
// badges them.
export type ScoredCandidate = ItemListRow & {
  score: number;
  signals: RelatednessSignal[];
  linked: boolean;
};
