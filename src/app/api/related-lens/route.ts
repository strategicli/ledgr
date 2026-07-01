// Related-panel lens choice endpoint. A focused route like the list-tabs one: it
// writes only the owner's settings.relatedLensChoices[hostType:relatedType]
// entry (the lens that structures that related-type group on a detail page),
// never the type definition or anything else. Owner UI config — settings, no
// schema change. Body:
//   { hostType, relatedType, lensId }        → set the choice
//   { hostType, relatedType, lensId: null }  → clear it (back to the default lens)
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { relatedLensKey } from "@/lib/list-lenses";
import { getSettings, updateSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json()) as {
      hostType?: unknown;
      relatedType?: unknown;
      lensId?: unknown;
    };
    const hostType = typeof body.hostType === "string" ? body.hostType.trim() : "";
    const relatedType = typeof body.relatedType === "string" ? body.relatedType.trim() : "";
    if (!hostType || !relatedType) {
      return NextResponse.json({ error: "hostType and relatedType required" }, { status: 400 });
    }
    const key = relatedLensKey(hostType, relatedType);
    const settings = await getSettings(owner.id);
    const relatedLensChoices = { ...settings.relatedLensChoices };
    const lensId =
      typeof body.lensId === "string" && body.lensId.trim() ? body.lensId.trim().slice(0, 40) : null;
    if (lensId) {
      relatedLensChoices[key] = lensId;
    } else {
      delete relatedLensChoices[key];
    }
    await updateSettings(owner.id, { relatedLensChoices });
    return NextResponse.json({ ok: true, lensId: relatedLensChoices[key] ?? null });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
