// Search box + results (PRD §4.2). Client-side: keystrokes debounce into
// GET /api/search (aborting the stale request), filters are plain controls,
// result titles open the item canvas modal like any list row. The [[..]]
// snippet markers from ts_headline render as <mark>.
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Option = { value: string; label: string };

// The API's JSON shape, dates as strings; only the fields the rows render.
type ResultRow = {
  id: string;
  type: string;
  title: string;
  updatedAt: string;
  snippet: string | null;
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function Snippet({ text }: { text: string }) {
  const parts = text.split(/\[\[(.*?)\]\]/g);
  return (
    <p className="mt-0.5 truncate text-xs text-neutral-500">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="rounded bg-amber-400/20 px-0.5 text-amber-200"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </p>
  );
}

const selectClass =
  "rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-xs text-neutral-300 outline-none focus:border-neutral-600";

export default function SearchClient({
  types,
  people,
}: {
  types: Option[];
  people: Option[];
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [person, setPerson] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fetched, setFetched] = useState<ResultRow[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  // State changes happen only inside the debounced callback (the React
  // compiler rejects synchronous setState in an effect body); the blank-
  // query case is derived at render time below instead of stored.
  useEffect(() => {
    if (!q.trim()) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const params = new URLSearchParams({ q });
        if (type) params.set("type", type);
        if (person) params.set("person", person);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const res = await fetch(`/api/search?${params}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { items: ResultRow[] };
        setFetched(data.items);
        setStatus("idle");
      } catch {
        if (!ctrl.signal.aborted) setStatus("error");
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, type, person, from, to]);

  const active = q.trim().length > 0;
  const results = active ? fetched : null;

  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search titles and bodies…"
        aria-label="Search"
        autoFocus
        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
      />

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={selectClass}
          >
            <option value="">any</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          Person
          <select
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            className={selectClass}
          >
            <option value="">any</option>
            {people.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          Updated
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Updated from"
            className={`${selectClass} [color-scheme:dark]`}
          />
          –
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Updated to"
            className={`${selectClass} [color-scheme:dark]`}
          />
        </label>
      </div>

      <div className="mt-6">
        {active && status === "error" && (
          <p className="px-2 text-sm text-red-400">
            Search failed; keep typing to retry.
          </p>
        )}
        {active && status === "loading" && results == null && (
          <p className="px-2 text-sm text-neutral-600">Searching…</p>
        )}
        {results != null && (
          <p className="px-2 text-xs text-neutral-600">
            {results.length === 0
              ? "No matches."
              : `${results.length} match${results.length === 1 ? "" : "es"}${
                  results.length === 50 ? " (showing the first 50)" : ""
                }`}
          </p>
        )}
        {results != null && results.length > 0 && (
          <ul className="mt-1">
            {results.map((row) => (
              <li
                key={row.id}
                className="group rounded px-2 py-1.5 hover:bg-neutral-800/60"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-16 shrink-0 truncate text-xs text-neutral-600">
                    {row.type}
                  </span>
                  <Link
                    href={`/items/${row.id}`}
                    className={`min-w-0 flex-1 truncate text-sm ${
                      row.title ? "text-neutral-200" : "text-neutral-500"
                    }`}
                  >
                    {row.title || "Untitled"}
                  </Link>
                  <span className="shrink-0 text-xs text-neutral-600">
                    {dateFmt.format(new Date(row.updatedAt))}
                  </span>
                </div>
                {row.snippet && (
                  <div className="pl-[74px]">
                    <Snippet text={row.snippet} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
