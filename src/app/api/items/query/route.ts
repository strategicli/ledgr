// GET /api/items/query — run a View Definition's filter + sort and return the
// owner-scoped, body-free rows (slice 28/29). Powers interactive embedded
// views and dashboard widgets, which need to refetch after an inline edit
// without a full page load. Static segment, so it wins over /api/items/[id].
// Params: ?type= &status= &urgency= &due= &relatedTo= &sort= &dir= &limit=
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import {
  countViewItems,
  parseViewFilter,
  queryViewItems,
  SORT_FIELDS,
  type SortField,
  type ViewSort,
} from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const p = new URL(request.url).searchParams;
    const raw: Record<string, string> = {};
    for (const key of [
      "type",
      "status",
      "urgency",
      "due",
      "relatedTo",
      "dateField",
      "withinDays",
    ]) {
      const v = p.get(key);
      if (v) raw[key] = v;
    }
    const filter = parseViewFilter(raw);

    // Stat/count widgets ask for just the number, body-free and one query.
    if (p.get("count")) {
      return NextResponse.json({ count: await countViewItems(owner.id, filter) });
    }

    const sortField = p.get("sort");
    const sort: ViewSort = {
      field: SORT_FIELDS.includes(sortField as SortField)
        ? (sortField as SortField)
        : "updatedAt",
      dir: p.get("dir") === "asc" ? "asc" : "desc",
    };
    const limit = Number(p.get("limit")) || undefined;

    const items = await queryViewItems(owner.id, filter, sort, limit);
    return NextResponse.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}
