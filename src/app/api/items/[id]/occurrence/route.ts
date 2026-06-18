import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { ItemError } from "@/lib/items";
import {
  carveOccurrence,
  toggleOccurrenceCompletion,
} from "@/lib/recurrence-service";
import { isYmd } from "@/lib/recurrence";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// POST /api/items/[id]/occurrence — operate on one occurrence of a recurring
// (virtual) series from the completions calendar (Tasks Polish S3, ADR-083).
//   { action: "toggle", date } — tick/untick that occurrence in the per-date log
//   { action: "carve",  date } — carve the date out into a fresh detached item
//                                 (the series skips it); returns its new id
// Both recompute the series' scheduled date + status server-side, so the calendar
// never has to know the rules.
export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    const body = (await request.json()) as { action?: unknown; date?: unknown };
    const date = body.date;
    if (typeof date !== "string" || !isYmd(date)) {
      throw new ItemError("bad_request", "date must be YYYY-MM-DD");
    }
    if (body.action === "toggle") {
      return NextResponse.json({
        item: await toggleOccurrenceCompletion(owner.id, id, date),
      });
    }
    if (body.action === "carve") {
      const { itemId, series } = await carveOccurrence(owner.id, id, date);
      return NextResponse.json({ itemId, item: series });
    }
    throw new ItemError("bad_request", "action must be toggle or carve");
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
