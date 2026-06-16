// Inline title edit for a related item (ADR-068, Feature A1). A related item's
// title normally renders as a link that opens it (one click deeper for any real
// editing). This adds a small pencil off to the side, hover-revealed on desktop,
// that swaps the link for an input so a quick fix (a misspelled name) lands
// without leaving the item you're on. Optimistic: PATCH the title, revert on
// failure, router.refresh() so the rest of the page (and any other mention of
// this item) re-renders with the new title.
//
// Desktop only: the pencil is hidden on touch widths (max-sm:hidden). On mobile
// you tap through to the item and edit there — deliberately not a long-press,
// which fights scrolling and text selection (Brandon, 2026-06-16).
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export default function InlineTitle({
  id,
  title,
  done = false,
  className,
  linkClassName,
}: {
  id: string;
  title: string;
  done?: boolean;
  className?: string; // outer wrapper (e.g. flex-1 min-w-0 from the row)
  linkClassName?: string; // the link/input text styling
}) {
  const router = useRouter();
  const [value, setValue] = useState(title);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function save() {
    const next = value.trim();
    if (!next || next === title) {
      setValue(title);
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setEditing(false);
      router.refresh();
    } catch {
      setValue(title); // revert
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <span className={`inline-flex min-w-0 items-center ${className ?? ""}`}>
        <input
          ref={inputRef}
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
              setValue(title);
              setEditing(false);
            }
          }}
          className={`min-w-0 flex-1 rounded border border-neutral-600 bg-neutral-900 px-1 py-0 text-sm text-neutral-100 outline-none focus:border-neutral-500 disabled:opacity-50 ${linkClassName ?? ""}`}
          aria-label="Edit title"
        />
      </span>
    );
  }

  return (
    <span
      className={`group/title relative inline-flex min-w-0 items-center gap-1 ${className ?? ""}`}
    >
      <Link
        href={`/items/${id}`}
        className={`min-w-0 truncate ${done ? "line-through opacity-60" : ""} ${linkClassName ?? ""}`}
      >
        {title || "Untitled"}
      </Link>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Rename"
        title="Rename"
        className="shrink-0 rounded px-0.5 text-xs text-neutral-500 opacity-0 transition-opacity hover:text-neutral-200 group-hover/title:opacity-100 max-sm:hidden"
      >
        ✎
      </button>
      {error && <span className="shrink-0 text-xs text-red-400">failed</span>}
    </span>
  );
}
