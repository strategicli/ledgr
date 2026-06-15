// In-context delete confirmation (the project standard, replacing window.confirm
// — Tyler's call, 2026-06-15). A trigger button that, on click, opens a small
// popover anchored to itself asking the user to confirm. The popover can carry
// extra UI (e.g. a "also delete its items" checkbox) via `children`. Closes on
// outside click or Esc.
//
// onConfirm runs when the user confirms: await it, show a busy state, and close
// on success. If it throws, the thrown message stays visible in the popover and
// the popover stays open (so the caller surfaces API errors by throwing).
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export default function ConfirmButton({
  onConfirm,
  title,
  description,
  confirmLabel = "Delete",
  trigger,
  triggerClassName,
  triggerLabel,
  children,
  align = "left",
  disabled = false,
}: {
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  // The trigger's visible content and styling.
  trigger: ReactNode;
  triggerClassName?: string;
  triggerLabel?: string; // aria-label when the trigger is icon-only
  // Extra content rendered inside the confirmation popover (above the buttons).
  children?: ReactNode;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={title}
          className={`absolute z-50 mt-2 w-64 rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl shadow-black/50 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <p className="text-sm font-medium text-neutral-100">{title}</p>
          {description && (
            <p className="mt-1 text-xs text-neutral-400">{description}</p>
          )}
          {children && <div className="mt-2">{children}</div>}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="rounded px-2.5 py-1 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy}
              className="rounded bg-red-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
