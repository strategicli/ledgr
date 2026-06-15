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

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/types/${typeKey}/quick-capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showInQuickCapture: !showInQuickCapture }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      // leave as-is on failure
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
      title={showInQuickCapture ? "In quick capture — click to remove" : "Not in quick capture — click to add"}
      className="ledgr-check shrink-0 disabled:opacity-50"
    />
  );
}
