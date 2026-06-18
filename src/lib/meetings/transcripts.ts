// Meeting transcripts (meeting recording v1a, ADR-087). A meeting's transcript
// is its own `transcript` item, not a region of the meeting body — so a
// 20k–35k-word transcript never swamps the human-facing doc, and a meeting can
// carry several. Two links tie it to its meeting, deliberately:
//
//   1. parent_id = the meeting (containment): the transcript travels with the
//      meeting on soft-delete (the subtask cascade) and reads as "belongs to".
//   2. a confirmed `relations` edge meeting→transcript, role "transcript"
//      (association): parent/child is invisible to the relations graph, but the
//      Claude-over-MCP flow and the Related panel traverse edges. With the edge,
//      get_item(meeting) lists its transcripts and list_items(relatedTo) finds
//      them — so "pull a meeting's transcripts" is one hop for the model.
//
// Both are written here so the invariant can't drift: a transcript without its
// edge would be invisible to the automation. Creation reuses parseItemPayload +
// createItem (the same validation path as /api/items and MCP), and stamps
// properties.minutes = "none" so the index-backed awaiting-minutes filter
// matches from the start.
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { makeMarkdownBody } from "@/lib/body";
import { parseItemPayload } from "@/lib/item-input";
import { ItemError, createItem } from "@/lib/items";
import { relateItems } from "@/lib/relations";

export const TRANSCRIPT_TYPE = "transcript";
// The relations role tying a transcript to its meeting (an edge, distinct from
// the parent_id containment). Not a typed relation property — a plain confirmed
// edge, so it shows in the meeting's Related panel and the MCP graph for free.
export const TRANSCRIPT_RELATION_ROLE = "transcript";

// The "needs minutes" signal on a transcript (a `select` property, schema seeded
// on the type). none = no minutes yet (the automation's work queue); draft =
// minutes generated, awaiting review; done = reviewed/confirmed.
export const MINUTES_PROP = "minutes";
export const MINUTES_STATES = ["none", "draft", "done"] as const;
export type MinutesState = (typeof MINUTES_STATES)[number];

// The audio-transcription sub-state (v1b) read off properties.transcription, so
// the panel can show "Transcribing…"/"Failed" before minutes are even relevant.
// Read inline (not imported from transcription-service, which imports this file)
// to avoid a cycle.
export type TranscriptionPhase = "queued" | "processing" | "completed" | "error";

export type TranscriptSummary = {
  id: string;
  title: string;
  minutes: MinutesState;
  transcription: { status: TranscriptionPhase; error: string | null } | null;
  wordCount: number;
  updatedAt: Date;
};

function minutesOf(properties: unknown): MinutesState {
  const v = (properties as Record<string, unknown> | null)?.[MINUTES_PROP];
  return (MINUTES_STATES as readonly string[]).includes(v as string)
    ? (v as MinutesState)
    : "none";
}

function transcriptionOf(
  properties: unknown
): { status: TranscriptionPhase; error: string | null } | null {
  const t = (properties as Record<string, unknown> | null)?.transcription as
    | Record<string, unknown>
    | undefined;
  const s = t?.status;
  if (s !== "queued" && s !== "processing" && s !== "completed" && s !== "error") return null;
  return { status: s, error: typeof t?.error === "string" ? t.error : null };
}

// The meeting's transcripts, newest-edited first. Body-free (the word count is
// computed in SQL off body_text, never shipping the transcript text to a list).
export async function listMeetingTranscripts(
  ownerId: string,
  meetingId: string
): Promise<TranscriptSummary[]> {
  const rows = await getDb()
    .select({
      id: items.id,
      title: items.title,
      properties: items.properties,
      updatedAt: items.updatedAt,
      // POSIX whitespace class (no backslash escaping); empty body → 0, not 1.
      wordCount: sql<number>`case when btrim(coalesce(${items.bodyText}, '')) = '' then 0 else coalesce(array_length(regexp_split_to_array(btrim(${items.bodyText}), '[[:space:]]+'), 1), 0) end`,
    })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.parentId, meetingId),
        eq(items.type, TRANSCRIPT_TYPE),
        isNull(items.deletedAt)
      )
    )
    .orderBy(sql`${items.updatedAt} desc`);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    minutes: minutesOf(r.properties),
    transcription: transcriptionOf(r.properties),
    wordCount: Number(r.wordCount ?? 0),
    updatedAt: r.updatedAt,
  }));
}

// Create a transcript under a meeting: the child item (body = the pasted/edited
// markdown, minutes=none) plus the confirmed meeting→transcript edge. The parent
// must be the owner's live meeting — a transcript only hangs off a meeting.
export async function createTranscript(
  ownerId: string,
  meetingId: string,
  opts: { title?: string; text?: string }
) {
  const parent = await getDb()
    .select({ id: items.id, type: items.type })
    .from(items)
    .where(
      and(eq(items.id, meetingId), eq(items.ownerId, ownerId), isNull(items.deletedAt))
    );
  if (parent.length === 0) throw new ItemError("not_found", "meeting not found");
  if (parent[0].type !== "meeting") {
    throw new ItemError("bad_request", "transcripts attach to a meeting");
  }

  const title = opts.title?.trim() || "Transcript";
  const input = parseItemPayload(
    {
      type: TRANSCRIPT_TYPE,
      parentId: meetingId,
      title,
      body: makeMarkdownBody(opts.text ?? ""),
      properties: { [MINUTES_PROP]: "none" },
    },
    "create"
  );
  const created = await createItem(ownerId, input);
  await relateItems(ownerId, meetingId, created.id, TRANSCRIPT_RELATION_ROLE);
  return created;
}
