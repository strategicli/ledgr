import { listIcsTasks, resolveIcsOwner } from "@/lib/ics-data";
import { buildTaskCalendar } from "@/lib/ics";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

// GET /api/ics/[token].ics — the public, read-only task calendar feed (T4,
// ADR-079). No Clerk (the route is in the proxy public set); the unguessable
// token is the credential. Cached at the edge so a Sunday with no app/DB access
// still serves the last good feed.
export async function GET(request: Request, context: Context) {
  // The token carries an ".ics" suffix in the subscribe URL (so calendar apps
  // recognize the file); strip it before resolving.
  const raw = (await context.params).token;
  const token = raw.replace(/\.ics$/i, "");

  const ownerId = await resolveIcsOwner(token);
  if (!ownerId) {
    return new Response("Not found", { status: 404 });
  }

  // Absolute origin from the request, so event links work on prod/preview/local
  // without an env var (the AI & MCP page pattern).
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("host") ?? "localhost:3000";
  const origin = `${proto}://${host}`;

  const tasks = await listIcsTasks(ownerId, origin);
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const body = buildTaskCalendar(tasks, { name: "Ledgr Tasks", dtstamp });

  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="ledgr-tasks.ics"',
      // Cacheable at the CDN (cheap origin, Sunday-proof) while staying fresh
      // within ~5 min; calendar apps poll on their own ~hourly cadence anyway.
      "cache-control": "public, s-maxage=300, stale-while-revalidate=3600",
      "x-robots-tag": "noindex",
    },
  });
}
