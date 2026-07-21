// Mobile fast-triage deck (the Slack/Teams "swipe to process" pattern, Brandon
// 2026-07-21). One inbox item at a time as a full-height card: read it (title +
// a sample of its body for context), edit its details in place (type retype +
// InboxTaskControls for tasks), then resolve it — swipe RIGHT = ✓ Triaged, swipe
// LEFT = 🗑 Trash, Skip = leave it. On resolve the card flies off the swiped side
// (+ a haptic tick) and the next card rises in, so an action reads as "done,
// next" rather than "snapped back".
//
// The deck owns a STABLE local snapshot of the items and advances by an index
// only — it never re-fetches mid-session (a refresh would drop resolved items
// and slide a different card under the current one). Edits are optimistic and
// fire-and-forget; resolves too, recorded on an undo stack. Undo can be pressed
// repeatedly and returns you to the exact card you just processed, reverting its
// server change. Swipe mechanics mirror SwipeRow (no dependency): a drag is
// claimed past CLAIM_PX and when mostly horizontal, and never when the touch
// starts on an interactive control ([data-no-swipe]).
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import InboxTaskControls from "@/components/inbox/InboxTaskControls";
import { showToast } from "@/components/ui/ActionToast";
import type { Priority } from "@/lib/priority";

export type TriageItem = {
  id: string;
  title: string | null;
  type: string;
  createdAt: Date;
  scheduledDate: Date | null;
  urgency: number | null;
};

type ExitDir = "left" | "right" | "down";
type Kind = "triaged" | "trash" | "skip";

const CLAIM_PX = 24;
const MAX_REVEAL = 200;
const ACTION_PX = 105;
const EXIT_MS = 260;

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function I({ d, extra }: { d: string; extra?: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
      {extra}
    </svg>
  );
}
const IconCheck = <I d="M20 6L9 17l-5-5" />;
const IconTrash = <I d="M4 7h16M10 11v6M14 11v6" extra={<path d="M6 7l1 13h10l1-13M9 7V4h6v3" />} />;
const IconSkip = <I d="M6 4l10 8-10 8V4z" extra={<path d="M18 5v14" />} />;
const IconOpen = <I d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />;
const IconUndo = <I d="M9 14L4 9l5-5" extra={<path d="M4 9h11a5 5 0 0 1 0 10h-3" />} />;

// A light markdown → plain-text sample: drop the syntax that reads as noise in a
// preview (fences, heading hashes, emphasis, image/link wrappers) and clamp.
function excerpt(md: string): string {
  if (!md) return "";
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, 500);
}

