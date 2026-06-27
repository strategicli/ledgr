// Per-type floating-TOC endpoint (ADR-114). A focused route like the list-tabs
// one: it writes only this type's entry in the owner's settings.tocByType, never
// the type definition, so it can't clobber a concurrent schema edit or another
// setting. The outline config is owner UI prefs (settings, no schema change) —
// the same posture as navSlots/favorites/listTabs. Body:
//   { config }       → save this type's TOC config { enabled, levels }
//   { config: null } → reset to the default (drop the override)
// Validated/normalized by parseTocConfig, so a malformed shape is a 400-free
// drop (resets to default). Owner-guarded.
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/settings";
import { parseTocConfig } from "@/lib/toc";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const body = (await request.json()) as { config?: unknown };
    const config = body.config == null ? null : parseTocConfig(body.config);
    const settings = await getSettings(owner.id);
    const tocByType = { ...settings.tocByType };
    if (config) {
      tocByType[key] = config;
    } else {
      delete tocByType[key];
    }
    await updateSettings(owner.id, { tocByType });
    return NextResponse.json({ ok: true, config: tocByType[key] ?? null });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
