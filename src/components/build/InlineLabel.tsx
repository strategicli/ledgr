// Inline label fix for structure, from the item view (ADR-068, Feature A2 — the
// deliberate "punch through the line" of ADR-063: Work surfaces can edit a bit
// of structure). Right-click a type label or a relation/property field label
// (e.g. an "Auuthor" heading) to get two choices: Rename it in place, or open
// the full Type builder for anything deeper. Labels only — keys/roles, kinds,
// add/remove all stay in the builder, so a stray edit here can't reshape data.
//
// A label is shared by every item of its type, so renaming here renames it
// everywhere; the menu says so. Saves via the lightweight /rename endpoint
// (never the whole schema), optimistic with a revert on failure.
//
// Desktop affordance (contextmenu). On touch there's no right-click; the label
// just reads as text and the full builder remains the path (Brandon, 2026-06-16).
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function InlineLabel({
  typeKey,
  propertyKey,
  label,
  className,
}: {
  typeKey: string;
  propertyKey?: string; // set => rename this field's label; unset => the type's
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(label);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function save() {
    const next = value.trim();
    if (!next || next === label) {
      setValue(label);
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/types/${encodeURIComponent(typeKey)}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          propertyKey ? { label: next, propertyKey } : { label: next }
        ),
      });
      if (!res.ok) throw new Error(String(res.status));
      setEditing(false);
      router.refresh();
    } catch {
      setValue(label);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setValue(label);
            setEditing(false);
          }
        }}
        size={Math.max(value.length, 4)}
        className="rounded border border-neutral-600 bg-neutral-900 px-1 py-0 text-inherit uppercase tracking-wide text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-50"
        aria-label="Rename label"
      />
    );
  }

  return (
    <span ref={wrapRef} className="relative inline-block">
      <span
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        title="Right-click to rename or edit in builder"
        className={`cursor-context-menu ${className ?? ""}`}
      >
        {value}
      </span>
      {error && <span className="ml-1 text-xs text-red-400">failed</span>}
      {menuOpen && (
        <span
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 flex w-44 flex-col rounded-lg border border-neutral-700 bg-neutral-900 py-1 text-left shadow-xl shadow-black/50"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setEditing(true);
            }}
            className="px-3 py-1.5 text-left text-sm normal-case tracking-normal text-neutral-200 hover:bg-neutral-800"
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              router.push(`/build/types/${encodeURIComponent(typeKey)}/edit`);
            }}
            className="px-3 py-1.5 text-left text-sm normal-case tracking-normal text-neutral-200 hover:bg-neutral-800"
          >
            Edit in builder…
          </button>
        </span>
      )}
    </span>
  );
}
