import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import {
  ensureNoteEditingPrompt,
  revertNoteEditingPrompt,
} from "@/lib/note-editing-prompt";

// The Note Editing Partner prompt item (ADR-161). GET returns its id (seeding it
// if the feature is on but the item is missing) so the settings surface can link
// to it; POST reverts its body to the repo-canonical default. Both require Live
// editing context to be on. Clerk-authed, owner-scoped.
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    if (!(await getSettings(owner.id)).liveContextEnabled) {
      return NextResponse.json({ error: "live editing context is off" }, { status: 409 });
    }
    return NextResponse.json({ id: await ensureNoteEditingPrompt(owner.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST — revert the prompt to the canonical default text.
export async function POST() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    if (!(await getSettings(owner.id)).liveContextEnabled) {
      return NextResponse.json({ error: "live editing context is off" }, { status: 409 });
    }
    return NextResponse.json({ id: await revertNoteEditingPrompt(owner.id) });
  } catch (err) {
    return errorResponse(err);
  }
}
