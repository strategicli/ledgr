// Transcript panel on the meeting canvas (meeting recording v1a/v1b, ADR-087/088).
// Lists the meeting's transcripts (each its own item) with their minutes state —
// or, for one still transcribing from uploaded audio, a "Transcribing…" badge.
// Offers paste-to-create (v1a) and, when transcription is configured, audio
// upload (v1b). Editing a transcript opens the item itself (the full markdown
// editor + the Minutes dropdown), so a long transcript edits in place without
// bloating the meeting body. Server component, mirrors MeetingPrep.
import Link from "next/link";
import {
  listMeetingTranscripts,
  type MinutesState,
} from "@/lib/meetings/transcripts";
import { getTranscription } from "@/lib/transcription/provider";
import CanvasSection from "@/components/canvas/CanvasSection";
import AddTranscript from "./AddTranscript";
import UploadTranscript from "./UploadTranscript";
import AudioUpload from "./AudioUpload";
import TranscriptionPoller from "./TranscriptionPoller";

const tsFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const MINUTES_BADGE: Record<MinutesState, { label: string; className: string }> = {
  none: { label: "No minutes yet", className: "bg-neutral-800 text-neutral-400" },
  draft: { label: "Minutes: draft", className: "bg-amber-900/40 text-amber-300" },
  done: { label: "Minutes ✓", className: "bg-emerald-900/40 text-emerald-300" },
};

export default async function MeetingTranscripts({
  ownerId,
  itemId,
  // Rendered as a single grid card (ADR-069): drop the section card chrome.
  bare = false,
  // Render collapsed by default (event canvas, Brandon 2026-07-10): a meeting's
  // transcript is opened rarely, so the section starts closed.
  collapsed = false,
}: {
  ownerId: string;
  itemId: string;
  bare?: boolean;
  collapsed?: boolean;
}) {
  const transcripts = await listMeetingTranscripts(ownerId, itemId);
  const transcriptionEnabled = getTranscription() != null;
  // Transcripts with a still-running job — the live client-poll's work list.
  const pendingIds = transcripts
    .filter((t) => t.transcription?.status === "queued" || t.transcription?.status === "processing")
    .map((t) => t.id);

  return (
    <>
      <CanvasSection
        bare={bare}
        icon="document"
        title="Transcripts"
        count={transcripts.length || undefined}
        defaultOpen={collapsed ? false : undefined}
      >
      {transcripts.length === 0 ? (
        <p className="mt-2 px-2 text-sm text-neutral-600">
          {transcriptionEnabled
            ? "Paste a transcript, upload a transcript file, or upload audio to transcribe it. Claude turns transcripts awaiting minutes into draft minutes and suggested tasks."
            : "Paste a transcript or upload a transcript file to capture what was said. Claude turns transcripts awaiting minutes into draft minutes and suggested tasks."}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {transcripts.map((t) => {
            const phase = t.transcription?.status;
            const transcribing = phase === "queued" || phase === "processing";
            const failed = phase === "error";
            const badge = transcribing
              ? { label: "Transcribing…", className: "bg-sky-900/40 text-sky-300" }
              : failed
                ? { label: "Transcription failed", className: "bg-red-900/40 text-red-300" }
                : MINUTES_BADGE[t.minutes];
            return (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2 text-sm">
                <Link href={`/items/${t.id}`} className="text-neutral-300 hover:underline">
                  {t.title || "Untitled"}
                </Link>
                <span className={`rounded px-1.5 py-0.5 text-xs ${badge.className}`}>
                  {badge.label}
                </span>
                {failed && t.transcription?.error && (
                  <span className="text-xs text-red-400">{t.transcription.error}</span>
                )}
                {!transcribing && !failed && (
                  <span className="text-xs text-neutral-600">
                    {t.wordCount.toLocaleString()} words
                  </span>
                )}
                <span className="text-xs text-neutral-700">{tsFmt.format(t.updatedAt)}</span>
              </li>
            );
          })}
        </ul>
      )}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <AddTranscript meetingId={itemId} />
          <UploadTranscript meetingId={itemId} />
          {transcriptionEnabled && <AudioUpload meetingId={itemId} />}
        </div>
      </CanvasSection>

      {pendingIds.length > 0 && <TranscriptionPoller ids={pendingIds} />}
    </>
  );
}
