// The Desk's per-device persistence (ADR-146): the live layout in localStorage,
// plus a Recent auto-snapshot ring so a layout is never lost. Named workspaces
// (synced, in users.settings) are separate and land in S2 — this file only owns
// the browser-local half. Same posture as related-prefs.ts / outbox.ts: a tiny
// per-device store, tolerant of a missing/garbage blob, never throwing.
//
// Two keys:
//   desk:layout — the current live layout (one object, version-checked).
//   desk:recent — a ring of timestamped snapshots (~25). Before anything
//                 REPLACES the live layout wholesale (Open beside, load a
//                 workspace, reset), the outgoing layout is snapshotted here, so
//                 the good sermon arrangement survives a quick side-by-side
//                 detour even if you never named it.
import { sanitizeLayout, type DeskLayout } from "./layout";

const LIVE_KEY = "desk:layout";
const RECENT_KEY = "desk:recent";

// The ring is intentionally deep (not the 7-8 of an undo stack): a Desk layout
// is worth keeping, and any Recent entry can be promoted to a named workspace
// (S2). Tunable — bump it here.
export const RECENT_CAP = 25;

export type RecentSnapshot = {
  id: string;
  ts: number; // epoch ms; the menu formats it ("Unsaved · Jul 6, 2:14 PM")
  layout: DeskLayout;
};

// --- Live layout ----------------------------------------------------------

export function loadLiveLayout(): DeskLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LIVE_KEY);
    if (!raw) return null;
    return sanitizeLayout(JSON.parse(raw)); // unknown version / garbage → null
  } catch {
    return null;
  }
}

export function saveLiveLayout(layout: DeskLayout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LIVE_KEY, JSON.stringify(layout));
  } catch {
    /* quota or privacy mode: a lost layout falls back to fresh, harmless */
  }
}

// --- Recent auto-snapshot ring --------------------------------------------

export function loadRecent(): RecentSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((r): RecentSnapshot | null => {
        if (!r || typeof r !== "object") return null;
        const layout = sanitizeLayout((r as { layout?: unknown }).layout);
        const ts = (r as { ts?: unknown }).ts;
        const id = (r as { id?: unknown }).id;
        if (!layout || typeof ts !== "number") return null;
        return { id: typeof id === "string" ? id : String(ts), ts, layout };
      })
      .filter((r): r is RecentSnapshot => r !== null)
      .slice(0, RECENT_CAP);
  } catch {
    return [];
  }
}

function saveRecent(list: RecentSnapshot[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(list.slice(0, RECENT_CAP))
    );
  } catch {
    /* quota: drop the oldest by capping harder on the next write */
  }
}

// Push the outgoing layout onto the ring (newest first), capped. Skips an empty
// layout (a single empty leaf) — there's nothing worth restoring there. Returns
// the updated ring so a caller holding it in state can refresh without a reread.
export function snapshotToRecent(layout: DeskLayout): RecentSnapshot[] {
  const hasContent = layout.root.kind !== "leaf" || layout.root.tabs.length > 0;
  if (!hasContent) return loadRecent();
  const snap: RecentSnapshot = {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : String(Date.now()),
    ts: Date.now(),
    layout,
  };
  const next = [snap, ...loadRecent()].slice(0, RECENT_CAP);
  saveRecent(next);
  return next;
}
