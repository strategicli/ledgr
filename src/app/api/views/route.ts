import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { createView, listViews, parseViewInput } from "@/lib/views";

export const dynamic = "force-dynamic";

// GET /api/views — owner-scoped list of stored View Definitions.
export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    return NextResponse.json({ views: await listViews(owner.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/views — create a view from the builder payload.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const input = parseViewInput(await request.json());
    const view = await createView(owner.id, input);
    return NextResponse.json({ view }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
