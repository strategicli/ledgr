import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { restoreType } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

// POST /api/types/[key]/restore — bring a soft-deleted type back from Trash
// along with the items trashed alongside it (ADR-058). 404s if the type isn't
// in Trash.
export async function POST(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const result = await restoreType(owner.id, key);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
