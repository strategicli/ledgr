// Overview "weave" (Project Type, ADR-111/PJ8). The Overview is one markdown
// body in two zones (PRD §6): the Head (evergreen — "what this is, why, scope",
// overwritten as understanding changes) and the Story (accreting — a dated
// record of how the project progressed, readable alone as a post-mortem). The
// activity log is the skeleton; "bring the Story up to date" reads the events
// since the last weave and proposes prose the human edits. The machine supplies
// "what happened when"; the human keeps "why it mattered" — pure-auto narration
// is rejected (PRD §6).
//
// Principle 3 / ADR-087: the deterministic parts (gather the events, build the
// skeleton, append + version) live here; the optional PROSE polish is a
// Claude-over-MCP step (the model reads the events and rewrites the skeleton into
// narrative, the user accepts) — NOT an in-app LLM call, so no new dependency.
import { bodyMarkdown, makeMarkdownBody } from "@/lib/body";
import { emitActivity, lastWovenAt } from "@/lib/activity";
import { getItem } from "@/lib/items";
import { updateItem } from "@/lib/item-mutations";
import { listActivity } from "@/lib/activity";

const STORY_HEADING = "## Story";
const STORY_RE = /^##\s+Story\s*$/im;

// Split a body into the Head (everything before the Story heading) and the Story
// (everything after). No Story heading yet → all Head, empty Story.
export function splitHeadStory(md: string): { head: string; story: string } {
  const m = md.match(STORY_RE);
  if (!m || m.index === undefined) return { head: md, story: "" };
  const head = md.slice(0, m.index).replace(/\s+$/, "");
  const story = md.slice(m.index + m[0].length).replace(/^\s+/, "");
  return { head, story };
}

// Append lines to the Story zone, creating the "## Story" heading if absent. The
// Head is untouched (it's overwritten only by direct editing).
export function appendToStory(md: string, lines: string[]): string {
  if (lines.length === 0) return md;
  const block = lines.join("\n");
  if (STORY_RE.test(md)) {
    return `${md.replace(/\s+$/, "")}\n${block}\n`;
  }
  const base = md.replace(/\s+$/, "");
  return `${base ? `${base}\n\n` : ""}${STORY_HEADING}\n\n${block}\n`;
}

// A deterministic Story skeleton from activity events: one dated bullet per
// event summary, oldest first. This is the "what happened when" the human (or a
// Claude-over-MCP polish step) turns into prose.
export function buildStorySkeleton(
  events: { summary: string; occurredAt: Date }[]
): string[] {
  return [...events]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((e) => {
      const day = e.occurredAt.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      return `- ${day}: ${e.summary}`;
    });
}

// The activity events not yet woven into the Story (since the last overview_woven).
export async function gatherUnwoven(ownerId: string, recordId: string) {
  const since = await lastWovenAt(ownerId, recordId);
  const events = await listActivity(ownerId, recordId, 200);
  const fresh = since ? events.filter((e) => e.occurredAt > since) : events;
  // listActivity is newest-first; the skeleton sorts oldest-first itself.
  return fresh.map((e) => ({ summary: e.summary, occurredAt: e.occurredAt }));
}

// Weave the given prose lines into the record's Story, version it, and stamp the
// weave (PRD §6). updateItem snapshots a revision on the body change automatically
// (ADR-104 only skips a NO-OP body), so versioning is free; overview_woven
// advances the derived last_woven_at. `lines` is the edited proposal (skeleton or
// MCP-polished prose) the human accepted.
export async function weaveStory(
  ownerId: string,
  recordId: string,
  lines: string[]
): Promise<{ woven: number }> {
  if (lines.length === 0) return { woven: 0 };
  const item = await getItem(ownerId, recordId);
  const next = appendToStory(bodyMarkdown(item.body), lines);
  await updateItem(ownerId, recordId, { body: makeMarkdownBody(next) });
  await emitActivity({
    ownerId,
    subjectId: recordId,
    kind: "overview_woven",
    summary: `Wove ${lines.length} update${lines.length === 1 ? "" : "s"} into the Story`,
    payload: { lines: lines.length },
  }).catch(() => {});
  return { woven: lines.length };
}

// Propose (don't commit) the Story update: the unwoven events as an editable
// skeleton. The caller (UI or MCP) edits, then calls weaveStory to accept.
export async function proposeStoryUpdate(ownerId: string, recordId: string) {
  const events = await gatherUnwoven(ownerId, recordId);
  return { skeleton: buildStorySkeleton(events), eventCount: events.length };
}
