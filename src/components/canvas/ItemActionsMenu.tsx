// The item's "⋯" actions menu (top-right of the canvas, in both the modal
// header and the full-page chrome). It gathers the actions that used to sit
// loose in the chrome — Save as template, Apply template, Customize layout —
// behind one kebab so they collapse on mobile, and adds the lock toggle.
//
// Lock state lives in items.properties.locked (a per-key merge via
// propertyPatch, so it never clobbers a sibling property). A locked item's
// title, body, field strip, and properties all render read-only; the canvas
// reads the same flag and threads `locked` down to them.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SaveAsTemplateButton from "./SaveAsTemplateButton";
import ApplyTemplateButton from "./ApplyTemplateButton";

const rowClass =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-300 hover:bg-neutral-800";

export default function ItemActionsMenu({
  itemId,
  type,
  title,
  locked,
}: {
  itemId: string;
  type: string;
  title: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      // Sub-popovers (Save as template) and the Apply modal render inside this
      // wrapper, so clicks in them keep the menu open; an outside click closes.
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault(); // close the menu, not the parent modal underneath
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Flip items.properties.locked via a per-key merge, then refresh so the canvas
  // re-renders read-only (or editable again). Leaves the menu open on failure so
  // a transient error can be retried.
  async function toggleLock() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyPatch: { locked: !locked } }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setOpen(false);
      router.refresh();
    } catch {
      // keep the menu open; the toggle can be retried
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Item actions"
        title="More actions"
        onClick={() => setOpen((o) => !o)}
        className="rounded px-2 py-0.5 text-base leading-none text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl shadow-black/50"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void toggleLock()}
            disabled={busy}
            className={`${rowClass} disabled:opacity-50`}
          >
            <span aria-hidden>{locked ? "🔓" : "🔒"}</span>
            {locked ? "Unlock item" : "Lock item"}
          </button>
          {/* Hard nav (plain <a>) so ?arrange=1 escapes the intercept modal. */}
          <a role="menuitem" href={`/items/${itemId}?arrange=1`} className={rowClass}>
            <span aria-hidden>▦</span>
            Customize layout
          </a>
          <div className="my-1 h-px bg-neutral-800" />
          <SaveAsTemplateButton
            itemId={itemId}
            defaultName={title || "Untitled"}
            align="right"
            triggerClassName={rowClass}
          />
          <ApplyTemplateButton itemId={itemId} type={type} triggerClassName={rowClass} />
        </div>
      )}
    </div>
  );
}
