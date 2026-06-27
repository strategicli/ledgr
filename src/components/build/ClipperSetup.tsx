// Web clipper bookmarklet generator (ADR-100). The clipper needs a bookmarklet
// carrying an api-scoped token, but the server never holds the raw token (it's
// stored hashed in LEDGR_API_TOKENS). So the user pastes the token they
// generated on the CLI and this assembles the draggable bookmarklet entirely
// client-side — the token never leaves the browser. Drag the link to the
// bookmarks bar; clicking it on any page POSTs the page to /api/machine/capture.
"use client";

import { useEffect, useRef, useState } from "react";

// Reads the live DOM (no script injection, so page CSP can't block it),
// extraction + image-stripping happen server-side. {TOKEN}/{ORIGIN} are filled
// in below. Kept terse: a bookmarklet is one URL.
function buildBookmarklet(origin: string, token: string): string {
  const src = `(function(){var t=${JSON.stringify(token)};fetch(${JSON.stringify(
    origin + "/api/machine/capture"
  )},{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+t},body:JSON.stringify({url:location.href,title:document.title,html:document.documentElement.outerHTML})}).then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d}})}).then(function(x){alert(x.ok?("Saved to Ledgr"+(x.d.extracted?" (with content)":" (link only)")):("Ledgr: "+(x.d.error||"failed")))}).catch(function(e){alert("Ledgr: "+e)})})();`;
  return "javascript:" + encodeURIComponent(src);
}

export default function ClipperSetup({ origin }: { origin: string }) {
  const [token, setToken] = useState("");
  const linkRef = useRef<HTMLAnchorElement>(null);
  const trimmed = token.trim();

  // Set the href imperatively: React sanitizes `javascript:` hrefs in JSX, so
  // we write the attribute straight to the DOM node instead.
  useEffect(() => {
    const el = linkRef.current;
    if (!el) return;
    if (trimmed) {
      el.setAttribute("href", buildBookmarklet(origin, trimmed));
    } else {
      el.removeAttribute("href");
    }
  }, [origin, trimmed]);

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-xs text-neutral-500">
          Paste an api-scoped token. It&rsquo;s baked into the bookmarklet and
          stays in your browser.
        </label>
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="paste token here"
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 font-mono text-xs text-neutral-300 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          ref={linkRef}
          draggable={!!trimmed}
          onClick={(e) => e.preventDefault()}
          aria-disabled={!trimmed}
          className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold ${
            trimmed
              ? "cursor-grab border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent)] active:cursor-grabbing"
              : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-600"
          }`}
        >
          📎 Clip to Ledgr
        </a>
        <span className="text-xs text-neutral-500">
          {trimmed
            ? "Drag this to your bookmarks bar."
            : "Paste a token to activate."}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-neutral-500">
        On desktop: drag the button to your bookmarks bar, then click it on any
        page to save it (with its readable content, images stripped) to your
        Inbox. On mobile, share a link to the installed Ledgr app instead — the
        share sheet route captures content the same way. The token sits in the
        bookmark, so treat the bookmark as a secret; revoke it by removing the
        entry from{" "}
        <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-neutral-400">
          LEDGR_API_TOKENS
        </code>
        .
      </p>
    </div>
  );
}
