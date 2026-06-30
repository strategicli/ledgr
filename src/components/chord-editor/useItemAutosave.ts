// Debounced patch autosave against PATCH /api/items/:id — the same contract
// ItemEditor uses (queue partial patches, coalesce in-flight edits, flush on
// unmount/pagehide via keepalive so closing the modal mid-debounce never loses
// an edit). Extracted as a hook so the chord editor reuses it without dragging
// in the markdown editor.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setKnownVersion } from "@/lib/save-status";

const SAVE_DEBOUNCE_MS = 1200;

export type SaveState = "saved" | "dirty" | "saving" | "error";

export function useItemAutosave(itemId: string) {
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    if (Object.keys(patch).length === 0 || inFlight.current) return;
    pending.current = {};
    inFlight.current = true;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(String(res.status));
      // Advance the canvas's refresh-on-focus baseline (ADR-134) to our own
      // write, so a refocus right after saving doesn't read it as a change made
      // on another device. (The body-write conflict guard is the markdown
      // editor's; chord/paper rely on this focus check.)
      const data = (await res.json().catch(() => null)) as {
        item?: { updatedAt?: string };
      } | null;
      if (data?.item?.updatedAt) setKnownVersion(data.item.updatedAt);
      setSaveState(Object.keys(pending.current).length ? "dirty" : "saved");
    } catch {
      pending.current = { ...patch, ...pending.current };
      setSaveState("error");
    } finally {
      inFlight.current = false;
      if (Object.keys(pending.current).length) scheduleRef.current();
    }
  }, [itemId]);

  const schedule = useCallback(() => {
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [flush]);

  // flush() references schedule() in its retry tail; keep a stable ref.
  const scheduleRef = useRef(schedule);
  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  // Queue a partial patch and (re)arm the debounce.
  const patch = useCallback(
    (fields: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...fields };
      schedule();
    },
    [schedule]
  );

  // Flush the last edit if the page/component goes away inside the debounce.
  useEffect(() => {
    const beacon = () => {
      const p = pending.current;
      if (Object.keys(p).length === 0) return;
      pending.current = {};
      void fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", beacon);
    return () => {
      window.removeEventListener("pagehide", beacon);
      beacon();
    };
  }, [itemId]);

  return { patch, saveState };
}
