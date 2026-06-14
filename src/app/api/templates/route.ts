import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import {
  createTemplate,
  listTemplates,
  parseTemplateInput,
} from "@/lib/templates";

export const dynamic = "force-dynamic";

// GET /api/templates[?type=key] — the owner's item templates, optionally for
// one type (the "+ New" menu fetches this per type).
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const type = new URL(request.url).searchParams.get("type") ?? undefined;
    return NextResponse.json({ templates: await listTemplates(owner.id, type) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/templates — create a template from the builder payload.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const input = parseTemplateInput(await request.json(), "create");
    const template = await createTemplate(owner.id, input);
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
