// GET /api/command-index — the owner's dynamic command-palette entries (types,
// views, dashboards, templates, saved searches) plus the ids of the modules
// they have switched off, in minimal form (ADR-063). The palette fetches this once on
// open; the static entries (pages, Build sections, settings) live client-side in
// command-index.ts and need no round-trip. Owner-scoped like every read.
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { listDashboards } from "@/lib/dashboards";
import { offModuleIds } from "@/lib/modules/enabled";
import { getSettings } from "@/lib/settings";
import { listTemplates } from "@/lib/templates";
import { listTypes } from "@/lib/types";
import { listViews } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    // Every live type, hidden ones too, minus a switched-off module's types.
    const [types, views, dashboards, templates, settings] = await Promise.all([
      listTypes({ includeHidden: true, ownerId: owner.id }),
      listViews(owner.id),
      listDashboards(owner.id),
      listTemplates(owner.id),
      getSettings(owner.id),
    ]);
    return NextResponse.json({
      types: types.map((t) => ({ key: t.key, label: t.label, icon: t.icon, hidden: t.hidden })),
      views: views.map((v) => ({ id: v.id, name: v.name })),
      dashboards: dashboards.map((d) => ({ id: d.id, name: d.name })),
      offModules: offModuleIds(settings),
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        prototypeItemId: t.prototypeItemId,
      })),
      savedSearches: settings.savedSearches.map((s) => ({ id: s.id, name: s.name })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
