// Preview mode (ADR-125): a body's markdown rendered to read-only HTML, the
// default landing for large "document" notes (ebooks, PDF dumps) where reading,
// not editing, is the common act. The render runs on the SERVER (markdown-it is
// server-only by rule, markdown-render.ts) via /api/render-markdown, so this
// client component only fetches the resulting HTML for whatever text it's given
// — the live text at the moment Preview is opened, so unsaved Source edits show
// when you flip back. Styled with .ledgr-prose so it reads like the in-app
// editor. dangerouslySetInnerHTML is safe under Ledgr's single-owner model: the
// owner's own content, rendered by the owner, the same trust basis as the
// print/share document (see markdown-render.ts).
//
// State is keyed by the text it was computed for (`rendered.for` / `failed`), so
// the loading vs ready vs error state is DERIVED in render and setState is only
// ever called from the async callbacks — never synchronously in the effect.
"use client";

import { useEffect, useState } from "react";

export default function MarkdownPreview({ text }: { text: string }) {
  const [rendered, setRendered] = useState<{ for: string; html: string } | null>(
    null
  );
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!text.trim()) return; // empty body is handled in render, no fetch
    let cancelled = false;
    fetch("/api/render-markdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!cancelled) setRendered({ for: text, html: typeof d.html === "string" ? d.html : "" });
      })
      .catch(() => {
        if (!cancelled) setFailed(text);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!text.trim()) {
    return <div className="ledgr-prose ledgr-preview" />;
  }
  if (failed === text) {
    return (
      <div className="px-1 py-3 text-sm text-red-400">
        Couldn’t render preview. Switch to Source to read the raw markdown.
      </div>
    );
  }
  if (rendered?.for === text) {
    return (
      <div
        className="ledgr-prose ledgr-preview"
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    );
  }
  return <div className="px-1 py-3 text-sm text-neutral-500">Rendering…</div>;
}
