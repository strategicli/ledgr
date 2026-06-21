# Exploration: web clipper (browser extension + mobile content capture)

**Status:** **slice 1 BUILT (2026-06-21, ADR-099)** — Brandon pulled it forward. Shipped: a shared extraction module (Readability → Turndown markdown, **images stripped**, links absolutized), `POST /api/machine/capture` (api token, CORS-open), a Build → AI & MCP bookmarklet generator (desktop), and the mobile PWA share target extended to fetch + extract content. Deferred per Brandon: images (text-only for now; "archive images → R2" left as a future opt-in), a full Chrome/Firefox extension (bookmarklet first), paywall handling beyond URL-only fallback, `link`→`note` auto-promotion. *(Originally parked 2026-06-13, reaffirmed 6.14: "Evernote-style, save a web article as Markdown into Ledgr.")*

## What's already in v1

The PWA share target (ADR-016) handles the mobile baseline: sharing a URL from any Android app fires the share sheet, Ledgr catches it, and a `link` item lands in the Inbox with the URL and page title. That covers the "I want to save this link" use case.

## What this adds

The v1 share target captures URL + title only. A proper web clipper captures the **content** of the page — the same gap Evernote Web Clipper and Notion's browser extension fill.

### Desktop: bookmarklet (lightest path) or Chrome extension

**Bookmarklet (recommended starting point).** A bookmarklet is a browser bookmark whose URL is a `javascript:` snippet — click it and it runs in the context of the current page. No extension store approval, no install flow; you drag one link to the bookmarks bar once and it works in Chrome, Firefox, Safari, and Edge identically.

The bookmarklet would:
1. Run [Readability](https://github.com/mozilla/readability) (injected or bundled inline) against the current page to extract clean article content.
2. Capture selected text if there's a selection, or fall back to the full extracted content.
3. Open a small prefill panel (either a `window.open` popup pointed at a Ledgr capture URL, or an injected overlay) pre-populated with the URL, title, and clipped text.
4. Submit to the Ledgr API using a machine token stored in the popup's origin (not accessible to the host page).

The main limitation is CSP: pages with a strict `Content-Security-Policy` that blocks inline scripts will silently prevent the bookmarklet from running. For those pages the popup/redirect path still works (URL + title only, no DOM access). This covers the common case well.

**Chrome extension (heavier, broader coverage).** A full extension adds a persistent background context, a proper toolbar button with a popup panel, and immunity to the host page's CSP. Worth building if the bookmarklet's CSP limitation proves frequent in practice. Manifest v3 is now shared with Firefox, so a single codebase covers both. Auth is the same machine-token pattern either way.

Common to both:
- One-click capture: URL, title, and readable content as markdown.
- Optional selected-text-only capture.
- Optionally pre-populate entity associations before saving.
- Lands in the Inbox as a `link` item (or `note` for substantial clipped content).
- Auth via a machine token scoped to the Ledgr API, same as MCP/cron.

### Android: richer share target or companion app

The existing PWA share target already intercepts the share sheet on Android — the question is whether the landing page can extract more content from what the OS passes. The Web Share Target API gives the URL and title; it does not give the page HTML. Options:

1. **Readability fetch on the server:** the capture landing page takes the URL and fetches + extracts the content server-side (works for public pages, fails for pages behind auth or paywalls).
2. **Android intent extras:** some Android browsers pass selected text through the share intent; the share target can attempt to capture that.
3. **Native Android companion app:** full clipper access to the DOM, but a separate build and maintenance surface.

Option 1 (server-side Readability fetch) is the lightest lift and covers the common case.

### iOS

Not a Brandon use case, but Tyler may want it. The PWA share target works on iOS Safari in the same way as Android (URL + title). Server-side Readability fetch (option 1 above) would apply identically. A Safari extension is a separate, heavier effort.

## Relationship to existing design

- The `link` item type already has a `url` column and an `inbox` flag — the data model needs no changes.
- The `body` column (`{format, text}`) stores the clipped markdown naturally.
- The API machine-token auth pattern (already used by MCP and cron) gives the extension a clean auth path without coupling it to Clerk.

## Open questions

- Does the desktop extension use the Ledgr API directly, or go through the same server-side fetch path used for mobile (so content extraction logic lives in one place)?
- For paywalled content (NYT, etc.): capture URL-only silently, or surface a "couldn't extract content" state in the Inbox item?
- Should a clipped `link` item auto-promote to `note` when there's substantial body content, or always stay `link` and let the user retype it?
- Firefox extension: add immediately alongside Chrome (Manifest v3 is now shared), or defer?
