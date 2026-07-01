import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { resolveOwner } from "@/lib/owner";
import {
  TRANSCRIPT_TYPE,
  listRecentMeetingsForPicker,
} from "@/lib/meetings/transcripts";
import TranscriptMeetingPicker from "@/components/capture/TranscriptMeetingPicker";

// Meeting picker for a transcript shared in from Android (the share-target file
// path). /capture/share captured the file as an inbox transcript and sent the
// owner here to choose where it belongs. Picking a meeting (or making a new one)
// attaches the transcript and lands on the meeting. Backing out is safe: the
// transcript stays in the Inbox, nothing is lost.
export const dynamic = "force-dynamic";

export default async function TranscriptSharePicker({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { id } = await params;
  const rows = await getDb()
    .select({
      id: items.id,
      title: items.title,
      type: items.type,
      parentId: items.parentId,
      bodyText: items.bodyText,
    })
    .from(items)
    .where(and(eq(items.id, id), eq(items.ownerId, owner.id), isNull(items.deletedAt)));

  const transcript = rows[0];
  // Gone, not a transcript, or already attached to a meeting → there's nothing
  // to pick; show the item itself (or home) instead of an empty picker.
  if (!transcript) redirect("/");
  if (transcript.type !== TRANSCRIPT_TYPE || transcript.parentId) {
    redirect(`/items/${transcript.id}`);
  }

  const meetings = await listRecentMeetingsForPicker(owner.id);
  const text = (transcript.bodyText ?? "").trim();
  const wordCount = text ? text.split(/\s+/).length : 0;
  const preview = text.length > 280 ? `${text.slice(0, 280)}…` : text;

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        Shared transcript
      </p>
      <h1 className="mt-1 text-lg font-medium text-neutral-100">
        {transcript.title || "Transcript"}
      </h1>
      <p className="mt-1 text-xs text-neutral-500">
        {wordCount.toLocaleString()} words · saved to your Inbox
      </p>
      {preview && (
        <p className="mt-3 max-h-24 overflow-hidden rounded border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-400">
          {preview}
        </p>
      )}

      <h2 className="mt-6 text-sm font-medium text-neutral-300">
        Add this transcript to a meeting
      </h2>
      <TranscriptMeetingPicker
        transcriptId={transcript.id}
        defaultMeetingTitle={transcript.title || "Meeting"}
        meetings={meetings.map((m) => ({
          id: m.id,
          title: m.title || "Untitled",
          meetingAt: m.meetingAt ? m.meetingAt.toISOString() : null,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
        }))}
      />
    </main>
  );
}
