import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { duplicateTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// POST /api/templates/[id]/duplicate — clone a template's prototype into a new
// template prototype + registry row ("Copy of …"), never the default (ADR-093,
// TPL2). Returns the new template so the caller can open its prototype.
export async function POST(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { id } = await context.params;
    const template = await duplicateTemplate(owner.id, id);
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
