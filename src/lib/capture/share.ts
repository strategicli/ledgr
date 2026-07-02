// Shared-capture logic for the PWA share target (slice 16; web clipper mobile
// half, ADR-100). Lifted verbatim out of the old /capture/share *page* when that
// route became a POST handler (to also accept shared files, ADR for the
// transcript-file share path): a shared URL lands as a `link` item with the
// page's readable content extracted into the body, bare text as the catch-all
// `unmarked` (capture's default type, ADR-067), both inbox: true — capture never
// auto-triages (ADR-010). Keeping this in one module means the URL/text behavior
// is identical whether the share arrived as the old GET or the new POST.
import { makeMarkdownBody } from "@/lib/body";
import { fetchAndExtract } from "@/lib/clip/extract";
import { createItem } from "@/lib/item-mutations";

// Android puts the URL in `url` or (commonly) at the end of `text`.
export function extractUrl(...candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    const match = c?.match(/https?:\/\/\S+/);
    if (match) {
      try {
        return new URL(match[0]).toString();
      } catch {
        // malformed; keep looking
      }
    }
  }
  return null;
}

// Best-effort page title for a shared URL the sheet sent without one (PRD
// §4.4 "URL and page title"). Bounded: 4s, first 64KB, html only; any
// failure falls back to the hostname. Deterministic plumbing, no model.
async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { accept: "text/html" },
      redirect: "follow",
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("text/html")) {
      return null;
    }
    const reader = res.body?.getReader();
    if (!reader) return null;
    let html = "";
    while (html.length < 64 * 1024) {
      const { done, value } = await reader.read();
      if (value) html += new TextDecoder().decode(value, { stream: true });
      if (done || /<\/title>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    const title = html
      .match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();
    return title || null;
  } catch {
    return null;
  }
}

// Capture a shared URL or bare text into the inbox; returns the new item's id,
// or null when there was nothing to capture (an empty share). The caller
// redirects to /items/{id} on a hit.
export async function captureSharedUrlOrText(
  ownerId: string,
  fields: { title?: string; text?: string; url?: string }
): Promise<string | null> {
  const title = fields.title?.trim() || undefined;
  const text = fields.text?.trim() || undefined;
  const url = extractUrl(fields.url?.trim() || undefined, text);

  if (url) {
    // Pull the readable article (one bounded fetch) so the clip carries content,
    // not just the link. Null on a paywall/non-article page — we degrade to
    // URL + title.
    const article = await fetchAndExtract(url);
    // Shared title wins; then the text minus the URL (share sheets often
    // send "Page title https://…"); then the extracted/page <title>; then host.
    const fromText = text?.replace(url, "").trim();
    const itemTitle =
      title ||
      fromText ||
      article?.title ||
      (await fetchPageTitle(url)) ||
      new URL(url).hostname;
    const item = await createItem(ownerId, {
      type: "link",
      title: itemTitle.slice(0, 300),
      url,
      inbox: true,
      body: article ? makeMarkdownBody(article.markdown) : null,
    });
    return item.id;
  }

  const itemTitle = [title, text].filter(Boolean).join(" ").trim();
  if (!itemTitle) return null; // empty share: nothing to capture
  const item = await createItem(ownerId, {
    type: "unmarked",
    title: itemTitle.slice(0, 300),
    inbox: true,
  });
  return item.id;
}
