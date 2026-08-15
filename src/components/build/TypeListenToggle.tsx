// The "Listen" column control on the Build → Types page: a checkbox that flips
// whether the type's items get a Listen (read-aloud) control on the canvas,
// mirroring TypeQuickCaptureToggle exactly. A second, nested checkbox — only
// rendered/enabled when Listen is on — flips whether Listen redirects to
// Microsoft Edge instead of playing locally. Both POST to
// /api/types/[key]/listen, then refresh so the canvas reflects it.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TypeListenToggle({
  typeKey,
  listenEnabled,
  listenOpenInEdge,
}: {
  typeKey: string;
  listenEnabled: boolean;
  listenOpenInEdge: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const post = async (body: Record<string, boolean>) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/types/${typeKey}/listen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      // Don't fail silently (Principle 9): a failed click left the box snapped
      // back with no signal. Mark it so the no-op is visible.
      setError(true);
      setTimeout(() => setError(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex flex-col items-center gap-1">
      <input
        type="checkbox"
        checked={listenEnabled}
        onChange={() => void post({ listenEnabled: !listenEnabled })}
        disabled={busy}
        aria-label="Listen (read-aloud)"
        title={
          error
            ? "Couldn't save, click to try again"
            : listenEnabled
              ? "Listen is on, click to remove"
              : "Listen is off, click to add"
        }
        className={`ledgr-check shrink-0 disabled:opacity-50 ${
          error ? "outline outline-1 outline-red-500" : ""
        }`}
      />
      {/* Nested: only meaningful (and only shown enabled) once Listen is on. */}
      <input
        type="checkbox"
        checked={listenOpenInEdge}
        onChange={() => void post({ listenOpenInEdge: !listenOpenInEdge })}
        disabled={busy || !listenEnabled}
        aria-label="Open in Edge for Listen"
        title="When on, the Listen control opens this item in Microsoft Edge, which has better free voices."
        className="ledgr-check shrink-0 disabled:opacity-30"
      />
    </span>
  );
}
