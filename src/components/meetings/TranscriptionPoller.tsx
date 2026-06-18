// Live client-poll for in-flight transcriptions (meeting recording v1b,
// ADR-088). While the Transcript panel shows a transcribing transcript, this
// polls /api/transcription/[id]/status every few seconds (which advances the
// job server-side and returns its status); when one completes or errors, it
// refreshes the panel so the filled body / new badge shows. The cron backstop
// finishes any the user navigated away from. Renders nothing.
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 4000;

export default function TranscriptionPoller({ ids }: { ids: string[] }) {
  const router = useRouter();
  // Stable key of the pending set, so the effect re-arms only when it changes.
  const key = ids.join(",");
  const refreshing = useRef(false);

  useEffect(() => {
    if (ids.length === 0) return;
    let cancelled = false;

    async function tick() {
      let anyDone = false;
      for (const id of ids) {
        try {
          const res = await fetch(`/api/transcription/${id}/status`);
          if (!res.ok) continue;
          const { status } = await res.json();
          if (status === "completed" || status === "error") anyDone = true;
        } catch {
          // transient — try again next tick
        }
      }
      if (!cancelled && anyDone && !refreshing.current) {
        refreshing.current = true;
        router.refresh();
      }
    }

    const timer = setInterval(tick, POLL_MS);
    // A first tick soon after mount (don't wait a full interval).
    const lead = setTimeout(tick, 800);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(lead);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}
