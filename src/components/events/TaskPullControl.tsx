"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EVENT_MEMBERS_PREFIX,
  EVENT_PEOPLE_SEED,
  type TaskPull,
} from "@/lib/events/task-pull";

type SeedLabel = { id: string; title: string; type: string };

// The event task-pull control (ADR-094 E4): "Show open tasks related to [any|all]
// of: <chips>". Edits properties.taskPull. v1 authors one flat group (the model
// supports N OR'd groups; the "+ group" UI is a later add). A seed is the
// "@people" sentinel (the event's people) or any item id (a person, a tag, …).
export default function TaskPullControl({
  eventId,
  rule,
  seeds,
  peopleCount,
}: {
  eventId: string;
  rule: TaskPull;
  seeds: SeedLabel[];
  peopleCount: number;
}) {
  const router = useRouter();
  const group = rule.groups[0] ?? { match: "any" as const, seeds: [EVENT_PEOPLE_SEED] };
  const [match, setMatch] = useState<"any" | "all">(group.match);
  const [seedIds, setSeedIds] = useState<string[]>(group.seeds);
  const [labels, setLabels] = useState<Record<string, SeedLabel>>(
    Object.fromEntries(seeds.map((s) => [s.id, s]))
  );
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SeedLabel[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      if (!trimmed) {
        setHits([]);
        return;
      }
      try {
        const res = await fetch(`/api/items?q=${encodeURIComponent(trimmed)}&limit=8`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items: SeedLabel[] };
        setHits(data.items.filter((h) => h.id !== eventId && !seedIds.includes(h.id)));
      } catch {
        /* aborted or offline; next keystroke retries */
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q, open, eventId, seedIds]);

  async function save(nextSeeds: string[], nextMatch: "any" | "all") {
    setBusy(true);
    // No seeds => clear the rule (reads back as the default: anyone on the event).
    const taskPull =
      nextSeeds.length === 0
        ? null
        : { groups: [{ match: nextMatch, seeds: nextSeeds }], statusScope: rule.statusScope };
    try {
      const res = await fetch(`/api/items/${eventId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyPatch: { taskPull } }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function addSeed(h: SeedLabel) {
    if (seedIds.includes(h.id)) return;
    const next = [...seedIds, h.id];
    setSeedIds(next);
    setLabels((m) => ({ ...m, [h.id]: h }));
    setQ("");
    setHits([]);
    setOpen(false);
    void save(next, match);
  }
  function addPeople() {
    if (seedIds.includes(EVENT_PEOPLE_SEED)) return;
    const next = [...seedIds, EVENT_PEOPLE_SEED];
    setSeedIds(next);
    setOpen(false);
    void save(next, match);
  }
  function removeSeed(id: string) {
    const next = seedIds.filter((s) => s !== id);
    setSeedIds(next);
    void save(next, match);
  }
  function toggleMatch() {
    const next = match === "any" ? "all" : "any";
    setMatch(next);
    void save(seedIds, next);
  }

  // "@members:<gid>" chips read as the roster ("Anyone in Pastors"); the seed
  // labels map is keyed by the bare group id (taskPullSeedLabels strips the
  // prefix), so look the group up by its stripped id.
  const chipLabel = (id: string) =>
    id === EVENT_PEOPLE_SEED
      ? `People on this event${peopleCount ? ` (${peopleCount})` : ""}`
      : id.startsWith(EVENT_MEMBERS_PREFIX)
        ? `Anyone in ${(labels[id.slice(EVENT_MEMBERS_PREFIX.length)] ?? labels[id])?.title || "…"}`
        : labels[id]?.title || "Untitled";

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-2 text-xs text-neutral-500">
      <span>Related to</span>
      <button
        type="button"
        onClick={toggleMatch}
        disabled={busy || seedIds.length < 2}
        className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
        title="Any = related to any of these (union); All = related to all of these (intersection)"
      >
        {match === "any" ? "any" : "all"} ▾
      </button>
      <span>of:</span>
      {seedIds.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300"
        >
          {chipLabel(id)}
          <button
            type="button"
            onClick={() => removeSeed(id)}
            disabled={busy}
            className="text-neutral-500 hover:text-neutral-200 disabled:opacity-40"
            aria-label="Remove"
          >
            ×
          </button>
        </span>
      ))}
      <span className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={busy}
          className="rounded border border-dashed border-neutral-700 px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          + add
        </button>
        {open && (
          <div className="absolute left-0 z-20 mt-1 w-64 rounded border border-neutral-700 bg-neutral-900 p-1 text-left shadow-lg">
            {!seedIds.includes(EVENT_PEOPLE_SEED) && (
              <button
                type="button"
                onClick={addPeople}
                className="block w-full rounded px-2 py-1 text-left text-neutral-300 hover:bg-neutral-800"
              >
                People on this event
              </button>
            )}
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people, tags, items…"
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none"
            />
            <ul className="mt-1 max-h-40 overflow-auto">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => addSeed(h)}
                    className="block w-full truncate rounded px-2 py-1 text-left text-neutral-300 hover:bg-neutral-800"
                  >
                    {h.title || "Untitled"} <span className="text-neutral-600">· {h.type}</span>
                  </button>
                  {/* A group seeds two ways (ADR-144): the group item itself,
                      or its roster — "anyone in" adds the @members sentinel. */}
                  {h.type === "group" && (
                    <button
                      type="button"
                      onClick={() =>
                        addSeed({
                          id: `${EVENT_MEMBERS_PREFIX}${h.id}`,
                          title: h.title,
                          type: h.type,
                        })
                      }
                      className="block w-full truncate rounded px-2 py-1 pl-5 text-left text-neutral-400 hover:bg-neutral-800"
                    >
                      ↳ anyone in {h.title || "Untitled"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </span>
    </div>
  );
}
