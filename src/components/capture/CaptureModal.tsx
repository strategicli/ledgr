// Global quick capture (PRD §4.4): title-only creation, type defaults to
// task, date, urgency, and entity assignment optional inline. Captures
// always arrive untriaged (inbox: true) even with fields set: per ADR-010,
// leaving the Inbox is a deliberate act, never a side effect. The entity
// picker rides the relations write path (slice 15): the capture POSTs the
// item, then relates it to the picked entity (item -> entity, PRD §3.4).
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { URGENCIES } from "@/lib/item-enums";

const fieldClass =
  "rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-xs text-neutral-300 outline-none focus:border-neutral-600";

type EntityHit = { id: string; title: string; kind: string | null };

export default function CaptureModal({
  typeOptions,
  entityKinds,
  onClose,
}: {
  typeOptions: { key: string; label: string }[];
  entityKinds: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState("task");
  const [due, setDue] = useState("");
  const [urgency, setUrgency] = useState("");
  // Entity captures pick a kind inline so they don't land kind-less (§3); the
  // picker drops to free text when "New kind…" is chosen.
  const [kind, setKind] = useState("");
  const [kindNew, setKindNew] = useState(false);
  const [entity, setEntity] = useState<EntityHit | null>(null);
  const [entityQ, setEntityQ] = useState("");
  const [entityHits, setEntityHits] = useState<EntityHit[]>([]);
  const [activeHit, setActiveHit] = useState(0);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  // The document-level Esc handler below must close the entity dropdown
  // (one layer per press) before it may close the modal; a ref carries the
  // current dropdown state into the stable listener.
  const dismissEntityRef = useRef<() => boolean>(() => false);
  useEffect(() => {
    dismissEntityRef.current = () => {
      if (entityQ || entityHits.length > 0) {
        setEntityQ("");
        setEntityHits([]);
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
        if (dismissEntityRef.current()) return;
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Empty queries clear hits in the onChange handler, not here, so the
  // effect only ever talks to the network (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!entityQ.trim()) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/items?type=entity&q=${encodeURIComponent(entityQ.trim())}&limit=6`,
          { signal: ctrl.signal }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { items: EntityHit[] };
        setEntityHits(data.items);
        setActiveHit(0);
      } catch {
        // aborted or offline; the next keystroke retries
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [entityQ]);

  function pickEntity(hit: EntityHit) {
    setEntity(hit);
    setEntityQ("");
    setEntityHits([]);
    titleRef.current?.focus();
  }

  async function capture() {
    const title = titleRef.current?.value.trim();
    if (!title || state === "busy") return;
    setState("busy");
    const body: Record<string, unknown> = { type, title, inbox: true };
    // Due dates are calendar days stored as UTC midnight (ADR-008). Due and
    // urgency are task fields (ADR-018); a non-task capture ignores them
    // even if they were filled before the type changed.
    if (type === "task" && due) body.dueDate = `${due}T00:00:00.000Z`;
    if (type === "task" && urgency) body.urgency = urgency;
    // Kind is an entity field; only sent for entity captures (§3).
    if (type === "entity" && kind.trim()) body.kind = kind.trim();
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      if (entity) {
        // Best-effort: the capture already landed in the Inbox, so a failed
        // relate must not block the close (triage catches the missing link).
        const { item } = (await res.json()) as { item: { id: string } };
        await fetch(`/api/items/${item.id}/relations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId: entity.id }),
        }).catch(() => {});
      }
      router.refresh();
      onClose();
    } catch {
      setState("error");
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
          placeholder="Capture…"
          aria-label="Title"
          disabled={state === "busy"}
          onKeyDown={(e) => {
            if (e.key === "Enter") void capture();
          }}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Type"
            className={fieldClass}
          >
            {typeOptions.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          {type === "entity" &&
            (kindNew ? (
              <input
                type="text"
                autoFocus
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setKind("");
                    setKindNew(false);
                  }
                }}
                placeholder="new kind…"
                aria-label="Kind"
                className={`${fieldClass} w-28`}
              />
            ) : (
              <select
                value={kind}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setKind("");
                    setKindNew(true);
                    return;
                  }
                  setKind(e.target.value);
                }}
                aria-label="Kind"
                className={fieldClass}
              >
                <option value="">kind…</option>
                {entityKinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
                <option value="__new__">＋ New kind…</option>
              </select>
            ))}
          {type === "task" && (
            <>
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-label="Due date"
                className={`${fieldClass} [color-scheme:dark]`}
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
            </>
          )}
          {entity ? (
            <span className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200">
              @ {entity.title || "Untitled"}
              <button
                onClick={() => setEntity(null)}
                aria-label="Clear entity"
                className="text-neutral-500 hover:text-neutral-200"
              >
                ✕
              </button>
            </span>
          ) : (
            <span className="relative">
              <input
                type="text"
                value={entityQ}
                onChange={(e) => {
                  setEntityQ(e.target.value);
                  if (!e.target.value.trim()) setEntityHits([]);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveHit((a) => Math.min(a + 1, entityHits.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveHit((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter" && entityHits[activeHit]) {
                    e.stopPropagation();
                    pickEntity(entityHits[activeHit]);
                  }
                }}
                placeholder="Relate to…"
                aria-label="Relate to an entity"
                className={`${fieldClass} w-28`}
              />
              {entityHits.length > 0 && (
                <ul className="absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl shadow-black/50">
                  {entityHits.map((hit, i) => (
                    <li key={hit.id}>
                      <button
                        // mousedown, not click: a click would blur the input
                        // first and the dropdown would vanish under the
                        // pointer.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickEntity(hit);
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
                        {hit.kind && (
                          <span className="shrink-0 text-xs text-neutral-500">
                            {hit.kind}
                          </span>
                        )}
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
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {state === "busy" ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
