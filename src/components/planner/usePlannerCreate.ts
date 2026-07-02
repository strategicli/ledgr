// Create-where-you-click for the Planner (Slice 2). Clicking an empty slot
// (time-grid) or double-clicking a day (month) captures a task right where you
// planned it: POST /api/items with type=task, the typed title, the placement's
// scheduled_date, and — for a timed slot — properties.scheduledTime. Reuses the
// same create route NewItemButton uses; no navigation, we stay on the calendar
// and router.refresh() to fold the new task into the grid.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Notify = (text: string, undo?: () => void) => void;

export type CreateAt = {
  ymd: string;
  // "HH:MM" floating local start, or null for an all-day (day-only) task.
  start: string | null;
  durationMinutes: number;
};

const ymdToIso = (ymd: string) => `${ymd}T00:00:00.000Z`;

export function usePlannerCreate(notify: Notify) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Returns true on success so the caller can clear its inline input.
  async function create(at: CreateAt, rawTitle: string): Promise<boolean> {
    const title = rawTitle.trim();
    if (!title || busy) return false;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        type: "task",
        title,
        scheduledDate: ymdToIso(at.ymd),
      };
      if (at.start) {
        body.properties = {
          scheduledTime: { start: at.start, durationMinutes: at.durationMinutes },
        };
      }
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
      return true;
    } catch {
      notify("Couldn’t create the task — try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { create, busy };
}
