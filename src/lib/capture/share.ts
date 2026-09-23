// Shared-capture logic for the PWA share target (slice 16; web clipper mobile
// half, ADR-100). Lifted verbatim out of the old /capture/share *page* when that
// route became a POST handler (to also accept shared files, ADR for the
// transcript-file share path): a shared URL lands as a `link` item with the
// page's readable content extracted into the body, bare text as the catch-all
// `unmarked` (capture's default type, ADR-067), both naming their arrival path
// as "share_target" so the owner's Capture routing places them — capture never
// auto-triages (ADR-010). Keeping this in one module means the URL/text behavior
// is identical whether the share arrived as the old GET or the new POST.
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { makeMarkdownBody } from "@/lib/body";
import { fetchAndExtract } from "@/lib/clip/extract";
import { createItem } from "@/lib/item-mutations";

// Absolute base for the share flow's 303 redirects.
//
// NOT `new URL(path, request.url)`, which is what this used to be: a
// POST-navigation route handler reads `request.url` back as
// http://localhost:3000 (Next builds an internal origin for it), so every
// share 303'd Android's share sheet to a dead localhost URL and the whole
// mobile-share feature looked broken. The host the phone actually reached us
// on only ever lives in the headers. Don't put request.url back here.
//
// Deliberately not lib/auth/oauth.ts's originFromRequest(): that one assumes
// https whenever the host isn't literally "localhost", which is wrong for the
// case that matters most here — a local install reached over the tailnet at
// http://<magicdns-name>:3000, with no proxy and no forwarded-proto header.
export function shareRedirectBase(request: Request): string {
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  // No Host at all shouldn't happen; fall back rather than build an empty base.
  if (!host) return new URL(request.url).origin;
  // A forwarded proto means a proxy in front (Vercel always sets it, and may
  // send a list). Absent, we were reached directly, so the request's own
  // scheme is the truth.
  const forwarded = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwarded || new URL(request.url).protocol.replace(/:$/, "");
  return `${proto}://${host.split(",")[0].trim()}`;
}


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

// One clip, one item — enforced here, where every capture path lands, because
// the client-side latches can't cover all of it. The bookmarklet's half of the
// handshake (retire the listener once the relay reports the save, ADR-238 fix)
// lives in a bookmark the owner dragged to their bar, which is a FROZEN COPY of
// whatever the code said that day: an older bookmark still answers every
// "ready" ping forever, so any second load of the relay popup (the sign-in
// detour, a Clerk handshake reload) gets handed the clip again, and a fresh
// page instance has a fresh latch. The claim route has the same shape of hole
// on a refresh/back-button revisit. A short window keyed on the URL closes all
// of them at once, and no bookmark ever needs re-dragging again.
//
// ponytail: a bounded lookback, not a uniqueness constraint — re-clipping the
// same page tomorrow is legitimate, and the owner keeps that.
const RECAPTURE_WINDOW_MS = 2 * 60 * 1000;

