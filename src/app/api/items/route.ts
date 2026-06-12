import { NextResponse } from "next/server";
import { errorResponse, parseItemPayload, requireOwner } from "@/lib/api";
import {
  ITEM_STATUSES,
  createItem,
  listItems,
  type ItemStatus,
  type ListOptions,
} from "@/lib/items";

export const dynamic = "force-dynamic";

// GET /api/items — owner-scoped list, never includes body. Filters:
// ?type= &status= &kind= &parentId= &q= &trash=true &limit= &offset=
// q is a title substring match (the @-mention picker); trash=true is the
// Trash view: deleted items only, newest deletion first.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const params = new URL(request.url).searchParams;
    const opts: ListOptions = {
      type: params.get("type") ?? undefined,
      kind: params.get("kind") ?? undefined,
      parentId: params.get("parentId") ?? undefined,
      q: params.get("q") ?? undefined,
      trash: params.get("trash") === "true",
    };
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
