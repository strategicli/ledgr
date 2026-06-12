// Global quick capture (PRD §4.4): title-only creation, type defaults to
// task, date and urgency optional inline (entity assignment joins when the
// backlinks slice builds the relations write path). Captures always arrive
// untriaged (inbox: true) even with fields set: per ADR-010, leaving the
// Inbox is a deliberate act, never a side effect.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { URGENCIES } from "@/lib/item-enums";

const fieldClass =
  "rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-xs text-neutral-300 outline-none focus:border-neutral-600";

export default function CaptureModal({
  typeOptions,
  onClose,
}: {
  typeOptions: { key: string; label: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState("task");
  const [due, setDue] = useState("");
  const [urgency, setUrgency] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  useEffect(() => {
    titleRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      // Claim Esc in the capture phase: this modal can sit above the item
      // canvas modal (which closes on any unclaimed Esc at document level,
      // ADR-007), and one Esc must close only the topmost layer.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function capture() {
    const title = titleRef.current?.value.trim();
    if (!title || state === "busy") return;
    setState("busy");
    const body: Record<string, unknown> = { type, title, inbox: true };
    // Due dates are calendar days stored as UTC midnight (ADR-008).
    if (due) body.dueDate = `${due}T00:00:00.000Z`;
    if (urgency) body.urgency = urgency;
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
      onClose();
    } catch {
      setState("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[18vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Quick capture"
    >
      <div
        className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={titleRef}
          type="text"
          placeholder="Capture…"
          aria-label="Title"
          disabled={state === "busy"}
          onKeyDown={(e) => {
            if (e.key === "Enter") void capture();
          }}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Type"
            className={fieldClass}
          >
            {typeOptions.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due date"
            className={`${fieldClass} [color-scheme:dark]`}
          />
          <select
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
            aria-label="Urgency"
            className={fieldClass}
          >
            <option value="">urgency</option>
            {URGENCIES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <span className="ml-auto text-xs text-neutral-600">
            {state === "error"
              ? "Failed, Enter to retry"
              : "Enter to capture · Esc to close"}
          </span>
        </div>
      </div>
    </div>
  );
}
