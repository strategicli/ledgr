// Mobile fast-triage deck (the Slack/Teams "swipe to process" pattern, Brandon
// 2026-07-21). One inbox item at a time as a full-height card: read it, edit
// its details in place (type retype + InboxTaskControls for tasks), then resolve
// it — swipe RIGHT = ✓ Triaged (clears the inbox flag, keeps the item), swipe
// LEFT = 🗑 Trash (soft-delete + undo toast). Bottom buttons mirror the swipes
// (+ Skip and Open), and arrow keys drive it on desktop. Everything is optimistic:
// the card advances immediately and the request runs behind it (a failure fires
// an error toast). The swipe mechanics mirror SwipeRow (no dependency): a drag is
// claimed only past CLAIM_PX and when mostly horizontal, and never when the touch
// starts on an interactive control ([data-no-swipe]).
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

const CLAIM_PX = 24;
const MAX_REVEAL = 180;
const ACTION_PX = 100;

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

export default function TriageDeck({
  items,
  today,
  typeOptions,
}: {
  items: TriageItem[];
  today: string;
  typeOptions: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const mode = useRef<"idle" | "swiping" | "scrolling" | "suppressed">("idle");

  const current = items[index];
  const remaining = items.length - index;

  const advance = () => {
    setDx(0);
    setIndex((i) => i + 1);
  };

  const req = (fn: () => Promise<Response>, fail: string) =>
    fn()
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
      })
      .catch(() => showToast(fail));

  function triage(it: TriageItem) {
    advance();
    void req(
      () =>
        fetch(`/api/items/${it.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inbox: false }),
        }),
      "Couldn't mark triaged"
    );
    showToast(`${it.title ? `"${it.title}" ` : ""}triaged`, () =>
      void fetch(`/api/items/${it.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbox: true }),
      })
    );
  }

  function trash(it: TriageItem) {
    advance();
    void req(() => fetch(`/api/items/${it.id}`, { method: "DELETE" }), "Couldn't delete");
    showToast(`${it.title ? `"${it.title}" ` : ""}moved to Trash`, () =>
      void fetch(`/api/items/${it.id}/restore`, { method: "POST" })
    );
  }

  // Arrow keys on desktop: → triaged, ← trash, ↓/space skip.
  useEffect(() => {
    if (!current) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") { e.preventDefault(); triage(current!); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); trash(current!); }
      else if (e.key === "ArrowDown" || e.key === " ") { e.preventDefault(); advance(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Refresh the server list when the deck empties, so a re-entry / the badge is
  // accurate and any undo taken from a toast is reflected.
  useEffect(() => {
    if (items.length > 0 && index >= items.length) router.refresh();
  }, [index, items.length, router]);

  if (!current) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
        <div className="text-4xl">🎉</div>
        <h2 className="ui-title text-ink">Inbox zero</h2>
        <p className="ui-meta text-ink-subtle">Nothing left to triage.</p>
        <Link href="/inbox" className="mt-2 rounded-card border border-line px-3 py-1.5 text-sm text-ink-muted hover:border-line-strong hover:text-ink">
          Back to Inbox
        </Link>
      </div>
    );
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if ((e.target as Element).closest?.("[data-no-swipe]")) {
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
      if (dx >= ACTION_PX) triage(current);
      else if (dx <= -ACTION_PX) trash(current);
      else setDx(0);
    }
    mode.current = "idle";
    start.current = null;
  };

  const right = dx > 0;
  const reveal = Math.min(1, Math.abs(dx) / ACTION_PX);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center justify-between ui-meta text-ink-subtle">
        <span>{remaining} left</span>
        <Link href="/inbox" className="hover:text-ink">Exit</Link>
      </div>

      {/* Card viewport: a color layer behind the sliding card telegraphs the action. */}
      <div className="relative touch-pan-y select-none">
        <div
          className={`pointer-events-none absolute inset-0 flex items-center rounded-card ${
            right ? "justify-start bg-emerald-500/15" : "justify-end bg-red-500/15"
          }`}
          style={{ opacity: dx === 0 ? 0 : reveal }}
        >
          <span className={`flex items-center gap-1.5 px-6 text-sm font-medium ${right ? "text-emerald-300" : "text-red-300"}`}>
            {right ? <>{IconCheck} Triaged</> : <>Trash {IconTrash}</>}
          </span>
        </div>

        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          className="relative flex min-h-[52vh] flex-col rounded-card border border-line bg-surface-1 p-5 shadow-xl shadow-black/30"
          style={{ transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transition: dx === 0 ? "transform 0.2s ease" : "none" }}
        >
          <div className="flex items-center justify-between ui-meta text-ink-faint">
            <span>{dateFmt.format(current.createdAt)}</span>
            {/* Type retype lives in the card; marked no-swipe so using it never drags. */}
            <span data-no-swipe>
              <TypeSelect id={current.id} type={current.type} typeOptions={typeOptions} />
            </span>
          </div>

          <Link
            href={`/items/${current.id}`}
            className={`mt-3 flex-1 break-words text-lg font-medium ${current.title ? "text-ink" : "text-ink-subtle"}`}
          >
            {current.title || "Untitled"}
          </Link>

          {current.type === "task" && (
            <div data-no-swipe className="mt-4">
              <InboxTaskControls
                id={current.id}
                today={today}
                scheduledDate={current.scheduledDate}
                urgency={current.urgency as Priority | null}
              />
            </div>
          )}
        </div>
      </div>

      {/* Button fallbacks for the swipes (+ Skip, + Open for deep edit). */}
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => trash(current)}
          className="flex items-center gap-1.5 rounded-card border border-red-500/25 bg-red-500/10 px-4 py-2 text-sm text-red-300 hover:bg-red-500/20"
        >
          {IconTrash} Trash
        </button>
        <button
          type="button"
          onClick={advance}
          className="flex items-center gap-1.5 rounded-card border border-line px-3 py-2 text-sm text-ink-muted hover:border-line-strong hover:text-ink"
        >
          {IconSkip} Skip
        </button>
        <Link
          href={`/items/${current.id}`}
          className="flex items-center gap-1.5 rounded-card border border-line px-3 py-2 text-sm text-ink-muted hover:border-line-strong hover:text-ink"
        >
          {IconOpen} Open
        </Link>
        <button
          type="button"
          onClick={() => triage(current)}
          className="flex items-center gap-1.5 rounded-card border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20"
        >
          {IconCheck} Triaged
        </button>
      </div>
    </div>
  );
}

// Inline type retype for the card (a lean version of TriageControls' select).
function TypeSelect({
  id,
  type,
  typeOptions,
}: {
  id: string;
  type: string;
  typeOptions: { key: string; label: string }[];
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
