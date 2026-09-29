// The top of a Website Page's canvas: the site's link (always visible, with
// Copy, or a button to make one), then two collapsible areas: Design (starter,
// style, colors, font, icons) and "Pages on this site" (everything published
// here, as a horizontal row). Collapsed state is remembered per browser.
"use client";

import { useState, useSyncExternalStore } from "react";
import PageControls from "@/modules/website-pages/components/PageControls";
import type { Design } from "@/modules/website-pages/lib/theme";

type PageRow = { id: string; title: string; slug: string; publishedAt: string; type: string };

type Props = {
  itemId: string;
  design: Design;
  empty: boolean;
  token: string | null;
  base: string | null;
  starters: { id: string; name: string; description: string }[];
  pages: PageRow[];
};

// A remembered open/closed flag, read hydration-safely (the server snapshot is
// the default; the browser's remembered value applies after hydration).
const REMEMBER_EVENT = "ledgr-page-remember";
function useRemembered(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const read = () => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  };
  const subscribe = (cb: () => void) => {
    window.addEventListener(REMEMBER_EVENT, cb);
    return () => window.removeEventListener(REMEMBER_EVENT, cb);
  };
  const open = useSyncExternalStore(subscribe, read, () => initial);
  return [
    open,
    (v: boolean) => {
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {}
      window.dispatchEvent(new Event(REMEMBER_EVENT));
    },
  ];
}

const noSubscribe = () => () => {};

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Section({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-surface-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        {title}
        {count !== undefined && <span className="font-normal normal-case text-ink-subtle">({count})</span>}
      </button>
      {open && <div className="border-t border-line px-3 py-3">{children}</div>}
    </div>
  );
}

export default function PageHeader({ itemId, design, empty, token: initialToken, base, starters, pages: initialPages }: Props) {
  const [token, setToken] = useState(initialToken);
  const [pages, setPages] = useState(initialPages);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A new, empty page opens on Design so the starters are the first thing seen.
  const [designOpen, setDesignOpen] = useRemembered(`ledgr-page-design:${itemId}`, empty);
  const [pagesOpen, setPagesOpen] = useRemembered(`ledgr-page-pages:${itemId}`, true);
  // The owner's public address when set (ADR-277), else the browser's own.
  const here = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const origin = base ?? here;
  const url = token ? `${origin}/share/${token}` : null;

  async function makeLink() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(String(res.status));
      setToken(((await res.json()) as { token: string }).token);
    } catch {
      setError("Couldn't make a link. Is Sharing turned on under Build → Modules?");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  async function unpublish(id: string) {
    const prev = pages;
    setPages((p) => p.filter((x) => x.id !== id));
    const res = await fetch(`/api/items/${id}/publish`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId: itemId }),
    }).catch(() => null);
    if (!res?.ok) {
      setPages(prev);
      setError("Couldn't unpublish. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface-1 px-3 py-2">
        <span className="font-semibold uppercase tracking-wide text-ink-muted">Website page</span>
        {url ? (
          <>
            <a href={url} target="_blank" rel="noreferrer" className="min-w-0 max-w-full truncate text-[var(--accent)] hover:underline">
              {url.replace(/^https?:\/\//, "")}
            </a>
            <a href={url} target="_blank" rel="noreferrer" className="rounded border border-[var(--accent)] px-2 py-0.5 text-ink">
              View page ↗
            </a>
            <button type="button" onClick={copy} className="rounded border border-line px-2 py-0.5 text-ink-muted hover:text-ink">
              {copied ? "Copied" : "Copy link"}
            </button>
          </>
        ) : (
          <>
            <span className="text-ink-subtle">Not shared yet. Anyone with the link will be able to see it.</span>
            <button type="button" disabled={busy} onClick={makeLink} className="rounded border border-[var(--accent)] px-2 py-0.5 text-ink disabled:opacity-50">
              Make link
            </button>
          </>
        )}
      </div>

      <Section title="Design" open={designOpen} onToggle={setDesignOpen}>
        <PageControls itemId={itemId} initial={{ design, empty, starters }} />
      </Section>

      <Section title="Pages on this site" count={pages.length} open={pagesOpen} onToggle={setPagesOpen}>
        {pages.length === 0 ? (
          <span className="text-ink-subtle">
            Nothing published here yet. Open any item and use Publish to in its Export &amp; sharing section to add it.
          </span>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {pages.map((p) => (
              <div key={p.id} className="flex w-44 shrink-0 flex-col gap-1 rounded-card border border-line bg-surface-0 p-2">
                <a href={`/items/${p.id}`} className="line-clamp-2 font-medium text-ink hover:underline">
                  {p.title}
                </a>
                <span className="text-ink-subtle">
                  {p.type.replace(/-/g, " ")} · {day(p.publishedAt)}
                </span>
                <div className="mt-auto flex gap-2">
                  {url && (
                    <a href={`${url}/${p.slug}`} target="_blank" rel="noreferrer" className="text-ink-muted hover:text-ink">
                      View ↗
                    </a>
                  )}
                  <button type="button" onClick={() => unpublish(p.id)} className="text-ink-subtle hover:text-[var(--accent)]">
                    Unpublish
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      {error && <span className="text-red-400">{error}</span>}
    </div>
  );
}
