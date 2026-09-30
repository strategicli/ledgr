// A Website Page's own controls (explorations/website-pages.md, "Building a page
// by hand"): start from a starter while the page is empty, pick the look, and
// open the live page. The look is page settings (properties.design), so picking
// one never touches the markdown. Each option carries its design reasoning so
// the owner chooses by fit, not by guessing from a swatch.
"use client";

import { useState } from "react";
import { FONTS, LANGUAGES, PALETTES, type Design } from "@/modules/website-pages/lib/theme";
import { NAV_ICONS, type NavIconKey } from "@/lib/nav-icons";

export type PageInfo = {
  design: Design;
  empty: boolean;
  starters: { id: string; name: string; description: string }[];
};

const chip = (on: boolean) =>
  `rounded border px-2 py-0.5 disabled:opacity-50 ${
    on ? "border-[var(--accent)] text-neutral-100" : "border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
  }`;

export default function PageControls({ itemId, initial }: { itemId: string; initial: PageInfo }) {
  const [design, setDesign] = useState<Design>(initial.design);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function pick(next: Partial<Design>) {
    // A new language brings its own default font unless one was picked.
    const merged: Design = {
      ...design,
      ...next,
      ...(next.language && !next.font ? { font: LANGUAGES[next.language].font } : {}),
    };
    const prev = design;
    setDesign(merged);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyPatch: { design: merged } }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch {
      setDesign(prev);
      setError("Couldn't save the look. Try again.");
    }
  }

  async function applyStarter(starterId: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/starter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starterId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // The body changed underneath the open editor; reload to show it.
      window.location.reload();
    } catch {
      setError("Couldn't start from that starter. Try again.");
      setBusy(false);
    }
  }

  const lang = LANGUAGES[design.language];
  const [copiedIcon, setCopiedIcon] = useState("");

  async function copyIcon(key: string) {
    try {
      await navigator.clipboard.writeText(`:${key}:`);
      setCopiedIcon(key);
      setTimeout(() => setCopiedIcon(""), 1500);
    } catch {}
  }

  return (
    <div className="flex flex-col gap-3 text-xs">
      {busy && (
        <div role="status" className="flex items-center gap-2 rounded border border-[var(--accent)] px-3 py-2 text-neutral-200">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          Setting up your page… it opens with the sample sections in a moment.
        </div>
      )}
      {saved && (
        <span role="status" className="text-emerald-400">
          Saved. Refresh the live page to see it (a shared link can take up to a minute to update for everyone).
        </span>
      )}
      {initial.empty && initial.starters.length > 0 && !busy && (
        <div className="flex flex-col gap-1.5">
          <span className="text-neutral-400">Start from a starter: sample sections you type over.</span>
          {initial.starters.map((st) => (
            <div key={st.id} className="flex items-start gap-2">
              <button type="button" disabled={busy} onClick={() => applyStarter(st.id)} className={chip(false)}>
                {st.name}
              </button>
              <span className="text-neutral-500">{st.description}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-neutral-400">Style</span>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(LANGUAGES).map(([id, l]) => (
            <button key={id} type="button" aria-pressed={design.language === id} onClick={() => pick({ language: id })} className={chip(design.language === id)}>
              {l.name}
            </button>
          ))}
        </div>
        <span className="text-neutral-400">
          {lang.diff} <span className="text-neutral-500">Reach for it when: {lang.when}</span>
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-neutral-400">Colors</span>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PALETTES).map(([id, p]) => (
            <button key={id} type="button" aria-pressed={design.palette === id} onClick={() => pick({ palette: id })} className={`${chip(design.palette === id)} inline-flex items-center gap-1.5`}>
              <span className="inline-flex">
                {[p.light.lead, p.light.support, p.light.hl].map((c) => (
                  <span key={c} className="-mr-1 inline-block h-2.5 w-2.5 rounded-full border border-black/20" style={{ background: c }} />
                ))}
              </span>
              <span className="ml-1">{p.name}</span>
            </button>
          ))}
        </div>
        <span className="text-neutral-500">{PALETTES[design.palette]?.why} Pages follow the reader&apos;s light or dark setting.</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-neutral-400">Font</span>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(FONTS).map(([id, f]) => (
            <button key={id} type="button" aria-pressed={design.font === id} onClick={() => pick({ font: id })} className={chip(design.font === id)}>
              {f.name}
              {LANGUAGES[design.language].font === id ? " ·" : ""}
            </button>
          ))}
        </div>
        <span className="text-neutral-500">
          {FONTS[design.font]?.why} The dot marks this style&apos;s own font.
        </span>
      </div>

      <details className="flex flex-col gap-1.5">
        <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">Icons</summary>
        <span className="mt-1.5 block text-neutral-500">
          Type <code>/icon</code> in the page to pick one, or <code>:name:</code> anywhere to draw an icon in the page&apos;s colors; add a size with{" "}
          <code>:name:large:</code> (small, medium, large, xl) or <code>:name:48:</code> for pixels. At the start of a
          card or column heading it replaces the dot. They work anywhere, even the site name and menu, and everyday
          names like <code>:star:</code> or <code>:mail:</code> work too. Click one to copy its code.
        </span>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(Object.keys(NAV_ICONS) as NavIconKey[]).map((key) => (
            <button
              key={key}
              type="button"
              title={copiedIcon === key ? "Copied" : `:${key}:`}
              onClick={() => copyIcon(key)}
              className={`grid h-8 w-8 place-items-center rounded border ${copiedIcon === key ? "border-[var(--accent)]" : "border-neutral-700 hover:border-neutral-500"}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: NAV_ICONS[key] }} />
            </button>
          ))}
        </div>
      </details>

      <span className="text-neutral-500">
        Add sections by typing <code>/</code> in the page: Hero, Cards, Columns, Collection, Timeline and more.
      </span>
      {error && <span className="text-red-400">{error}</span>}
    </div>
  );
}
