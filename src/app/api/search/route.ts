import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { searchItems, type SearchOptions } from "@/lib/search";
import { APP_TIMEZONE, zonedMidnightUtc } from "@/lib/today";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// from/to arrive as calendar days (YYYY-MM-DD) and become an app-timezone
// window: from's midnight inclusive through the end of to's day (next
// midnight, exclusive).
function dayStart(value: string, nextDay = false): Date | null {
  const m = YMD_RE.exec(value);
  if (!m) return null;
  return zonedMidnightUtc(
    { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) + (nextDay ? 1 : 0) },
    APP_TIMEZONE
  );
}

// GET /api/search?q=&type=&person=&from=&to=&limit= — owner-scoped FTS over
// titles and bodies; results are body-free list rows plus a snippet.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const params = new URL(request.url).searchParams;
    const q = params.get("q")?.trim() ?? "";
    if (!q) return NextResponse.json({ items: [] });

    const opts: SearchOptions = { type: params.get("type") ?? undefined };
    const person = params.get("person");
    if (person) {
      if (!UUID_RE.test(person)) {
        return NextResponse.json(
          { error: "person must be a UUID" },
          { status: 400 }
        );
      }
      opts.relatedTo = person;
    }
    for (const [param, key, nextDay] of [
      ["from", "from", false],
      ["to", "to", true],
    ] as const) {
      const value = params.get(param);
      if (value) {
        const date = dayStart(value, nextDay);
        if (!date) {
          return NextResponse.json(
            { error: `${param} must be YYYY-MM-DD` },
            { status: 400 }
          );
        }
        opts[key] = date;
      }
    }
    const limit = params.get("limit");
    if (limit !== null) opts.limit = Number(limit) || undefined;

    return NextResponse.json({ items: await searchItems(owner.id, q, opts) });
  } catch (err) {
    return errorResponse(err);
  }
}
