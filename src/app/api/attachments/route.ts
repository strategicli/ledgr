// POST /api/attachments — create an attachment row and return a presigned
// upload URL (the browser PUTs the bytes straight to R2; they never proxy
// through here). GET /api/attachments?itemId= lists an item's attachments.
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireOwner, asUuid } from "@/lib/api";
import { createAttachment, listAttachments } from "@/lib/attachments";
import { ItemError } from "@/lib/items";

export async function POST(req: NextRequest) {
  try {
    const owner = await requireOwner();
    if (owner instanceof NextResponse) return owner;

    const raw = await req.json().catch(() => {
      throw new ItemError("bad_request", "request body must be JSON");
    });
    if (typeof raw !== "object" || raw === null) {
      throw new ItemError("bad_request", "request body must be a JSON object");
    }
    const input = raw as Record<string, unknown>;
    const result = await createAttachment(owner.id, {
      itemId: asUuid(input.itemId, "itemId"),
      filename: typeof input.filename === "string" ? input.filename : "",
      contentType:
        typeof input.contentType === "string" ? input.contentType : "",
      sizeBytes: typeof input.sizeBytes === "number" ? input.sizeBytes : NaN,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const owner = await requireOwner();
    if (owner instanceof NextResponse) return owner;
    const itemId = asUuid(req.nextUrl.searchParams.get("itemId"), "itemId");
    return NextResponse.json(await listAttachments(owner.id, itemId));
  } catch (err) {
    return errorResponse(err);
  }
}
