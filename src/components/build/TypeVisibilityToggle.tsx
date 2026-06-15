// Show/hide a type from the everyday surfaces (ADR-059). A small eye toggle on
// each Build → Types row; flips types.hidden via POST /api/types/[key]/hidden,
// then refreshes so the nav/tabs/capture update right away. Hiding never touches
// the type's items — it's purely a visibility flag.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  );
}

export default function TypeVisibilityToggle({
  typeKey,
  hidden,
}: {
  typeKey: string;
  hidden: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/types/${typeKey}/hidden`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: !hidden }),
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
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={hidden}
      title={hidden ? "Hidden — click to show" : "Visible — click to hide"}
      className={`shrink-0 rounded p-1.5 disabled:opacity-50 ${
        hidden
          ? "text-neutral-600 hover:bg-neutral-800 hover:text-neutral-300"
          : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      }`}
    >
      <EyeIcon off={hidden} />
    </button>
  );
}
