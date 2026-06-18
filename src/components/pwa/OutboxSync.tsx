// App-wide offline-capture flusher (T5, ADR-080). Mounted once in the root
// layout: it drains the capture outbox whenever connectivity is likely back —
// on mount, on the `online` event, and when the tab becomes visible again (iOS
// PWAs fire `online` unreliably, so visibility is the dependable trigger). When
// it syncs anything it refreshes so the freshly-synced items appear; a small
// pill shows the pending count while offline.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { flushOutbox, outboxCount } from "@/lib/outbox";

export default function OutboxSync() {
  const router = useRouter();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      if (outboxCount() === 0) {
        setPending(0);
        return;
      }
      const { synced, remaining } = await flushOutbox();
      if (cancelled) return;
      setPending(remaining);
      if (synced > 0) router.refresh();
    }

    // Other capture surfaces enqueue then dispatch this so the pill updates and
    // a flush is attempted immediately (it'll usually fail offline, harmlessly).
    function onQueued() {
      void sync();
    }

    void sync();
    window.addEventListener("online", onQueued);
    document.addEventListener("visibilitychange", onQueued);
    window.addEventListener("ledgr:outbox", onQueued);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onQueued);
      document.removeEventListener("visibilitychange", onQueued);
      window.removeEventListener("ledgr:outbox", onQueued);
    };
  }, [router]);

  if (pending <= 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-40 rounded-full border border-neutral-700 bg-neutral-900/90 px-3 py-1 text-xs text-neutral-400 shadow-lg">
      {pending} capture{pending === 1 ? "" : "s"} queued offline
    </div>
  );
}
