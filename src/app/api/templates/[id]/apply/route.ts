import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { applyTemplateToExisting, createItemFromTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// Coerce a JSON body's `answers` into Record<string,string> for {{ask:Label}}
// resolution (TPL3). Tolerant: a non-object, or non-string values, is ignored.
function parseAnswers(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

// POST /api/templates/[id]/apply — resolve {{tokens}} (dates / {{title}} /
// {{ask:Label}} answers from the body) and either:
//   • create a new item by deep-cloning the prototype (no targetId), or
//   • merge the template into an existing item (targetId + mode, TPL4b).
// A distinct endpoint from POST /api/items so "apply a template" is explicit and
// the template store owns the seeding/merge logic.
export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      answers?: unknown;
      targetId?: unknown;
      mode?: unknown;
    };
    const answers = parseAnswers(body.answers);
    if (typeof body.targetId === "string" && body.targetId) {
      const targetId = asUuid(body.targetId, "targetId");
      const mode = body.mode === "overwrite" ? "overwrite" : "fill";
      const item = await applyTemplateToExisting(owner.id, id, targetId, { mode, answers });
      return NextResponse.json({ item }, { status: 200 });
    }
    const item = await createItemFromTemplate(owner.id, id, { answers });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