// The owner's most recent live capture of this URL inside the window, if any.
export async function recentCaptureId(
  ownerId: string,
  url: string
): Promise<string | null> {
  const rows = await getDb()
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        // Both capture paths file a URL as a `link`, so keep the match to
        // those: an event or a note that happens to carry the same address
        // must never swallow a clip.
        eq(items.type, "link"),
        eq(items.url, url),
        isNull(items.deletedAt),
        gte(items.createdAt, new Date(Date.now() - RECAPTURE_WINDOW_MS))
      )
    )
    .orderBy(desc(items.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

// Titles are capped here; anything past the cap would be lost, so longer text
// always goes to a body instead (below).
const TITLE_MAX = 300;

// Shared text too big to be a quick capture: a recording app handing over a
// whole transcript as text rather than as a .txt file (seen 2026-09-22, where
// it became a 300-character title and the rest of the transcript was dropped).
// Such a share goes to the share screen, like a shared file does.
export function isLongShare(text: string): boolean {
  return text.length > TITLE_MAX || text.split("\n").filter((l) => l.trim()).length > 3;
}

// Does this text read like a meeting transcript? Speaker labels ("[Speaker 1]",
// "Speaker 2:", "Jane Doe:") or timestamps at line starts ("00:01:23", "12:04 ").
// Only decides which option the share screen offers FIRST, so a miss costs a
// tap, never data. ponytail: a regex heuristic; extend the patterns if a
// recorder's format keeps landing on "Save as a note" first.
export function looksLikeTranscript(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  const cues = lines.filter((l) =>
    /^\s*(\[?speaker\s*\d+\]?|\[?\d{1,2}:\d{2}(:\d{2})?\]?\s|[A-Z][\w.'-]*( [A-Z][\w.'-]*){0,2}:\s)/i.test(l)
  ).length;
  return /\[speaker\s*\d+\]/i.test(text) || cues >= Math.min(3, lines.length);
}

// A short title from a long shared text: its first non-empty line, capped.
export function titleFromSharedText(text: string): string {
  const first = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  return (first.length > 120 ? `${first.slice(0, 117).trimEnd()}…` : first) || "Shared text";
}

// Every share that isn't a file lands here (both the signed-in POST and the
// cold-session claim), and returns the path to send the phone to. A link keeps
// the web-clipper path; a long text becomes an inbox transcript and opens the
// share screen, where the owner files it to a meeting, as a note, or leaves it
// in the Inbox; a short text stays a one-tap quick capture.
export async function captureShare(
  ownerId: string,
  fields: { title?: string; text?: string; url?: string }
): Promise<string> {
  const text = fields.text?.trim();
  // An explicit `url` field is a link share even with long text beside it; a
  // URL merely MENTIONED inside a long text (a transcript naming a website)
  // must not turn the whole transcript into a link title.
  if (text && !fields.url?.trim() && isLongShare(text)) {
    // Dynamic import: meetings/transcripts pulls in the item-mutations graph
    // this module's pure helpers (and their verify script) don't need.
    const { createInboxTranscript } = await import("@/lib/meetings/transcripts");
    const transcript = await createInboxTranscript(ownerId, {
      title: fields.title?.trim() || titleFromSharedText(text),
      text,
    });
    return `/capture/transcript/${transcript.id}`;
  }
  const id = await captureSharedUrlOrText(ownerId, fields);
  return id ? `/items/${id}` : "/";
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
    // Already filed moments ago: hand back that item instead of a second one.
    // Before the extract, so a re-delivered share costs nothing either.
    const already = await recentCaptureId(ownerId, url);
    if (already) return already;
    // Pull the readable article (one bounded fetch) so the clip carries content,
    // not just the link. Null on a paywall/non-article page — we degrade to
    // URL + title.
    const article = await fetchAndExtract(url);
    // Shared title wins; then the text minus the URL (share sheets often
    // send "Page title https://…"); then the extracted/page <title>; then host.
    const fromText = text?.replace(url, "").trim();
    // Text too long for a title rides at the top of the body instead of being
    // cut off.
    const longText = fromText && fromText.length > TITLE_MAX ? fromText : undefined;
    const itemTitle =
      title ||
      (longText ? undefined : fromText) ||
      article?.title ||
      (await fetchPageTitle(url)) ||
      new URL(url).hostname;
    const item = await createItem(ownerId, {
      type: "link",
      title: itemTitle.slice(0, TITLE_MAX),
      url,
      source: "share_target",
      body:
        longText || article
          ? makeMarkdownBody([longText, article?.markdown].filter(Boolean).join("\n\n"))
          : null,
    });
    return item.id;
  }

  const joined = [title, text].filter(Boolean).join(" ").trim();
  if (!joined) return null; // empty share: nothing to capture
  // Never truncate away what was shared: an over-long capture keeps a short
  // title and the whole text in its body.
  const tooLong = joined.length > TITLE_MAX;
  const item = await createItem(ownerId, {
    type: "unmarked",
    title: tooLong ? title?.slice(0, TITLE_MAX) || titleFromSharedText(joined) : joined,
    source: "share_target",
    body: tooLong ? makeMarkdownBody(text ?? joined) : null,
  });
  return item.id;
}
