import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { updateSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// POST /api/ics/token — mint (or rotate) the owner's published ICS feed token
// and store it in settings (T4, ADR-079). 18 random bytes base64url (~144 bits),
// the share-token security posture. Rotating invalidates the old subscribe URL.
export async function POST() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const token = randomBytes(18).toString("base64url");
    await updateSettings(owner.id, { icsToken: token });
    return NextResponse.json({ token });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/ics/token — stop publishing the feed (the subscribe URL 404s).
export async function DELETE() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    await updateSettings(owner.id, { icsToken: null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
