// Meeting picker for a shared-in transcript (Android share-target file path).
// Lists recent meetings with a type-to-filter box; pick one to attach the
// transcript to it, or create a new meeting from it. On success it navigates to
// the meeting, where the transcript shows in the Transcripts panel. Pure client
// glue over POST /api/transcripts/[id]/attach.
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Meeting = { id: string; title: string; meetingAt: string | null };

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default function TranscriptMeetingPicker({
  transcriptId,
  defaultMeetingTitle,
  meetings,
}: {
  transcriptId: string;
  defaultMeetingTitle: string;
  meetings: Meeting[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState(defaultMeetingTitle);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter((m) => m.title.toLowerCase().includes(q));
  }, [meetings, query]);

  async function attach(payload: { meetingId: string } | { newMeetingTitle: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transcripts/${transcriptId}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? `couldn't attach (${res.status})`);
      }
      const { meetingId } = await res.json();
      router.push(`/items/${meetingId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't attach");
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={busy}
        placeholder="Search your meetings…"
        className="w-full rounded border border-neutral-700 bg-transparent px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      />

      <ul className="mt-2 flex max-h-80 flex-col gap-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="px-1 py-2 text-sm text-neutral-600">
            No meetings match “{query}”.
          </li>
        ) : (
          filtered.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => attach({ meetingId: m.id })}
                disabled={busy}
                className="flex w-full items-baseline justify-between gap-3 rounded px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
              >
                <span className="min-w-0 truncate">{m.title}</span>
                {m.meetingAt && (
                  <span className="shrink-0 text-xs text-neutral-600">
                    {dateFmt.format(new Date(m.meetingAt))}
                  </span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>

      <div className="mt-4 border-t border-neutral-800 pt-3">
        {creating ? (
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              disabled={busy}
              placeholder="New meeting name"
              className="w-full rounded border border-neutral-700 bg-transparent px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const t = newTitle.trim();
                  if (t) attach({ newMeetingTitle: t });
                }}
                disabled={busy || !newTitle.trim()}
                className="rounded bg-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create meeting & attach"}
              </button>
              <button
                onClick={() => setCreating(false)}
                disabled={busy}
                className="text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            disabled={busy}
            className="rounded px-1 text-sm text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
          >
            ＋ Create a new meeting from this transcript
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
