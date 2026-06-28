// Global quick capture (the "+"/`q`): a TYPE PICKER first, so the owner can
// file any capturable type, not only tasks (Brandon, 2026-06-28 — restoring the
// multi-type capture that ADR-072 had and the 2026-06-21 task-only
// consolidation dropped). Defaults to the catch-all "Unsorted" (the hidden
// `unmarked` type, ADR-067) so capture never pre-assumes a task; captures always
// land in the Inbox (inbox: true) for deliberate triage (ADR-010).
//
// When the picked type is "task", we render Tyler's shared AddTaskCard verbatim
// (the polished title-with-NL-highlighting + chip row + #project/@person +
// destination experience), so the task path keeps its styling and stays
// identical to the inline per-day / project / item task adds. For every other
// type we render a lean, same-styled capture card (title + optional description
// + optional person link). The inline task-add surfaces use AddTaskCard
// directly and are unaffected by this file.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AddTaskCard from "@/components/tasks/AddTaskCard";
import { enqueueCapture } from "@/lib/outbox";

// --- inline SVG icons (16px, currentColor), matching AddTaskCard's set ---
function I({ d, extra }: { d: string; extra?: React.ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
      {extra}
    </svg>
  );
}
const IconInbox = <I d="M4 13h4l1 3h6l1-3h4" extra={<path d="M4 13l2-7h12l2 7v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />} />;
const IconDescription = <I d="M4 7h16M4 12h16M4 17h10" />;
const IconUser = <I d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" extra={<circle cx="12" cy="8" r="4" />} />;
const IconChevron = <I d="M6 9l6 6 6-6" />;

type PersonHit = { id: string; title: string };

export default function CaptureModal({
  typeOptions,
  onClose,
}: {
  typeOptions?: { key: string; label: string }[];
  onClose: () => void;
}) {
  // Prepend the catch-all "Unsorted" (the nav filters the hidden `unmarked`
  // type out of its options) and default to it: an unchanged capture lands in
  // the Inbox as untyped, triaged later.
  const captureOptions = [{ key: "unmarked", label: "Unsorted" }, ...(typeOptions ?? [])];
  const [type, setType] = useState("unmarked");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[18vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Quick capture"
    >
      <div className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        {/* Type picker header — the choice that makes capture multi-type. Its
            own panel bar so it reads as part of the modal, not bare text
            floating on the dimmed backdrop. */}
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 shadow-lg shadow-black/40">
          <span className="text-xs uppercase tracking-wide text-neutral-500">New</span>
          <span className="relative inline-flex items-center">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              aria-label="Type to capture"
              className="appearance-none rounded-md border border-neutral-700 bg-neutral-800 py-1 pl-2.5 pr-7 text-sm text-neutral-200 outline-none hover:border-neutral-600 focus:border-neutral-500"
            >
              {captureOptions.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-1.5 text-neutral-500">{IconChevron}</span>
          </span>
        </div>

        {type === "task" ? (
          <AddTaskCard onDone={onClose} onCancel={onClose} />
        ) : (
          <SimpleCapture type={type} onDone={onClose} onCancel={onClose} />
        )}
      </div>
    </div>
  );
}

// A lean capture card for any non-task type, styled to match AddTaskCard: a
// title, an optional description, an optional person link. Always lands in the
// Inbox (ADR-010 — leaving the Inbox is a deliberate triage act, never a side
// effect of capture). Offline-safe via the outbox (T5, ADR-080).
function SimpleCapture({
  type,
  onDone,
  onCancel,
}: {
  type: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showDesc, setShowDesc] = useState(false);
  const [busy, setBusy] = useState(false);

  // Optional "relate to a person" — the capture POSTs the item, then relates it
  // to the picked person (item -> person, PRD §3.4).
  const [person, setPerson] = useState<PersonHit | null>(null);
  const [personQ, setPersonQ] = useState("");
  const [personHits, setPersonHits] = useState<PersonHit[]>([]);
  const [activeHit, setActiveHit] = useState(0);

  // Esc closes the person dropdown first (one layer per press), then the modal.
  // A ref carries the live dropdown state into the stable capture-phase listener
  // so a single Esc only closes the topmost layer (this modal can sit above the
  // item-canvas modal, ADR-007).
  const dismissPersonRef = useRef<() => boolean>(() => false);
  useEffect(() => {
    dismissPersonRef.current = () => {
      if (personQ || personHits.length > 0) {
        setPersonQ("");
        setPersonHits([]);
        return true;
      }
      return false;
    };
  });
  useEffect(() => {
    titleRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (dismissPersonRef.current()) return;
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  // Debounced person search; empty queries clear hits in onChange, not here.
  useEffect(() => {
    if (!personQ.trim()) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/items?type=person&q=${encodeURIComponent(personQ.trim())}&limit=6`,
          { signal: ctrl.signal }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { items: PersonHit[] };
        setPersonHits(data.items);
        setActiveHit(0);
      } catch {
        // aborted or offline; the next keystroke retries
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [personQ]);

  function pickPerson(hit: PersonHit) {
    setPerson(hit);
    setPersonQ("");
    setPersonHits([]);
    titleRef.current?.focus();
  }

  async function create() {
    const raw = title.trim();
    if (!raw || busy) return;
    setBusy(true);
    const body: Record<string, unknown> = { type, title: raw, inbox: true };
    if (description.trim()) body.body = { format: "markdown", text: description.trim() };
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      if (person) {
        // Best-effort: the capture already landed in the Inbox, so a failed
        // relate must not block the close (triage catches the missing link).
        const { item } = (await res.json()) as { item: { id: string } };
        await fetch(`/api/items/${item.id}/relations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId: person.id }),
        }).catch(() => {});
      }
      router.refresh();
      onDone();
    } catch {
      // Offline (or transient failure): queue locally and close; the outbox
      // syncs on reconnect. The optional person link is skipped offline — the
      // item still lands in the Inbox for triage.
      enqueueCapture(body);
      window.dispatchEvent(new Event("ledgr:outbox"));
      onDone();
    }
  }

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-lg shadow-black/40">
      <div className="flex items-start gap-2">
        <textarea
          ref={titleRef}
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void create(); }
          }}
          placeholder="Capture…"
          aria-label="Title"
          className="min-w-0 flex-1 resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent p-0 text-base font-medium leading-6 text-neutral-100 outline-none placeholder:text-neutral-500"
        />
        <button type="button" title="Toggle description" aria-label="Toggle description" onClick={() => setShowDesc((v) => !v)} className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300">{IconDescription}</button>
      </div>

      {(showDesc || description) && (
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          aria-label="Description"
          className="mt-1 w-full bg-transparent text-sm text-neutral-300 outline-none placeholder:text-neutral-600"
        />
      )}

      {/* relate-to-person row */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-b border-neutral-800 pb-3">
        {person ? (
          <span className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-2 py-1 text-sm text-[var(--accent)]">
            {IconUser} {person.title || "Untitled"}
            <button type="button" onClick={() => setPerson(null)} aria-label="Clear person" className="text-neutral-500 hover:text-neutral-200">✕</button>
          </span>
        ) : (
          <span className="relative">
            <input
              type="text"
              value={personQ}
              onChange={(e) => {
                setPersonQ(e.target.value);
                if (!e.target.value.trim()) setPersonHits([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveHit((a) => Math.min(a + 1, personHits.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveHit((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter" && personHits[activeHit]) {
                  e.preventDefault();
                  e.stopPropagation();
                  pickPerson(personHits[activeHit]);
                }
              }}
              placeholder="Relate to…"
              aria-label="Relate to a person"
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-300 outline-none hover:border-neutral-600 focus:border-neutral-500"
            />
            {personHits.length > 0 && (
              <ul className="absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl shadow-black/50">
                {personHits.map((hit, i) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      // mousedown, not click: a click would blur the input
                      // first and the dropdown would vanish under the pointer.
                      onMouseDown={(e) => { e.preventDefault(); pickPerson(hit); }}
                      onMouseEnter={() => setActiveHit(i)}
                      className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm ${
                        i === activeHit ? "bg-neutral-800 text-neutral-100" : "text-neutral-300"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{hit.title || "Untitled"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </span>
        )}
      </div>

      {/* footer: Inbox destination (fixed for captures) + actions */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm text-neutral-400">
          {IconInbox} Inbox
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700">Cancel</button>
          <button type="button" disabled={!title.trim() || busy} onClick={() => void create()} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40">
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
