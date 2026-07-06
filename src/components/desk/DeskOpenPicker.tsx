// The "open something into this panel" picker (ADR-146). Shown in an empty panel
// and from a panel's "+" / ⋯ menu. A small owner-scoped search (reusing
// /api/search, body-free) whose rows open the chosen item as a tab. This is the
// Desk's own entry point until Send-to-Desk (S3) lets you push items in from
// list rows and inline links.
"use client";

import { useEffect, useRef, useState } from "react";

type Hit = { id: string; title: string | null; type: string };
type NamedOption = { id: string; name: string };

export default function DeskOpenPicker({
  hasTabs,
  onPick,
  onPickView,
  onPickDashboard,
  onCancel,
}: {
  // Whether the host panel already has tabs (affects the empty-state copy) and
  // whether a cancel affordance is offered.
  hasTabs: boolean;
  onPick: (itemId: string) => void;
  onPickView: (viewId: string) => void;
  onPickDashboard: (dashboardId: string) => void;
  onCancel?: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [views, setViews] = useState<NamedOption[]>([]);
  const [dashboards, setDashboards] = useState<NamedOption[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The owner's saved views + dashboards, fetched once, so either can be opened
  // as a panel (S4/S5). Filtered client-side by the same query box.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/views")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!cancelled && Array.isArray(d.views)) {
          setViews(d.views.map((v: { id: string; name: string }) => ({ id: v.id, name: v.name })));
        }
      })
      .catch(() => {});
    fetch("/api/dashboards")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!cancelled && Array.isArray(d.dashboards)) {
          setDashboards(
            d.dashboards.map((v: { id: string; name: string }) => ({ id: v.id, name: v.name }))
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const query = q.trim();
    let cancelled = false;
    // All setState happens inside async callbacks (never synchronously in the
    // effect body): an empty query clears on the next tick, a real one after the
    // debounce, so the search stays a clean React↔API synchronization.
    if (!query) {
      const id = setTimeout(() => {
        if (cancelled) return;
        setHits([]);
        setLoading(false);
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(id);
      };
    }
    const t = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(query)}&limit=20`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => {
          if (!cancelled) setHits(Array.isArray(d.items) ? d.items : []);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const query = q.trim().toLowerCase();
  const matchingViews = (
    query ? views.filter((v) => v.name.toLowerCase().includes(query)) : views
  ).slice(0, 8);
  const matchingDashboards = (
    query ? dashboards.filter((d) => d.name.toLowerCase().includes(query)) : dashboards
  ).slice(0, 8);

  return (
    <div className="flex h-full flex-col bg-surface-0 p-4">
      <div className="mx-auto flex w-full max-w-lg flex-col">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && onCancel) onCancel();
            }}
            placeholder="Search items to open here…"
            aria-label="Search items to open in this panel"
            className="w-full rounded-card border border-line bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 rounded-card border border-line px-3 py-2 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-1 overflow-auto">
          {matchingViews.length > 0 && (
            <>
              <p className="ui-meta px-1 pt-1 text-ink-faint">Views</p>
              {matchingViews.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onPickView(v.id)}
                  className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface-1 px-3 py-2 text-left text-sm text-ink hover:bg-surface-2"
                >
                  <span className="truncate">{v.name}</span>
                  <span className="ui-meta shrink-0 text-ink-faint">view</span>
                </button>
              ))}
            </>
          )}
          {matchingDashboards.length > 0 && (
            <>
              <p className="ui-meta px-1 pt-1 text-ink-faint">Dashboards</p>
              {matchingDashboards.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onPickDashboard(d.id)}
                  className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface-1 px-3 py-2 text-left text-sm text-ink hover:bg-surface-2"
                >
                  <span className="truncate">{d.name}</span>
                  <span className="ui-meta shrink-0 text-ink-faint">dashboard</span>
                </button>
              ))}
            </>
          )}
          {(matchingViews.length > 0 || matchingDashboards.length > 0) && hits.length > 0 && (
            <p className="ui-meta px-1 pt-2 text-ink-faint">Items</p>
          )}
          {loading && <p className="px-1 py-2 text-sm text-ink-subtle">Searching…</p>}
          {!loading && q.trim() && hits.length === 0 && (
            <p className="px-1 py-2 text-sm text-ink-subtle">No matches.</p>
          )}
          {!loading && !q.trim() && (
            <p className="px-1 py-2 text-sm text-ink-subtle">
              {hasTabs
                ? "Search to open another item in this panel."
                : "Search to open an item in this panel, or split an existing panel from its ⋯ menu."}
            </p>
          )}
          {hits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onClick={() => onPick(hit.id)}
              className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface-1 px-3 py-2 text-left text-sm text-ink hover:bg-surface-2"
            >
              <span className="truncate">{hit.title?.trim() || "Untitled"}</span>
              <span className="ui-meta shrink-0 text-ink-faint">{hit.type}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
