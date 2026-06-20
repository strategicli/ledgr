import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import {
  createTemplate,
  listTemplates,
  listTemplatesForPicker,
  parseTemplateInput,
} from "@/lib/templates";

export const dynamic = "force-dynamic";

// GET /api/templates[?type=key][&preview=1] — the owner's item templates,
// optionally for one type. preview=1 returns the "+ New" chooser shape
// (default-first + subtask count + has-body); otherwise the full registry rows.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const params = new URL(request.url).searchParams;
    const type = params.get("type") ?? undefined;
    const templates =
      params.get("preview") === "1"
        ? await listTemplatesForPicker(owner.id, type)
        : await listTemplates(owner.id, type);
    return NextResponse.json({ templates });
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