export default function TriageDeck({
  items: initialItems,
  today,
  typeOptions,
}: {
  items: TriageItem[];
  today: string;
  typeOptions: { key: string; label: string }[];
}) {
  // Stable session snapshot — never re-fetched under the current card.
  const [items, setItems] = useState<TriageItem[]>(initialItems);
  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const [exiting, setExiting] = useState<ExitDir | null>(null);
  const [history, setHistory] = useState<{ kind: Kind; itemId: string; fromIndex: number }[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const fetched = useRef<Set<string>>(new Set());
  const start = useRef<{ x: number; y: number } | null>(null);
  const mode = useRef<"idle" | "swiping" | "scrolling" | "suppressed">("idle");

  const current = items[index];
  const remaining = Math.max(0, items.length - index);

  // Lazily pull a body sample for the current card (and prefetch the next), so
  // the deck stays list-query-clean (no body in the page query) but still shows
  // context. Cached by id; each id fetched once.
  useEffect(() => {
    for (const it of [items[index], items[index + 1]]) {
      if (!it || fetched.current.has(it.id)) continue;
      fetched.current.add(it.id);
      fetch(`/api/items/${it.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const text = (d?.item?.body?.text as string) ?? "";
          setPreviews((p) => ({ ...p, [it.id]: excerpt(text) }));
        })
        .catch(() => {});
    }
  }, [index, items]);

  const patchLocal = (patch: Partial<TriageItem>) =>
    setItems((list) => list.map((x, i) => (i === index ? { ...x, ...patch } : x)));

  function resolve(kind: Kind, dir: ExitDir) {
    if (exiting || !current) return;
    const it = current;
    const fromIndex = index;
    navigator.vibrate?.(kind === "trash" ? [10, 22, 10] : kind === "triaged" ? 18 : 8);
    setExiting(dir);
    if (kind === "triaged") {
      void fetch(`/api/items/${it.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbox: false }),
      }).catch(() => showToast("Couldn't mark triaged"));
    } else if (kind === "trash") {
      void fetch(`/api/items/${it.id}`, { method: "DELETE" }).catch(() => showToast("Couldn't delete"));
    }
    setHistory((h) => [...h, { kind, itemId: it.id, fromIndex }]);
    window.setTimeout(() => {
      setExiting(null);
      setDx(0);
      setIndex((i) => i + 1);
    }, EXIT_MS);
  }

  function undo() {
    if (exiting || history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    if (last.kind === "triaged") {
      void fetch(`/api/items/${last.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbox: true }),
      }).catch(() => showToast("Undo failed"));
    } else if (last.kind === "trash") {
      void fetch(`/api/items/${last.itemId}/restore`, { method: "POST" }).catch(() => showToast("Undo failed"));
    }
    navigator.vibrate?.(8);
    setDx(0);
    setExiting(null);
    setIndex(last.fromIndex);
  }

  // Arrow keys on desktop: → triaged, ← trash, ↓/space skip, Backspace undo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") { e.preventDefault(); resolve("triaged", "right"); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); resolve("trash", "left"); }
      else if (e.key === "ArrowDown" || e.key === " ") { e.preventDefault(); resolve("skip", "down"); }
      else if (e.key === "Backspace") { e.preventDefault(); undo(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, exiting, history]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (exiting || (e.target as Element).closest?.("[data-no-swipe]")) {
      mode.current = "suppressed";
      return;
    }
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    mode.current = "idle";
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current || mode.current === "suppressed") return;
    const t = e.touches[0];
    const ddx = t.clientX - start.current.x;
    const ddy = t.clientY - start.current.y;
    if (mode.current === "idle") {
      if (Math.abs(ddx) > CLAIM_PX && Math.abs(ddx) > 2 * Math.abs(ddy)) mode.current = "swiping";
      else if (Math.abs(ddy) > 10) mode.current = "scrolling";
    }
    if (mode.current === "swiping") {
      e.preventDefault();
      setDx(Math.max(-MAX_REVEAL, Math.min(MAX_REVEAL, ddx)));
    }
  };
  const onTouchEnd = () => {
    if (mode.current === "swiping") {
      if (dx >= ACTION_PX) resolve("triaged", "right");
      else if (dx <= -ACTION_PX) resolve("trash", "left");
      else setDx(0);
    }
    mode.current = "idle";
    start.current = null;
  };

  // --- card motion ---
  const exitTransform =
    exiting === "right" ? "translateX(140%) translateY(36px) rotate(10deg)"
    : exiting === "left" ? "translateX(-140%) translateY(36px) rotate(-10deg)"
    : exiting === "down" ? "translateY(120%) scale(0.92)"
    : null;
  const cardStyle: React.CSSProperties = exiting
    ? { transform: exitTransform!, opacity: 0, transition: `transform ${EXIT_MS}ms cubic-bezier(.22,.61,.36,1), opacity ${EXIT_MS}ms ease` }
    : dx !== 0
      ? { transform: `translateX(${dx}px) rotate(${dx / 45}deg)`, transition: "none" }
      : { transition: "transform 0.2s ease" };

  // Color reveal behind the sliding/exiting card (none for a downward skip).
  const revealRight = exiting === "right" || (!exiting && dx > 0);
  const showReveal = exiting ? exiting !== "down" : dx !== 0;
  const revealOpacity = exiting ? 1 : Math.min(1, Math.abs(dx) / ACTION_PX);

  const preview = current ? previews[current.id] : undefined;

  const undoBtn = history.length > 0 && (
    <button type="button" onClick={undo} className="flex items-center gap-1 hover:text-ink">
      {IconUndo} Undo
    </button>
  );

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center justify-between ui-meta text-ink-subtle">
        <span>{remaining} left</span>
        <div className="flex items-center gap-4">
          {undoBtn}
          <Link href="/inbox" className="hover:text-ink">Exit</Link>
        </div>
      </div>

      {!current ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-4xl">🎉</div>
          <h2 className="ui-title text-ink">Inbox zero</h2>
          <p className="ui-meta text-ink-subtle">Nothing left to triage.</p>
          <Link href="/inbox" className="mt-2 rounded-card border border-line px-3 py-1.5 text-sm text-ink-muted hover:border-line-strong hover:text-ink">
            Back to Inbox
          </Link>
        </div>
      ) : (
        <>
          <div className="relative touch-pan-y select-none">
            {showReveal && (
              <div
                className={`pointer-events-none absolute inset-0 flex items-center rounded-card ${
                  revealRight ? "justify-start bg-emerald-500/15" : "justify-end bg-red-500/15"
                }`}
                style={{ opacity: revealOpacity }}
              >
                <span className={`flex items-center gap-1.5 px-6 text-sm font-medium ${revealRight ? "text-emerald-300" : "text-red-300"}`}>
                  {revealRight ? <>{IconCheck} Triaged</> : <>Trash {IconTrash}</>}
                </span>
              </div>
            )}

            <div
              key={current.id}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchEnd}
              className="triage-card-in relative flex min-h-[52vh] flex-col rounded-card border border-line bg-surface-1 p-5 shadow-xl shadow-black/30"
              style={cardStyle}
            >
              <div className="flex items-center justify-between ui-meta text-ink-faint">
                <span>{dateFmt.format(current.createdAt)}</span>
                <span data-no-swipe>
                  <TypeSelect
                    id={current.id}
                    type={current.type}
                    typeOptions={typeOptions}
                    onChanged={(type) => patchLocal({ type })}
                  />
                </span>
              </div>

              <Link
                href={`/items/${current.id}`}
                className={`mt-3 break-words text-lg font-medium ${current.title ? "text-ink" : "text-ink-subtle"}`}
              >
                {current.title || "Untitled"}
              </Link>

              {/* A sample of the item's body for context (lazy-loaded). */}
              {preview
                ? <p className="mt-3 line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{preview}</p>
                : preview === undefined
                  ? <p className="mt-3 text-sm text-ink-faint">…</p>
                  : null}

              {current.type === "task" && (
                <div data-no-swipe className="mt-auto pt-4">
                  <InboxTaskControls
                    id={current.id}
                    today={today}
                    scheduledDate={current.scheduledDate}
                    urgency={current.urgency as Priority | null}
                    autoRefresh={false}
                    onEdited={(patch) => patchLocal(patch)}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center gap-2">
            <button type="button" onClick={() => resolve("trash", "left")} className="flex items-center gap-1.5 rounded-card border border-red-500/25 bg-red-500/10 px-4 py-2 text-sm text-red-300 hover:bg-red-500/20">
              {IconTrash} Trash
            </button>
            <button type="button" onClick={() => resolve("skip", "down")} className="flex items-center gap-1.5 rounded-card border border-line px-3 py-2 text-sm text-ink-muted hover:border-line-strong hover:text-ink">
              {IconSkip} Skip
            </button>
            <Link href={`/items/${current.id}`} className="flex items-center gap-1.5 rounded-card border border-line px-3 py-2 text-sm text-ink-muted hover:border-line-strong hover:text-ink">
              {IconOpen} Open
            </Link>
            <button type="button" onClick={() => resolve("triaged", "right")} className="flex items-center gap-1.5 rounded-card border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20">
              {IconCheck} Triaged
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Inline type retype for the card. Optimistic local value + fire-and-forget
// PATCH (no refresh — the deck owns its snapshot); reports the new type up so the
// card can show/hide the task controls.
function TypeSelect({
  id,
  type,
  typeOptions,
  onChanged,
}: {
  id: string;
  type: string;
  typeOptions: { key: string; label: string }[];
  onChanged: (type: string) => void;
}) {
  const [value, setValue] = useState(type);
  const [busy, setBusy] = useState(false);
  return (
    <select
      value={value}
      disabled={busy}
      aria-label="Type"
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        onChanged(next);
        setBusy(true);
        void fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: next }),
        }).finally(() => setBusy(false));
      }}
      className="rounded-card border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink-muted outline-none focus:border-line-strong"
    >
      {typeOptions.map((t) => (
        <option key={t.key} value={t.key}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
