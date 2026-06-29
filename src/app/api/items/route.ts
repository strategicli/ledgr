import { NextResponse } from "next/server";
import { errorResponse, parseItemPayload, requireOwner } from "@/lib/api";
import {
  ITEM_STATUSES,
  createItem,
  listItems,
  type ItemStatus,
  type ListOptions,
} from "@/lib/items";
import { resolveMentions } from "@/lib/mentions";

export const dynamic = "force-dynamic";

// Cap on a single ?ids= batch resolve (matches the list window VIEW_LIMIT).
const MAX_RESOLVE_IDS = 200;

// GET /api/items — owner-scoped list, never includes body. Filters:
// ?type= &status= &parentId= &inbox= &q= &trash=true &limit= &offset=
// q is a title substring match (the @-mention picker); trash=true is the
// Trash view: deleted items only, newest deletion first.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const params = new URL(request.url).searchParams;

    // ?ids=a,b,c — type-aware mention resolve (the editor's chip backfill). Owner
    // -scoped, body-free; returns { type, icon, statusCategory } per live id, so
    // a mention chip can show the right glyph and a task's open/done checkbox.
    const idsParam = params.get("ids");
    if (idsParam !== null) {
      const ids = idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, MAX_RESOLVE_IDS);
      const map = await resolveMentions(owner.id, ids);
      return NextResponse.json({ items: [...map.values()] });
    }

    const opts: ListOptions = {
      type: params.get("type") ?? undefined,
      parentId: params.get("parentId") ?? undefined,
      q: params.get("q") ?? undefined,
      trash: params.get("trash") === "true",
    };
    const inbox = params.get("inbox");
    if (inbox !== null) opts.inbox = inbox === "true";
    const status = params.get("status");
    if (status !== null) {
      if (!ITEM_STATUSES.includes(status as ItemStatus)) {
        return NextResponse.json(
          { error: `status must be one of: ${ITEM_STATUSES.join(", ")}` },
          { status: 400 }
        );
      }
      opts.status = status as ItemStatus;
    }
    const limit = params.get("limit");
    if (limit !== null) opts.limit = Number(limit) || undefined;
    const offset = params.get("offset");
    if (offset !== null) opts.offset = Number(offset) || undefined;

    return NextResponse.json({ items: await listItems(owner.id, opts) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/items — create; body fields per parseItemPayload.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const input = parseItemPayload(await request.json(), "create");
    const item = await createItem(owner.id, input);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
