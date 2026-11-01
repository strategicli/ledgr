// Per-type list-tabs ("list lenses") endpoint. A focused route like the canvas
// layout one (ADR-069): it writes only this type's entry in the owner's
// settings.listTabs, never the type definition, so it can't clobber a concurrent
// schema edit. The lenses are owner UI config (settings, no schema change) — the
// same posture as navSlots/favorites. Body:
//   { lenses }        → save these lenses for the type
//   { lenses: null }  → reset to the virtual defaults (drop the override)
// Each tab is checked strictly (lensProblem: unknown fields or a bad filter are
// a 400 naming them), then normalized by parseLenses,
// and an empty result also resets to defaults. Owner-guarded.
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { lensProblem, parseLenses } from "@/lib/list-lenses";
import { getSettings, updateSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

export async function PATCH(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const { key } = await context.params;
    const body = (await request.json()) as { lenses?: unknown };
    if (Array.isArray(body.lenses)) {
      for (const [i, raw] of body.lenses.entries()) {
        const problem = lensProblem(raw, `lenses[${i}]`);
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      }
    }
    const lenses = body.lenses == null ? null : parseLenses(body.lenses);
    const settings = await getSettings(owner.id);
    const listTabs = { ...settings.listTabs };
    if (lenses && lenses.length) {
      listTabs[key] = lenses;
    } else {
      delete listTabs[key];
    }
    await updateSettings(owner.id, { listTabs });
    return NextResponse.json({ ok: true, lenses: listTabs[key] ?? null });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
