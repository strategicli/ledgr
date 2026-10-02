// Year Map editing (ADR-287 slice 2): drag a bar to move it, drag its ends to
// resize, drag across empty days (or double-click one) to create. Every write
// goes through placement.ts `buildPatch`, the same path the Timeline uses, so
// the map writes exactly the fields its view places by.
//
// Hit testing is by day cell: each `.ym-day` carries its date, and the pointer
// asks the document which cell it is over. That works across month rows and in
// both column alignments with no geometry of its own.
//
// Touch: press and hold (the planner's LONG_PRESS_MS) arms a move drag on a bar or
// a new item on an empty day; moving before that is a scroll. Edge handles stay
// mouse/pen only, since they are too small for a finger.
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/ui/ActionToast";
import { buildPatch, type PlaceableItem, type PlacementSpec } from "@/lib/placement";
import { exceedsMoveThreshold, LONG_PRESS_MS } from "@/lib/board-touch-drag";
import { dragSpan, fmtSpan, type DaySpan, type DragKind } from "./lib";

export type YearEdit = {
  item: PlaceableItem;
  specIdx: number;
  startMin: number | null;
  endMin: number | null;
  hasEnd: boolean;
  can: { move: boolean; resizeStart: boolean; resizeEnd: boolean };
  stretch: boolean;
};
type Editable = { id: string; title: string; start: string; end: string; edit?: YearEdit };

const MOVE_THRESHOLD = 4; // px before a press counts as a drag, not a click

function dayAt(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const ymd = (el as HTMLElement).dataset?.ymd;
    if (ymd) return ymd;
  }
  return null;
}

