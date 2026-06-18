// Global quick capture (PRD §4.4): title-only creation, type defaults to the
// catch-all "Unsorted" (the hidden `unmarked` type, ADR-067); date, urgency,
// and a related person optional inline. Captures always
// arrive untriaged (inbox: true) even with fields set: per ADR-010, leaving the
// Inbox is a deliberate act, never a side effect. The relate picker rides the
// relations write path (slice 15): the capture POSTs the item, then relates it
// to the picked person (item -> person, PRD §3.4).
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { URGENCIES } from "@/lib/item-enums";
import { parseNaturalDate, parseTaskTitle } from "@/lib/nl-date";
import { describeRule, type RecurrenceRule } from "@/lib/recurrence";
import { enqueueCapture } from "@/lib/outbox";

// Today as YYYY-MM-DD in the user's local zone (single-user = the app zone), for
// natural-language date parsing on capture (T2). Local getters, no UTC shift.
function localTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const fieldClass =
  "rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-xs text-neutral-300 outline-none focus:border-neutral-600";

type PersonHit = { id: string; title: string };

export default function CaptureModal({
  typeOptions,
  onClose,
}: {
  typeOptions: { key: string; label: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  // Default to the catch-all "Unsorted" so capture never pre-assumes a task
  // (the hidden `unmarked` type, ADR-067; ADR-062 follow-up). It's prepended
  // here because the nav filters hidden types out of the quick-capture
  // options; an unchanged capture lands in the Inbox as untyped, triaged later.
  const captureOptions = [{ key: "unmarked", label: "Unsorted" }, ...typeOptions];
  const [type, setType] = useState("unmarked");
  const [title, setTitle] = useState("");
  const [scheduled, setScheduled] = useState(""); // YYYY-MM-DD, from NL parse
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const [due, setDue] = useState("");
  const [urgency, setUrgency] = useState("");

  // Live natural-language detection from the title (S4, ADR-084), task-only —
  // recurrence/scheduled/urgency are task fields. Shows what Apply (or Create)
  // will pull out; an explicit token grammar (nl-date.ts), never a guess.
  const preview = useMemo(
    () => (type === "task" && title.trim() ? parseTaskTitle(title, localTodayYmd()) : null),
    [type, title]
  );

  // Apply the parse: strip the tokens from the title and commit the fields. The
  // manual trigger; Create also parses (parse-on-save) so this is optional.
  function applyParse() {
    const p = parseTaskTitle(title, localTodayYmd());
    if (p.detections.length === 0) return;
    setTitle(p.title);
    if (p.scheduledDate) setScheduled(p.scheduledDate);
    if (p.dueDate) setDue(p.dueDate);
    if (p.urgency) setUrgency(p.urgency);
    if (p.recurrence) setRecurrence(p.recurrence);
    titleRef.current?.focus();
  }
  const [person, setPerson] = useState<PersonHit | null>(null);
  const [personQ, setPersonQ] = useState("");
  const [personHits, setPersonHits] = useState<PersonHit[]>([]);
  const [activeHit, setActiveHit] = useState(0);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  // The document-level Esc handler below must close the person dropdown
  // (one layer per press) before it may close the modal; a ref carries the
  // current dropdown state into the stable listener.
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
      // Claim Esc in the capture phase: this modal can sit above the item
      // canvas modal (which closes on any unclaimed Esc at document level,
      // ADR-007), and one Esc must close only the topmost layer.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (dismissPersonRef.current()) return;
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Empty queries clear hits in the onChange handler, not here, so the
  // effect only ever talks to the network (react-hooks/set-state-in-effect).
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

  async function capture() {
    const raw = title.trim();
    if (!raw || state === "busy") return;
    // Parse-on-save (S4): catch tokens typed but not yet Applied; committed
    // fields (set via Apply or the controls) win over a fresh parse.
    const p = type === "task" ? parseTaskTitle(raw, localTodayYmd()) : null;
    const finalTitle = p && p.title ? p.title : raw;
    const sched = scheduled || p?.scheduledDate || "";
    const dueDay = due || p?.dueDate || "";
    const urg = urgency || p?.urgency || "";
    const rec = recurrence || p?.recurrence || null;
    setState("busy");
    const body: Record<string, unknown> = { type, title: finalTitle, inbox: true };
    // Dates are calendar days stored as UTC midnight (ADR-008). Scheduled/due/
    // urgency/recurrence are task fields (ADR-018/076); a non-task capture
    // ignores them even if they were filled before the type changed.
    if (type === "task" && sched) body.scheduledDate = `${sched}T00:00:00.000Z`;
    if (type === "task" && dueDay) body.dueDate = `${dueDay}T00:00:00.000Z`;
    if (type === "task" && urg) body.urgency = urg;
    if (type === "task" && rec) body.properties = { recurrence: rec };
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
      onClose();
    } catch {
      // Offline (or a transient failure): queue the item locally and close; the
      // outbox syncs it on reconnect (T5, ADR-080). The optional person link is
      // skipped offline — the item still lands in the Inbox for triage.
      enqueueCapture(body);
      window.dispatchEvent(new Event("ledgr:outbox"));
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[18vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Quick capture"
    >
      <div
        className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={type === "task" ? "e.g. Call Bob tomorrow p1 every week" : "Capture…"}
          aria-label="Title"
          disabled={state === "busy"}
          onKeyDown={(e) => {
            if (e.key === "Enter") void capture();
          }}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
        />
        {/* Live NL detection (S4): a confirm-by-visibility preview + Apply (the
            manual trigger). Create also parses, so Apply is optional. */}
        {preview && preview.detections.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-neutral-500">Detected</span>
            {preview.detections.map((d, i) => (
              <span
                key={`${d.field}-${i}`}
                className="rounded border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-1.5 py-0.5 text-neutral-300"
              >
                {d.field === "scheduled" ? "📅" : d.field === "due" ? "⏰" : d.field === "recurrence" ? "🔁" : "❗"}{" "}
                {d.label}
              </span>
            ))}
            <span className="text-neutral-600">
              → “{preview.title || "…"}”
            </span>
            <button
              type="button"
              onClick={applyParse}
              className="ml-auto rounded bg-neutral-800 px-2 py-0.5 font-medium text-neutral-200 hover:bg-neutral-700"
            >
              ✨ Apply
            </button>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Type"
            className={fieldClass}
          >
            {captureOptions.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          {type === "task" && (
            <>
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-label="Due date"
                className={`${fieldClass} [color-scheme:dark]`}
              />
              <input
                type="text"
                placeholder="or 'next fri'"
                aria-label="Due date in plain language"
                // Natural-language due date (T2): parse on Enter/blur into the
                // date field; an unrecognized phrase is left for the user.
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    e.currentTarget.blur();
                  }
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (!v) return;
                  const ymd = parseNaturalDate(v, localTodayYmd());
                  if (ymd) {
                    setDue(ymd);
                    e.target.value = "";
                  }
                }}
                className={`${fieldClass} w-24`}
              />
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value)}
                aria-label="Urgency"
                className={fieldClass}
              >
                <option value="">urgency</option>
                {URGENCIES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              {scheduled && (
                <span className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200">
                  📅 {scheduled}
                  <button
                    onClick={() => setScheduled("")}
                    aria-label="Clear scheduled date"
                    className="text-neutral-500 hover:text-neutral-200"
                  >
                    ✕
                  </button>
                </span>
              )}
              {recurrence && (
                <span className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200">
                  🔁 {describeRule(recurrence)}
                  <button
                    onClick={() => setRecurrence(null)}
                    aria-label="Clear repeat"
                    className="text-neutral-500 hover:text-neutral-200"
                  >
                    ✕
                  </button>
                </span>
              )}
            </>
          )}
          {person ? (
            <span className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200">
              @ {person.title || "Untitled"}
              <button
                onClick={() => setPerson(null)}
                aria-label="Clear person"
                className="text-neutral-500 hover:text-neutral-200"
              >
                ✕
              </button>
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
                    e.stopPropagation();
                    pickPerson(personHits[activeHit]);
                  }
                }}
                placeholder="Relate to…"
                aria-label="Relate to a person"
                className={`${fieldClass} w-28`}
              />
              {personHits.length > 0 && (
                <ul className="absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl shadow-black/50">
                  {personHits.map((hit, i) => (
                    <li key={hit.id}>
                      <button
                        // mousedown, not click: a click would blur the input
                        // first and the dropdown would vanish under the
                        // pointer.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickPerson(hit);
                        }}
                        onMouseEnter={() => setActiveHit(i)}
                        className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm ${
                          i === activeHit
                            ? "bg-neutral-800 text-neutral-100"
                            : "text-neutral-300"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {hit.title || "Untitled"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </span>
          )}
          <span className="ml-auto text-xs text-neutral-600">
            {state === "error" ? "Failed, retry" : "Enter or Create · Esc to close"}
          </span>
          <button
            onClick={() => void capture()}
            disabled={state === "busy"}
            className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            {state === "busy" ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
