// Complete-in-place for the Planner (Slice 1). Both grids and the rail need to
// mark a task done without leaving the calendar. Shared here so the optimistic
// pattern matches commitDrop: an override map paints the change immediately,
// then PATCH /api/items/[id] sets the status key, then router.refresh() (which
// drops the now-done task from the active-filtered list); a failed write reverts.
//
// The undo closure captures the id + previous status key at click time, so
// "Undo" works even after the refresh has removed the item from the list.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  SYSTEM_DEFAULT_STATUSES,
  categoryOfStatus,
  defaultStatusKey,
  initialStatusKey,
  type StatusDef,
} from "@/lib/status";
import type { ViewItem } from "@/components/views/ViewRenderer";

type Notify = (text: string, undo?: () => void) => void;

export function usePlannerComplete(statuses: StatusDef[] | undefined, notify: Notify) {
  const router = useRouter();
  // id → the status key we've optimistically written (so done styling shows
  // before the refresh). Never removed on success — the item leaves the list.
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>({});

  const schema = statuses && statuses.length ? statuses : SYSTEM_DEFAULT_STATUSES;
  const doneKey = defaultStatusKey(schema, "done") ?? "done";
  const activeKey = defaultStatusKey(schema, "not_started") ?? initialStatusKey(schema);

  const effectiveStatus = (item: ViewItem): string =>
    Object.prototype.hasOwnProperty.call(statusOverride, item.id)
      ? statusOverride[item.id]
      : item.status;

  const effectiveDone = (item: ViewItem): boolean =>
    categoryOfStatus(schema, effectiveStatus(item)) === "done";

  async function apply(id: string, toKey: string) {
    setStatusOverride((o) => ({ ...o, [id]: toKey }));
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: toKey }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setStatusOverride((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
    }
  }

  // Toggle: an active task completes; an already-done one (optimistically shown)
  // returns to the active default. The common case on the Planner is completing.
  function toggle(item: ViewItem) {
    const wasDone = effectiveDone(item);
    const fromKey = effectiveStatus(item);
    const toKey = wasDone ? activeKey : doneKey;
    apply(item.id, toKey);
    if (!wasDone) {
      notify(`Completed “${item.title || "Untitled"}”`, () => apply(item.id, fromKey));
    }
  }

  return { effectiveDone, toggle };
}
