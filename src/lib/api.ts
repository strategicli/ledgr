// Shared plumbing for the user-facing /api/items* routes: owner resolution and
// ItemError -> HTTP mapping. The request-body parsing/validation now lives in
// the pure (next/server-free) item-input.ts so the MCP tools and verify scripts
// can reuse it in a node context; it's re-exported here so route call sites
// import it from @/lib/api as before.
import { NextResponse } from "next/server";
import { captureError } from "@/lib/log";
import { resolveOwner, type Owner } from "@/lib/owner";
import { ItemError } from "@/lib/items";

export { asUuid, parseItemPayload } from "@/lib/item-input";

// The middleware already turns signed-out API calls away; this guards the
// resolveOwner null (unknown-but-authenticated user, or keyless local run).
export async function requireOwner(): Promise<Owner | NextResponse> {
  const owner = await resolveOwner();
  if (!owner) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return owner;
}

// ItemErrors are expected request outcomes (4xx); anything else is a real
// failure: captured to error_log (rule 9, no silent failures) and answered
// with the correlation id so a user report can be matched to its log lines.
export async function errorResponse(err: unknown): Promise<NextResponse> {
  if (err instanceof ItemError) {
    return NextResponse.json(
      { error: err.message },
      { status: err.code === "not_found" ? 404 : 400 }
    );
  }
  const correlationId = crypto.randomUUID();
  await captureError("api", err, { correlationId });
  return NextResponse.json(
    { error: "internal error", correlationId },
    { status: 500 }
  );
}
