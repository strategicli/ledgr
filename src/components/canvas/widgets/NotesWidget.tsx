"use client";

// Notes widget body (Project Type, ADR-111/PJ5): a scratch capture bar over the
// record's contained notes. Notes and "scratch" are one surface in two states
// (PRD §6) — the bar files an untitled note on blur/Enter, then clears for the
// next braindump; the note lands as an untitled card and can be titled later by
// opening it (quick → structured promotion).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Row = { id: string; title: string };

export default function NotesWidget({
  recordId,
  items,
}: {
  recordId: string;
  items: Row[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function capture() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/records/${recordId}/contain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "note", text: t }),
      });
      if (res.ok) {
        setText("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void capture()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void capture();
          }
        }}
        placeholder="Quick note… (Enter to file)"
        rows={2}
        disabled={busy}
        className="w-full resize-none rounded border border-neutral-800 bg-transparent px-2 py-1 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
      />
      <ul className="flex flex-col gap-1">
        {items.length === 0 && <li className="text-sm text-neutral-500">No notes yet.</li>}
        {items.map((n) => (
          <li key={n.id} className="truncate text-sm">
            <Link href={`/items/${n.id}`} className="text-neutral-300 hover:text-neutral-100">
              {n.title || "Untitled note"}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
