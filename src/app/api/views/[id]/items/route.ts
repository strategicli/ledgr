import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { getView, queryViewItems } from "@/lib/views";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/views/[id]/items — a thin, owner-scoped JSON runner for a saved view
// (ADR-146, S4: the Desk's view panels). Reuses the same getView + queryViewItems
// the server pages use, so it never selects `body` (listColumns only) and honors
// the view's own filter + sort. Board/calendar layouts stay on their full pages;
// a Desk view panel renders these rows as a compact list.
export async function GET(_request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const view = await getView(owner.id, id);
    const items = await queryViewItems(owner.id, view.filter, view.sort);
    return NextResponse.json({
      view: { id: view.id, name: view.name, layout: view.layout },
      items,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
