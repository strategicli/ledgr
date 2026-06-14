// Creates a new item of the given type, then jumps into its editor. When the
// type has item templates (slice 34), it becomes a small menu — "Blank" plus
// each template — so a new item can start from a preset body + property
// defaults. It self-fetches the type's templates on mount, so every list page
// that already renders <NewItemButton type=…/> gets the menu with no change.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type TemplateOpt = { id: string; name: string };

export default function NewItemButton({ type }: { type: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!type) return;
    const ctrl = new AbortController();
    fetch(`/api/templates?type=${encodeURIComponent(type)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { templates?: TemplateOpt[] } | null) => {
        if (d?.templates) {
          setTemplates(d.templates.map((t) => ({ id: t.id, name: t.name })));
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [type]);

  // Close the menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  async function open(promise: Promise<Response>) {
    setState("busy");
    try {
      const res = await promise;
      if (!res.ok) throw new Error(String(res.status));
      const { item } = await res.json();
      setMenuOpen(false);
      router.push(`/items/${item.id}`);
      // The list page stays mounted under the intercepting modal, so this
      // button never remounts on its own — reset it here.
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const createBlank = () =>
    open(
      fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      })
    );

  const createFromTemplate = (id: string) =>
    open(fetch(`/api/templates/${id}/apply`, { method: "POST" }));

  const buttonClass =
    "rounded px-2 py-0.5 text-sm text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50";

  // No templates for this type: the plain button (unchanged behavior).
  if (templates.length === 0) {
    return (
      <button onClick={createBlank} disabled={state === "busy"} className={buttonClass}>
        {state === "error" ? "Failed, retry?" : "+ New"}
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        onClick={() => setMenuOpen((o) => !o)}
        disabled={state === "busy"}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={buttonClass}
      >
        {state === "error" ? "Failed, retry?" : "+ New ▾"}
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl shadow-black/50"
        >
          <button
            role="menuitem"
            onClick={createBlank}
            className="block w-full px-3 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
          >
            Blank
          </button>
          <div className="my-1 border-t border-neutral-800" />
          <p className="px-3 py-0.5 text-xs uppercase tracking-wide text-neutral-600">
            From template
          </p>
          {templates.map((t) => (
            <button
              key={t.id}
              role="menuitem"
              onClick={() => createFromTemplate(t.id)}
              className="block w-full truncate px-3 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
