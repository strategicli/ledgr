// The inline title box the Planner spawns on click-to-create (Slice 2). Enter
// submits, Escape cancels, blur cancels when empty (a blur with text submits, so
// clicking away doesn't silently drop a typed title). Autofocuses on mount.
"use client";

import { useEffect, useRef } from "react";

export default function QuickCreateInput({
  onSubmit,
  onCancel,
  placeholder = "Task title…",
  busy = false,
}: {
  onSubmit: (title: string) => void;
  onCancel: () => void;
  placeholder?: string;
  busy?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <input
      ref={ref}
      disabled={busy}
      placeholder={placeholder}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        if (v) onSubmit(v);
        else onCancel();
      }}
      className="w-full rounded border border-[color:var(--accent)] bg-neutral-900 px-1 py-0.5 text-[11px] text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
    />
  );
}
