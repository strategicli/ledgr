import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { getSettings, updateSettings, type UserSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// GET /api/settings — the signed-in owner's UI settings (defaults filled in).
export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    return NextResponse.json({ settings: await getSettings(owner.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/settings — merge a partial settings patch (validated in the store).
export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const patch = (await request.json()) as Partial<UserSettings>;
    return NextResponse.json({ settings: await updateSettings(owner.id, patch) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
