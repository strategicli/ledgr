import { NextResponse } from "next/server";
import { asUuid } from "@/lib/api";
import { verifyApiToken } from "@/lib/auth/oauth";
import { ItemError } from "@/lib/items";
import { relateItems } from "@/lib/relations";
import { resolveMachineOwner } from "@/lib/machine/owner";
import { captureError } from "@/lib/log";

// POST /api/machine/relations — batch-create relation edges with an `api`-scoped
// machine token (ADR-112). Mirrors POST /api/machine/items: a bare edge or
// { relations: [...] }, each edge { sourceId, targetId, role? }. A bad edge is
// reported in `errors` and skipped, never failing the rest. Idempotent via the
// unique (source_id, target_id, role) constraint (relateItems onConflictDoUpdate).
// Both endpoints exist so the migration can wire tags/attendees/threading/sub-pages
// that POST /api/machine/items can't carry.
export const dynamic = "force-dynamic";

const MAX_BATCH = 100;

export async function POST(request: Request) {
  const identity = verifyApiToken(request.headers.get("authorization"));
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ownerId = await resolveMachineOwner();
  if (!ownerId) {
    return NextResponse.json({ error: "owner not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const batch = (body as { relations?: unknown })?.relations;
  const rawEdges = Array.isArray(batch) ? batch : [body];
  if (rawEdges.length === 0) {
    return NextResponse.json({ count: 0, created: [], errors: [] });
  }
  if (rawEdges.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `too many edges (max ${MAX_BATCH} per request)` },
      { status: 400 }
    );
  }

  const created: unknown[] = [];
  const errors: { index: number; error: string }[] = [];
  for (let i = 0; i < rawEdges.length; i++) {
    try {
      const e = rawEdges[i] as Record<string, unknown>;
      const sourceId = asUuid(e.sourceId ?? e.source, "sourceId");
      const targetId = asUuid(e.targetId ?? e.target, "targetId");
      const role =
        typeof e.role === "string" && e.role.trim() ? e.role.trim() : "related";
      created.push(await relateItems(ownerId, sourceId, targetId, role));
    } catch (err) {
      if (err instanceof ItemError) {
        errors.push({ index: i, error: err.message });
      } else {
        const correlationId = crypto.randomUUID();
        await captureError("machine-relations", err, { correlationId, detail: { index: i } });
        errors.push({ index: i, error: `internal error (correlationId ${correlationId})` });
      }
    }
  }

  return NextResponse.json(
    { count: created.length, created, errors },
    { status: created.length > 0 ? 201 : 400 }
  );
}
