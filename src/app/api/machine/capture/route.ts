import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { verifyMachineToken } from "@/lib/auth/machine";
import { makeMarkdownBody } from "@/lib/body";
import { extractArticle, fetchAndExtract } from "@/lib/clip/extract";
import { createItem } from "@/lib/items";
import { resolveMachineOwner } from "@/lib/machine/owner";

// Web clipper capture (ADR-100, explorations/web-clipper.md). The bookmarklet
// (and a later browser extension) POSTs here: the live page URL, its title, and
// optionally the rendered DOM html. We extract clean article markdown (images
// stripped, src/lib/clip/extract.ts) and land a `link` item in the Inbox.
//
// Auth is the same `api`-scoped machine token as /api/machine/items — the token
// IS the credential. Because of that, CORS can be open (`*`): a bookmarklet
// runs on whatever origin the user is reading, and there are no cookies to
// protect. If no html is sent, we fetch + extract the URL server-side (the
// mobile-style path, public pages only). Either way, failure to extract still
// lands a URL-only item — capture never silently drops.
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function cors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

function json(body: unknown, status: number): NextResponse {
  return cors(NextResponse.json(body, { status }));
}

// Preflight: the bookmarklet's cross-origin POST carries Authorization +
// Content-Type, so the browser sends an OPTIONS first.
export function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: Request) {
  const identity = verifyMachineToken(request.headers.get("authorization"), "api");
  if (!identity) return json({ error: "unauthorized" }, 401);

  const ownerId = await resolveMachineOwner();
  if (!ownerId) return json({ error: "owner not configured" }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const rawUrl = typeof payload.url === "string" ? payload.url.trim() : "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return json({ error: "a valid url is required" }, 400);
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return json({ error: "url must be http(s)" }, 400);
  }
  const url = parsedUrl.toString();

  // html present = the bookmarklet sent the live DOM (handles auth'd/SPA pages);
  // absent = fetch and extract the public page ourselves.
  const html = typeof payload.html === "string" ? payload.html : null;
  const article = html ? extractArticle(html, url) : await fetchAndExtract(url);

  const sharedTitle =
    typeof payload.title === "string" ? payload.title.trim() : "";
  const title = (sharedTitle || article?.title || parsedUrl.hostname).slice(0, 300);

  try {
    const item = await createItem(ownerId, {
      type: "link",
      title,
      url,
      inbox: true,
      body: article ? makeMarkdownBody(article.markdown) : null,
    });
    return json({ id: item.id, extracted: article !== null }, 201);
  } catch (err) {
    return cors(await errorResponse(err));
  }
}
