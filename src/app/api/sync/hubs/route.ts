import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import {
  hubCadence,
  hubFallback,
  hubListRefusal,
  readSyncHubs,
  writeSyncHubs,
  type HubCadence,
  type HubConfig,
  type HubFallback,
} from "@/lib/sync/client";

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

// The two ADR-210 axes, validated the same way on every write path. Absent
// means "leave as is" on PATCH and "the default" on POST.
function parseCadence(raw: unknown): HubCadence | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === "continuous" || raw === "daily") return raw;
  throw new Error("cadence must be \"continuous\" or \"daily\"");
}
function parseFallback(raw: unknown): HubFallback | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === "automatic" || raw === "prompt") return raw;
  throw new Error("fallback must be \"automatic\" or \"prompt\"");
}

// One gate for every write: the list has to keep at least one automatic hub,
// or this instance would never sync unattended (ADR-210).
function refuseList(hubs: HubConfig[]): NextResponse | null {
  const refusal = hubListRefusal(hubs);
  return refusal ? NextResponse.json({ error: refusal }, { status: 400 }) : null;
}

function publicHubs(hubs: HubConfig[]) {
  return hubs.map((h) => ({
    url: h.url,
    cadence: hubCadence(h),
    fallback: hubFallback(h),
  }));
}

// GET /api/sync/hubs — the effective list, token-free.
export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const hubs = await readSyncHubs();
    return NextResponse.json({ hubs: publicHubs(hubs) });
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
    let cadence: HubCadence | undefined;
    let fallback: HubFallback | undefined;
    try {
      cadence = parseCadence((body as { cadence?: unknown }).cadence);
      fallback = parseFallback((body as { fallback?: unknown }).fallback);
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
    const next = [
      ...current,
      { url, token, cadence: cadence ?? "continuous", fallback: fallback ?? "automatic" },
    ];
    const refused = refuseList(next);
    if (refused) return refused;
    await writeSyncHubs(next);
    return NextResponse.json({ hubs: publicHubs(await readSyncHubs()) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}

// PATCH /api/sync/hubs {url, cadence?, fallback?, move?} — change how a hub
// behaves, or move it in the priority order. Order IS priority (automatic
// hubs are tried in order, then emergency hubs are offered in order), and
// before this endpoint promoting a hub meant remove + re-add, which threw the
// token away and made the owner mint a new one. Tokens are still write-only:
// nothing here reads or returns one.
export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json()) as {
      url?: unknown;
      cadence?: unknown;
      fallback?: unknown;
      move?: unknown;
    };
    let url: string;
    let cadence: HubCadence | undefined;
    let fallback: HubFallback | undefined;
    try {
      url = normalizeHubUrl(body.url);
      cadence = parseCadence(body.cadence);
      fallback = parseFallback(body.fallback);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    if (body.move !== undefined && body.move !== "up" && body.move !== "down") {
      return NextResponse.json({ error: 'move must be "up" or "down"' }, { status: 400 });
    }
    const current = await readSyncHubs();
    const i = current.findIndex((h) => h.url === url);
    if (i < 0) return NextResponse.json({ error: "no such hub" }, { status: 404 });

    const next = current.map((h) =>
      h.url === url
        ? { ...h, cadence: cadence ?? hubCadence(h), fallback: fallback ?? hubFallback(h) }
        : h
    );
    if (body.move) {
      const j = body.move === "up" ? i - 1 : i + 1;
      if (j >= 0 && j < next.length) {
        [next[i], next[j]] = [next[j], next[i]];
      }
    }
    const refused = refuseList(next);
    if (refused) return refused;
    await writeSyncHubs(next);
    return NextResponse.json({ hubs: publicHubs(await readSyncHubs()) });
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
    const next = current.filter((h) => h.url !== url);
    const refused = refuseList(next);
    if (refused) return refused;
    await writeSyncHubs(next);
    return NextResponse.json({ hubs: publicHubs(await readSyncHubs()) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
