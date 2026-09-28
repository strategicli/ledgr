import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { createType, listTypes, parseTypeInput } from "@/lib/types";
import { tabsEnabledForType } from "@/lib/modules";

export const dynamic = "force-dynamic";

// GET /api/types — the full type registry (system + user). Not owner-scoped
// (types are instance-global), but still behind requireOwner so only the
// signed-in user reads it. Each type carries `tabs`, whether its body edits as
// canvas tabs, so a client surface (the Desk) doesn't re-derive the rule.
export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const types = (await listTypes()).map((t) => ({
      ...t,
      tabs: tabsEnabledForType(t.key, owner.id, t.capability),
    }));
    return NextResponse.json({ types });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/types — create a user type from the builder payload.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const input = parseTypeInput(await request.json(), "create");
    const type = await createType(input);
    return NextResponse.json({ type }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
