import { redirect } from "next/navigation";
import { makeMarkdownBody } from "@/lib/body";
import { fetchAndExtract } from "@/lib/clip/extract";
import { resolveOwner } from "@/lib/owner";
import { createItem } from "@/lib/items";

// PWA share target (slice 16; the quick-capture path ADR-013 deferred here).
// The manifest points Android's share sheet at this page as a GET, so a
// share is just a navigation: a shared URL lands as a link item, bare text
// as the catch-all `unmarked` (capture's default type, ADR-067), both
// inbox: true — capture never
// auto-triages (ADR-010). Middleware keeps the route signed-in-only; Clerk
// bounces a signed-out share through /sign-in and back.
//
// Web clipper, mobile half (ADR-100): the share sheet hands us only a URL, so
// for a link we fetch + extract the page's readable content into the body
// (images stripped). Best-effort — a paywall/non-article page still lands the
// URL + title, same as before.
export const dynamic = "force-dynamic";

// Android puts the URL in `url` or (commonly) at the end of `text`.
function extractUrl(...candidates: (string | undefined)[]): string | null {
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

export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const params = await searchParams;
  const str = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  const title = str(params.title);
  const text = str(params.text);
  const url = extractUrl(str(params.url), text);

  let itemId: string;
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
    const item = await createItem(owner.id, {
      type: "link",
      title: itemTitle.slice(0, 300),
      url,
      inbox: true,
      body: article ? makeMarkdownBody(article.markdown) : null,
    });
    itemId = item.id;
  } else {
    const itemTitle = [title, text].filter(Boolean).join(" ").trim();
    if (!itemTitle) redirect("/"); // empty share: nothing to capture
    const item = await createItem(owner.id, {
      type: "unmarked",
      title: itemTitle.slice(0, 300),
      inbox: true,
    });
    itemId = item.id;
  }
  // Land on the captured item: confirms the share took and invites triage.
  redirect(`/items/${itemId}`);
}
