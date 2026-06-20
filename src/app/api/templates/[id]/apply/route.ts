import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { createItemFromTemplate } from "@/lib/templates";

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

// POST /api/templates/[id]/apply — deep-clone the template's prototype into a
// real item, resolving {{tokens}} (dates / {{title}} / {{ask:Label}} answers
// from the optional request body), and return it so the caller can open it.
// A distinct endpoint from POST /api/items so "create from template" is explicit
// and the template store owns the seeding logic.
export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { answers?: unknown };
    const item = await createItemFromTemplate(owner.id, id, {
      answers: parseAnswers(body.answers),
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
