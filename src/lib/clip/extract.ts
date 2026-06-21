// Web clipper extraction (ADR-100, explorations/web-clipper.md). The single
// place that turns a page's HTML into clean article markdown, shared by the
// bookmarklet capture endpoint (/api/machine/capture) and the mobile share
// target (/capture/share) so the two surfaces can never drift.
//
// Deterministic by design (Principle 3, no model): Mozilla Readability finds
// the article, Turndown serializes it to markdown. IMAGES ARE STRIPPED — slice
// 1 keeps the body text-only (Brandon, 2026-06-21). Markdown only ever stores
// references anyway, so the DB never balloons; this drops even those. A later
// "archive images" option (resize → WebP → R2) can layer on without touching
// this contract.
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

export type ClippedArticle = { title: string | null; markdown: string };

const TITLE_MAX = 300;
const FETCH_TIMEOUT_MS = 8000;
// An article's HTML is comfortably under this; the cap bounds a hostile or
// runaway page so server-side fetch can't read forever.
const MAX_HTML_CHARS = 3 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (compatible; LedgrClipper/1.0; +https://github.com/ledgr)";

// Media we never keep (slice 1 is text-only). Dropped wholesale, including the
// markdown reference, so nothing image-shaped survives into the body.
const STRIPPED_TAGS = [
  "img",
  "picture",
  "svg",
  "video",
  "audio",
  "iframe",
  "noscript",
];

function makeTurndown(pageUrl: string): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  // A removal rule, not turndown's `remove()`: the built-in image rule
  // otherwise wins for <img> and re-emits `![]()`. Returning "" here drops the
  // element and any reference with it.
  td.addRule("stripMedia", {
    filter: (node) => STRIPPED_TAGS.includes(node.nodeName.toLowerCase()),
    replacement: () => "",
  });
  // Absolutize links against the page URL so a clipped article's references
  // still resolve once it lives in Ledgr, away from the source origin. Anchors
  // with no visible text, or non-http(s) targets, collapse to plain text.
  td.addRule("absoluteLinks", {
    filter: (node) => node.nodeName === "A" && !!node.getAttribute("href"),
    replacement: (content, node) => {
      const text = content.trim();
      if (!text) return "";
      const href = (node as Element).getAttribute("href") ?? "";
      let abs: string;
      try {
        abs = new URL(href, pageUrl).toString();
      } catch {
        return text;
      }
      return /^https?:/i.test(abs) ? `[${text}](${abs})` : text;
    },
  });
  return td;
}

function cleanTitle(raw: string | null | undefined): string | null {
  const t = raw?.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  return t || null;
}

// Extract clean article markdown from a page's already-loaded HTML (the path
// the bookmarklet uses, sending the live DOM so auth'd/SPA pages work). Returns
// null when there's no extractable article — the caller falls back to URL-only.
export function extractArticle(
  html: string,
  pageUrl: string
): ClippedArticle | null {
  let document: ReturnType<typeof parseHTML>["document"];
  try {
    ({ document } = parseHTML(html));
  } catch {
    return null;
  }
  let parsed;
  try {
    // Readability mutates the document in place; we hand it a throwaway parse.
    parsed = new Readability(document).parse();
  } catch {
    return null;
  }
  if (!parsed?.content) return null;
  const markdown = makeTurndown(pageUrl).turndown(parsed.content).trim();
  if (!markdown) return null;
  return { title: cleanTitle(parsed.title), markdown };
}

// Fetch a public page server-side and extract it (the mobile path: the share
// sheet hands us only a URL, never the DOM). Bounded — 8s, http(s) + html only,
// capped read — and best-effort: any failure (timeout, paywall, non-article)
// returns null so capture still lands a URL-only item.
export async function fetchAndExtract(
  url: string
): Promise<ClippedArticle | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "text/html", "user-agent": USER_AGENT },
      redirect: "follow",
    });
  } catch {
    return null;
  }
  if (!res.ok || !res.headers.get("content-type")?.includes("text/html")) {
    return null;
  }
  const reader = res.body?.getReader();
  if (!reader) return null;
  let html = "";
  const decoder = new TextDecoder();
  try {
    while (html.length < MAX_HTML_CHARS) {
      const { done, value } = await reader.read();
      if (value) html += decoder.decode(value, { stream: true });
      if (done) break;
    }
  } catch {
    return null;
  } finally {
    reader.cancel().catch(() => {});
  }
  return extractArticle(html, url);
}
