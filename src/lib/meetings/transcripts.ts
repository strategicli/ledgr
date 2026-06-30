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
import { ItemError, createItem, updateItem } from "@/lib/items";
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
  if (parent.length === 0) throw new ItemError("not_found", "event not found");
  if (parent[0].type !== "event") {
    throw new ItemError("bad_request", "transcripts attach to an event");
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

// Capture a transcript that has no meeting yet (the Android share-target path):
// a `transcript` item with the shared file's text, inbox: true and NO parent.
// It's a real, persisted item the moment the file is shared, so the text can't
// be lost even if the owner backs out of the meeting picker — it just sits in
// the Inbox like any untriaged capture. attachTranscriptToMeeting then wires it
// to the chosen meeting (the parent + edge createTranscript would have set).
export async function createInboxTranscript(
  ownerId: string,
  opts: { title?: string; text?: string }
) {
  const title = opts.title?.trim() || "Transcript";
  const input = parseItemPayload(
    {
      type: TRANSCRIPT_TYPE,
      title,
      body: makeMarkdownBody(opts.text ?? ""),
      properties: { [MINUTES_PROP]: "none" },
      inbox: true,
    },
    "create"
  );
  return createItem(ownerId, input);
}

// Attach an inbox transcript (createInboxTranscript) to a meeting, completing
// the same two links createTranscript writes up front: parent_id = the meeting
// (containment) + the confirmed meeting→transcript edge (association). Clearing
// inbox triages it out of the capture queue. Validates both ends are the owner's
// live items and that the parent is an event and the child a transcript, so the
// share picker can't wire a transcript onto a non-meeting.
export async function attachTranscriptToMeeting(
  ownerId: string,
  transcriptId: string,
  meetingId: string
) {
  const rows = await getDb()
    .select({ id: items.id, type: items.type })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt),
        sql`${items.id} in (${transcriptId}, ${meetingId})`
      )
    );
  const meeting = rows.find((r) => r.id === meetingId);
  const transcript = rows.find((r) => r.id === transcriptId);
  if (!meeting) throw new ItemError("not_found", "event not found");
  if (meeting.type !== "event") {
    throw new ItemError("bad_request", "transcripts attach to an event");
  }
  if (!transcript) throw new ItemError("not_found", "transcript not found");
  if (transcript.type !== TRANSCRIPT_TYPE) {
    throw new ItemError("bad_request", "not a transcript");
  }

  await updateItem(ownerId, transcriptId, { parentId: meetingId, inbox: false });
  await relateItems(ownerId, meetingId, transcriptId, TRANSCRIPT_RELATION_ROLE);
}

// Recent meetings for the share picker: newest meeting time first (then newest
// edited for undated events), body-free. The owner taps one to attach a shared
// transcript to it.
export async function listRecentMeetingsForPicker(
  ownerId: string,
  limit = 30
): Promise<
  {
    id: string;
    title: string;
    meetingAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }[]
> {
  const rows = await getDb()
    .select({
      id: items.id,
      title: items.title,
      meetingAt: items.meetingAt,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.type, "event"),
        isNull(items.deletedAt)
      )
    )
    .orderBy(sql`${items.meetingAt} desc nulls last`, sql`${items.updatedAt} desc`)
    .limit(limit);
  return rows;
}
