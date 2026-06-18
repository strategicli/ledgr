// Transcript panel on the meeting canvas (meeting recording v1a, ADR-087).
// Lists the meeting's transcripts (each its own item, ADR-087) with their
// minutes state, and offers the paste-to-create box. Editing a transcript opens
// the item itself (the full markdown editor + the Minutes dropdown), so a long
// transcript edits in place without bloating the meeting body. Server
// component, mirrors MeetingPrep; one listMeetingTranscripts call.
import Link from "next/link";
import {
  listMeetingTranscripts,
  type MinutesState,
} from "@/lib/meetings/transcripts";
import AddTranscript from "./AddTranscript";

const tsFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

// The minutes badge: the "needs minutes" signal at a glance. none = work to do,
// draft = generated/awaiting review, done = reviewed.
const MINUTES_BADGE: Record<MinutesState, { label: string; className: string }> = {
  none: { label: "No minutes yet", className: "bg-neutral-800 text-neutral-400" },
  draft: { label: "Minutes: draft", className: "bg-amber-900/40 text-amber-300" },
  done: { label: "Minutes ✓", className: "bg-emerald-900/40 text-emerald-300" },
};

export default async function MeetingTranscripts({
  ownerId,
  itemId,
}: {
  ownerId: string;
  itemId: string;
}) {
  const transcripts = await listMeetingTranscripts(ownerId, itemId);

  return (
    <section className="mx-auto w-full max-w-3xl px-12 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
        Transcripts {transcripts.length > 0 && `(${transcripts.length})`}
      </h3>

      {transcripts.length === 0 ? (
        <p className="mt-2 px-2 text-sm text-neutral-600">
          Paste a transcript to capture what was said. Claude turns transcripts
          awaiting minutes into draft minutes and suggested tasks.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {transcripts.map((t) => {
            const badge = MINUTES_BADGE[t.minutes];
            return (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2 text-sm">
                <Link href={`/items/${t.id}`} className="text-neutral-300 hover:underline">
                  {t.title || "Untitled"}
                </Link>
                <span className={`rounded px-1.5 py-0.5 text-xs ${badge.className}`}>
                  {badge.label}
                </span>
                <span className="text-xs text-neutral-600">
                  {t.wordCount.toLocaleString()} words
                </span>
                <span className="text-xs text-neutral-700">{tsFmt.format(t.updatedAt)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2">
        <AddTranscript meetingId={itemId} />
      </div>
    </section>
  );
}
