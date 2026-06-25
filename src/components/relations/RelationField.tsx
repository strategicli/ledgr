// A typed relation field on the item canvas (ADR-067 R2). A relation property
// (Author, Attendees) renders as a link box: chips for the current links plus a
// typeahead filtered to the field's targetType. Its value is NOT in
// items.properties — it's the set of `relations` edges from this item with
// role = the field key, so this reads/writes over the relations API (POST to
// add, DELETE ?role= to remove). Cardinality is enforced here (single replaces,
// many accumulates). Create-on-miss is eager and typed: the box knows the type,
// so typing a new name creates an item of targetType and links it without
// leaving the page (the untyped/unmarked path is R3). router.refresh() keeps
// the generic Related panel below in sync.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { RelationCardinality } from "@/lib/types";
import InlineTitle from "./InlineTitle";

type Chip = { id: string; title: string };
type Hit = { id: string; type: string; title: string };

export default function RelationField({
  itemId,
  role,
  targetType,
  targetTypeLabel,
  cardinality,
  initial,
}: {
  itemId: string;
  role: string; // the field key — the edge role
  targetType: string | null; // null = any type (no typeahead filter, no create)
  targetTypeLabel: string | null;
  cardinality: RelationCardinality;
  initial: Chip[];
}) {
  const router = useRouter();
  const [chips, setChips] = useState<Chip[]>(initial);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const atCapacity = cardinality === "single" && chips.length >= 1;
  // Create-on-miss (ADR-067): if the field names a type, create it eagerly
  // (typed, no Inbox); otherwise create an `unmarked` item that lands in the
  // Inbox for triage. Either way it links without leaving the page.
  const trimmed = q.trim();
  const showCreate =
    trimmed !== "" &&
    !hits.some((h) => h.title.trim().toLowerCase() === trimmed.toLowerCase());
  const rowCount = hits.length + (showCreate ? 1 : 0);

  useEffect(() => {
    if (!open || !trimmed) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed, limit: "8" });
        if (targetType) params.set("type", targetType);
        const res = await fetch(`/api/items?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { items: Hit[] };
        const linked = new Set(chips.map((c) => c.id));
        setHits(data.items.filter((h) => h.id !== itemId && !linked.has(h.id)));
        setActive(0);
      } catch {
        // aborted or offline; the next keystroke retries
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [trimmed, open, itemId, targetType, chips]);

  // Low-level: relate this item -> target with the field's role. For a single
  // field, the existing edge(s) are cleared first (role-scoped) so it holds one.
  async function relateTarget(target: Chip) {
    if (cardinality === "single" && chips.length > 0) {
      await Promise.all(
        chips.map((c) =>
          fetch(
            `/api/items/${itemId}/relations?targetId=${c.id}&role=${encodeURIComponent(role)}`,
            { method: "DELETE" }
          )
        )
      );
    }
    const res = await fetch(`/api/items/${itemId}/relations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: target.id, role }),
    });
    if (!res.ok) throw new Error(String(res.status));
    setChips((prev) => (cardinality === "single" ? [target] : [...prev, target]));
  }

  // Every mutation runs through here: one in-flight at a time, reset the input,
  // refresh so the Related panel reflects the new edge, surface a failure.
  async function guard(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await fn();
      setQ("");
      setHits([]);
      setOpen(false);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const onPick = (hit: Hit) =>
    guard(() => relateTarget({ id: hit.id, title: hit.title || "Untitled" }));

  const onCreate = () => {
    if (!trimmed) return;
    // Typed field -> create that type (resolved, no Inbox). Untyped field ->
    // an `unmarked` item flagged for the Inbox (triage = retype later).
    const createType = targetType ?? "unmarked";
    return guard(async () => {
      const res = await fetch(`/api/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: createType,
          title: trimmed,
          inbox: !targetType,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { item } = (await res.json()) as {
        item: { id: string; title: string };
      };
      await relateTarget({ id: item.id, title: item.title || trimmed });
    });
  };

  const onRemove = (chip: Chip) =>
    guard(async () => {
      const res = await fetch(
        `/api/items/${itemId}/relations?targetId=${chip.id}&role=${encodeURIComponent(role)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(String(res.status));
      setChips((prev) => prev.filter((c) => c.id !== chip.id));
    });

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rowCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active < hits.length) void onPick(hits[active]);
      else if (showCreate) void onCreate();
    } else if (e.key === "Escape") {
      setQ("");
      setHits([]);
      setOpen(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="group/chip inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-neutral-700 bg-neutral-800/60 py-0.5 pl-2 pr-1 text-sm"
        >
          <InlineTitle
            id={chip.id}
            title={chip.title}
            linkClassName={`max-w-[12rem] ${chip.title ? "text-neutral-200" : "text-neutral-500"} hover:underline`}
          />
          <button
            onClick={() => void onRemove(chip)}
            disabled={busy}
            aria-label={`Remove ${chip.title || "link"}`}
            className="shrink-0 rounded px-0.5 text-neutral-500 hover:text-red-400 disabled:opacity-50"
          >
            ✕
          </button>
        </span>
      ))}

      {open ? (
        <span className="relative">
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (!e.target.value.trim()) setHits([]);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              if (!q.trim() && !busy) setOpen(false);
            }}
            disabled={busy}
            placeholder={
              targetTypeLabel ? `Search ${targetTypeLabel}…` : "Search items…"
            }
            className="w-48 rounded border border-neutral-700 bg-transparent px-2 py-0.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
          />
          {(hits.length > 0 || showCreate) && (
            <ul className="absolute left-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl shadow-black/50">
              {hits.map((hit, i) => (
                <li key={hit.id}>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void onPick(hit);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm ${
                      i === active ? "bg-neutral-800 text-neutral-100" : "text-neutral-300"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {hit.title || "Untitled"}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {hit.type}
                    </span>
                  </button>
                </li>
              ))}
              {showCreate && (
                <li>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void onCreate();
                    }}
                    onMouseEnter={() => setActive(hits.length)}
                    className={`flex w-full items-center gap-1 px-2 py-1 text-left text-sm ${
                      active === hits.length ? "bg-neutral-800" : ""
                    }`}
                  >
                    <span className="text-neutral-400">Create</span>
                    <span className="min-w-0 flex-1 truncate text-neutral-100">
                      “{trimmed}”
                    </span>
                    {targetTypeLabel && (
                      <span className="shrink-0 text-xs text-neutral-500">
                        new {targetTypeLabel}
                      </span>
                    )}
                  </button>
                </li>
              )}
            </ul>
          )}
        </span>
      ) : (
        !atCapacity && (
          <button
            onClick={() => setOpen(true)}
            disabled={busy}
            className="rounded px-1.5 py-0.5 text-sm text-neutral-600 hover:bg-neutral-800 hover:text-neutral-300 disabled:opacity-50"
          >
            {chips.length === 0 ? "+ Add" : "+"}
          </button>
        )
      )}
      {error && <span className="text-xs text-red-400">failed</span>}
    </div>
  );
}