async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`/api/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  return !!res?.ok;
}

export function useYearEdit({ tz, specs, createType }: { tz: string; specs: PlacementSpec[]; createType: string }) {
  const router = useRouter();
  const [override, setOverride] = useState<Record<string, DaySpan>>({});
  const [draft, setDraft] = useState<DaySpan | null>(null);
  const [prompt, setPrompt] = useState<{ span: DaySpan; x: number; y: number } | null>(null);
  // Set when a press turned into a drag, so the click that follows doesn't open the item.
  const dragged = useRef(false);

  const primary = specs[0];
  const canCreate = !!primary && !("field" in primary.start && (primary.start.field === "createdAt" || primary.start.field === "updatedAt"));

  function bodyFor(e: Editable, span: DaySpan): Record<string, unknown> {
    const ed = e.edit!;
    const spec = specs[ed.specIdx];
    const withEnd = spec.end != null && (ed.hasEnd || span.end !== span.start);
    return buildPatch(ed.item, spec, tz, {
      start: { ymd: span.start, minutes: ed.startMin },
      end: withEnd ? { ymd: span.end, minutes: ed.hasEnd ? ed.endMin : null } : null,
    });
  }

  function commit(e: Editable, before: DaySpan, next: DaySpan) {
    setOverride((o) => ({ ...o, [e.id]: next }));
    void patch(e.id, bodyFor(e, next)).then((ok) => {
      if (!ok) {
        setOverride((o) => {
          const n = { ...o };
          delete n[e.id];
          return n;
        });
        showToast(`Couldn't move “${e.title}”.`);
        return;
      }
      router.refresh();
      showToast(`Moved “${e.title}” to ${fmtSpan(next)}`, () => {
        setOverride((o) => ({ ...o, [e.id]: before }));
        void patch(e.id, bodyFor(e, before)).then((r) => r && router.refresh());
      });
    });
  }

  // Touch press-and-hold, shared by bars and empty days. Before the hold, a move
  // past the tolerance hands the gesture back to the browser (a scroll). After it,
  // touchmove is cancelled so the page stays put while the finger drags.
  function touchHold(ev: React.PointerEvent, h: { arm(): void; move(x: number, y: number): void; end(x: number, y: number): void; cancel(): void }) {
    const from = { x: ev.clientX, y: ev.clientY };
    let armed = false;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    const timer = setTimeout(() => {
      armed = true;
      navigator.vibrate?.(10);
      h.arm();
    }, LONG_PRESS_MS);
    const stop = () => {
      clearTimeout(timer);
      ac.abort();
    };
    window.addEventListener("pointermove", (m) => {
      if (armed) return h.move(m.clientX, m.clientY);
      if (exceedsMoveThreshold(from, { x: m.clientX, y: m.clientY })) stop();
    }, opts);
    window.addEventListener("touchmove", (t) => { if (armed && t.cancelable) t.preventDefault(); }, { ...opts, passive: false });
    window.addEventListener("contextmenu", (c) => c.preventDefault(), opts);
    window.addEventListener("pointerup", (u) => {
      stop();
      if (armed) h.end(u.clientX, u.clientY);
    }, opts);
    window.addEventListener("pointercancel", () => {
      stop();
      if (armed) h.cancel();
    }, opts);
  }

  // A press on a bar (or one of its edge handles).
  function beginDrag(ev: React.PointerEvent, e: Editable, kind: DragKind) {
    if (ev.button !== 0 || !e.edit) return;
    if (ev.pointerType === "touch") {
      if (kind !== "move" || !e.edit.can.move) return;
      const grab = dayAt(ev.clientX, ev.clientY);
      if (!grab) return;
      const orig: DaySpan = override[e.id] ?? { start: e.start, end: e.end };
      let next = orig;
      dragged.current = false;
      touchHold(ev, {
        arm: () => { dragged.current = true; },
        move: (x, y) => {
          const at = dayAt(x, y);
          if (!at) return;
          next = dragSpan("move", orig, grab, at);
          setOverride((o) => ({ ...o, [e.id]: next }));
        },
        end: () => {
          // The click after a hold may never fire, so don't leave the guard set.
          setTimeout(() => { dragged.current = false; }, 400);
          if (next.start !== orig.start || next.end !== orig.end) commit(e, orig, next);
        },
        cancel: () => setOverride((o) => ({ ...o, [e.id]: orig })),
      });
      return;
    }
    const can = e.edit.can;
    if (kind === "move" && !can.move) return;
    if (kind === "start" && !(can.resizeStart || e.edit.stretch)) return;
    if (kind === "end" && !(can.resizeEnd || e.edit.stretch)) return;
    const grab = dayAt(ev.clientX, ev.clientY);
    if (!grab) return;
    ev.stopPropagation();
    const orig: DaySpan = override[e.id] ?? { start: e.start, end: e.end };
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    let next = orig;
    dragged.current = false;
    const ac = new AbortController();
    window.addEventListener("pointermove", (m) => {
      if (!dragged.current && Math.hypot(m.clientX - x0, m.clientY - y0) < MOVE_THRESHOLD) return;
      dragged.current = true;
      const at = dayAt(m.clientX, m.clientY);
      if (!at) return;
      next = dragSpan(kind, orig, grab, at);
      setOverride((o) => ({ ...o, [e.id]: next }));
    }, { signal: ac.signal });
    window.addEventListener("pointerup", () => {
      ac.abort();
      if (!dragged.current) return;
      if (next.start === orig.start && next.end === orig.end) return;
      commit(e, orig, next);
    }, { signal: ac.signal });
    window.addEventListener("pointercancel", () => {
      ac.abort();
      setOverride((o) => ({ ...o, [e.id]: orig }));
    }, { signal: ac.signal });
  }

  // A press on empty days: drag out a range, then name the new item.
  function beginCreate(ev: React.PointerEvent) {
    if (!canCreate || ev.button !== 0) return;
    if ((ev.target as HTMLElement).closest(".ym-bar")) return;
    const from = dayAt(ev.clientX, ev.clientY);
    if (!from) return;
    if (ev.pointerType === "touch") {
      // Hold lights the day; letting go opens the title box (focus needs that gesture).
      const day = { start: from, end: from };
      touchHold(ev, {
        arm: () => setDraft(day),
        move: () => {},
        end: (x, y) => setPrompt({ span: day, x, y }),
        cancel: () => setDraft(null),
      });
      return;
    }
    let span: DaySpan = { start: from, end: from };
    const ac = new AbortController();
    window.addEventListener("pointermove", (m) => {
      const at = dayAt(m.clientX, m.clientY);
      if (!at) return;
      span = at < from ? { start: at, end: from } : { start: from, end: at };
      setDraft(span.start === span.end ? null : span);
    }, { signal: ac.signal });
    window.addEventListener("pointerup", (u) => {
      ac.abort();
      if (span.start !== span.end) setPrompt({ span, x: u.clientX, y: u.clientY });
      else setDraft(null);
    }, { signal: ac.signal });
  }

  function createOnDay(ev: React.MouseEvent) {
    if (!canCreate || (ev.target as HTMLElement).closest(".ym-bar")) return;
    const ymd = dayAt(ev.clientX, ev.clientY);
    if (ymd) setPrompt({ span: { start: ymd, end: ymd }, x: ev.clientX, y: ev.clientY });
  }

  function cancelCreate() {
    setPrompt(null);
    setDraft(null);
  }

  async function create(title: string) {
    if (!prompt || !title.trim()) return cancelCreate();
    const { span } = prompt;
    const blank: PlaceableItem = {
      type: createType,
      scheduledDate: null,
      dueDate: null,
      meetingAt: null,
      endAt: null,
      noteDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      properties: {},
    };
    const p = buildPatch(blank, primary, tz, {
      start: { ymd: span.start, minutes: null },
      end: primary.end && span.end !== span.start ? { ymd: span.end, minutes: null } : null,
    });
    const { propertyPatch, ...fields } = p as { propertyPatch?: Record<string, unknown> };
    cancelCreate();
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: createType, title: title.trim(), ...fields, ...(propertyPatch ? { properties: propertyPatch } : {}) }),
    }).catch(() => null);
    if (res?.ok) router.refresh();
    else showToast("Couldn't add that item. Try again.");
  }

  return { override, draft, prompt, beginDrag, beginCreate, createOnDay, create, cancelCreate, dragged, canCreate };
}
