import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { readSyncHubs, writeSyncHubs } from "@/lib/sync/client";

export const dynamic = "force-dynamic";

// The GUI-editable hub list (ADR-209): which hubs THIS instance syncs to,
// each with its own device token minted on that hub. Owner-authed like
// /api/sync/mode; the store is job_state (never synced), and the sync loop
// re-reads it every tick, so add/remove takes effect with no restart.
//
// Tokens are write-only through this API: GET never returns them (they are
// bearer credentials for the remote hub), and there is no edit — replacing a
// token is remove + add, which keeps the surface tiny.

// One normalization for both write paths: a valid absolute http(s) origin-ish
// URL, no trailing slash. Throws a plain Error with the user-facing message.
function normalizeHubUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("hub URL is required");
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("hub URL must be a full URL, like https://hub.example.com");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("hub URL must be http(s)");
  }
  return parsed.toString().replace(/\/$/, "");
}

// GET /api/sync/hubs — the effective list, token-free.
export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const hubs = await readSyncHubs();
    return NextResponse.json({ hubs: hubs.map((h) => ({ url: h.url })) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/sync/hubs {url, token} — add a hub. The first write copies the
// current effective list (which may have come from env) into the store, so
// env config and GUI edits never fight: after the first edit, the store owns
// the list.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json()) as { url?: unknown; token?: unknown };
    let url: string;
    try {
      url = normalizeHubUrl(body.url);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json(
        { error: "a device token minted on that hub is required" },
        { status: 400 }
      );
    }
    const current = await readSyncHubs();
    if (current.some((h) => h.url === url)) {
      return NextResponse.json({ error: "that hub is already configured" }, { status: 409 });
    }
    await writeSyncHubs([...current, { url, token }]);
    return NextResponse.json({ hubs: (await readSyncHubs()).map((h) => ({ url: h.url })) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// DELETE /api/sync/hubs {url} — remove a hub. Removing the last one is
// allowed and means "stop syncing" (an empty stored list deliberately does
// NOT fall back to env — see effectiveHubs).
export async function DELETE(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json()) as { url?: unknown };
    let url: string;
    try {
      url = normalizeHubUrl(body.url);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    const current = await readSyncHubs();
    if (!current.some((h) => h.url === url)) {
      return NextResponse.json({ error: "no such hub" }, { status: 404 });
    }
    await writeSyncHubs(current.filter((h) => h.url !== url));
    return NextResponse.json({ hubs: (await readSyncHubs()).map((h) => ({ url: h.url })) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
