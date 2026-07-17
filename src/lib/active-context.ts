// Live editing context (ADR-161): the read/write helpers over the single
// per-owner active_context row — "what note am I looking at, and what have I
// highlighted right now." The open item canvas reports into it (the tracker →
// POST /api/active-context) and Claude reads it over MCP (get_active_context) to
// resolve deictic references ("this note", "this sentence") the way Notion's
// sidebar does. Ephemeral UI state, not user content (rule 2): it never touches
// `items`, so it isn't exported, searched, or revisioned.
//
// One upserted row per owner (owner_id unique). Device clobbering is intended
// (Brandon, 2026-07-16): the context is "in the moment," last-writer-wins, so a
// second device simply overwrites the row rather than forking it. Everything is
// owner-scoped like the rest of the app.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activeContext } from "@/db/schema";

// Bounds so a runaway report can't bloat the row. A selection past this is
// truncated (with a marker) rather than rejected — the reader still gets the
// start of what was highlighted, which is what "rework this sentence" needs.
const MAX_TITLE = 400;
const MAX_SELECTION = 4000;

export type ActiveContext = {
  itemId: string | null;
  title: string | null;
  selectionText: string | null;
  selectionAt: Date | null;
  updatedAt: Date;
};

export type ActiveContextReport = {
  itemId: string;
  title?: string | null;
  // Present + non-empty = the current highlight; null/absent = nothing selected.
  selectionText?: string | null;
};

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated]`;
}

// The owner's current context, or null when nothing is open (no row). Owner-
// scoped; a single indexed lookup on the unique owner_id.
export async function getActiveContext(
  ownerId: string
): Promise<ActiveContext | null> {
  const rows = await getDb()
    .select({
      itemId: activeContext.itemId,
      title: activeContext.title,
      selectionText: activeContext.selectionText,
      selectionAt: activeContext.selectionAt,
      updatedAt: activeContext.updatedAt,
    })
    .from(activeContext)
    .where(eq(activeContext.ownerId, ownerId));
  return rows[0] ?? null;
}

// Upsert the owner's context from a report. selection_at is stamped only when a
// non-empty selection is present, so the reader can tell a live highlight from a
// stale one and from "no selection". updated_at auto-bumps ($onUpdate), marking
// how fresh the whole context is (staleness gate on the read side).
export async function setActiveContext(
  ownerId: string,
  report: ActiveContextReport
): Promise<void> {
  const title =
    typeof report.title === "string" && report.title.trim()
      ? clip(report.title, MAX_TITLE)
      : null;
  const selection =
    typeof report.selectionText === "string" && report.selectionText.trim()
      ? clip(report.selectionText, MAX_SELECTION)
      : null;
  const now = new Date();
  await getDb()
    .insert(activeContext)
    .values({
      ownerId,
      itemId: report.itemId,
      title,
      selectionText: selection,
      selectionAt: selection ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: activeContext.ownerId,
      set: {
        itemId: report.itemId,
        title,
        selectionText: selection,
        selectionAt: selection ? now : null,
        updatedAt: now,
      },
    });
}

// Clear the owner's context (the canvas closed / navigated away). Deleting the
// row is the "nothing open" state, so a reader never sees a stale note after the
// owner has moved on. No-op when there's no row.
export async function clearActiveContext(ownerId: string): Promise<void> {
  await getDb().delete(activeContext).where(eq(activeContext.ownerId, ownerId));
}
