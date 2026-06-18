// Star affordance to add/remove a task from today's focus (T3, ADR-073). One
// tap day-stamps the task (properties.focus = { date: today, order }) or clears
// it. Optimistic + refresh (the SubtaskCheckbox pattern). `order` uses the click
// instant so later picks sort after earlier ones in the focus zone.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { beginSave, endSave } from "@/lib/save-status";

export default function FocusStar({
  itemId,
  focused,
  today,
}: {
  itemId: string;
  focused: boolean;
  today: string; // YYYY-MM-DD (app timezone)
}) {
  const router = useRouter();
  const [on, setOn] = useState(focused);
  const [prev, setPrev] = useState(focused);
  if (focused !== prev) {
    setPrev(focused);
    setOn(focused);
  }

  async function toggle() {
    const next = !on;
    setOn(next);
    beginSave();
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // null clears the marker; a fresh order (click instant) appends it after
        // earlier picks. propertyPatch leaves the task's other properties intact.
        body: JSON.stringify({
          propertyPatch: { focus: next ? { date: today, order: Date.now() } : null },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      endSave(true);
      router.refresh();
    } catch {
      setOn(!next);
      endSave(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={on ? "Remove from today's focus" : "Add to today's focus"}
      aria-pressed={on}
      title={on ? "In today's focus" : "Add to today's focus"}
      className={`shrink-0 text-sm leading-none transition-colors ${
        on ? "text-[var(--accent)]" : "text-neutral-600 hover:text-neutral-300"
      }`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
