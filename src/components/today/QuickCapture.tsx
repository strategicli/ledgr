// Quick-capture box (PRD §4.2): title-only, type defaults to the catch-all
// `unmarked` (§4.4, ADR-067) so it never pre-assumes a task; Enter submits and
// keeps focus for rapid entry. Captures arrive untriaged
// (inbox: true) so they queue in the Inbox until assigned a date/entity.
// The global affordance, desktop shortcut, and share target are the
// quick-capture slice; this is just the box.
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { enqueueCapture } from "@/lib/outbox";

export default function QuickCapture() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "busy" | "error" | "offline">("idle");

  async function capture() {
    const title = inputRef.current?.value.trim();
    if (!title || state === "busy") return;
    const payload = { type: "unmarked", title, inbox: true };
    setState("busy");
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      if (inputRef.current) inputRef.current.value = "";
      setState("idle");
      router.refresh();
      inputRef.current?.focus();
    } catch {
      // Offline (or a transient failure): queue locally; the outbox syncs on
      // reconnect (T5, ADR-080) — capture never loses the thought.
      enqueueCapture(payload);
      window.dispatchEvent(new Event("ledgr:outbox"));
      if (inputRef.current) inputRef.current.value = "";
      setState("offline");
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        placeholder="Capture anything…"
        aria-label="Quick capture"
        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
        onKeyDown={(e) => {
          if (e.key === "Enter") void capture();
        }}
      />
      {state === "error" && (
        <span className="shrink-0 text-xs text-red-400">
          Failed, press Enter to retry
        </span>
      )}
      {state === "offline" && (
        <span className="shrink-0 text-xs text-neutral-500">
          Saved offline · will sync
        </span>
      )}
    </div>
  );
}
