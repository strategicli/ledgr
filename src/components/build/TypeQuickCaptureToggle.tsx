// The "Quick Capture" column control on the Build → Types page: a circular
// checkbox that flips whether the type shows in the quick-capture dropdown
// (ADR-059). POSTs to /api/types/[key]/quick-capture, then refreshes so capture
// reflects it. (A hidden type stays out of capture regardless — the eye wins.)
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TypeQuickCaptureToggle({
  typeKey,
  showInQuickCapture,
}: {
  typeKey: string;
  showInQuickCapture: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/types/${typeKey}/quick-capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showInQuickCapture: !showInQuickCapture }),
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
    <input
      type="checkbox"
      checked={showInQuickCapture}
      onChange={toggle}
      disabled={busy}
      aria-label="Show in quick capture"
      title={
        error
          ? "Couldn't save, click to try again"
          : showInQuickCapture
            ? "In quick capture, click to remove"
            : "Not in quick capture, click to add"
      }
      className={`ledgr-check shrink-0 disabled:opacity-50 ${
        error ? "outline outline-1 outline-red-500" : ""
      }`}
    />
  );
}
