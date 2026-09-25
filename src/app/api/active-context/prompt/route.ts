import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { routeGate } from "@/lib/modules/gate";
import {
  ensureNoteEditingPrompt,
  revertNoteEditingPrompt,
} from "@/lib/note-editing-prompt";

// The Note Editing Partner prompt item (ADR-162). GET returns its id (seeding it
// if the feature is on but the item is missing) so the settings surface can link
// to it; POST reverts its body to the repo-canonical default. Both belong to the
// live-context module and answer 404 through the shared gate while it is off
// (ADR-272 step 4). Clerk-authed, owner-scoped.
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const off = await routeGate(owner.id, "live-context");
  if (off) return off;
  try {
    return NextResponse.json({ id: await ensureNoteEditingPrompt(owner.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST — revert the prompt to the canonical default text.
export async function POST() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const off = await routeGate(owner.id, "live-context");
  if (off) return off;
  try {
    return NextResponse.json({ id: await revertNoteEditingPrompt(owner.id) });
  } catch (err) {
    return errorResponse(err);
  }
}
