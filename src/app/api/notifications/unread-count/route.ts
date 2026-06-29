// Unread notification count (ADR-129). The client AppBadgeSync calls this on
// load to set the PWA app-icon badge to an authoritative value (the SW handles
// the increment-on-push case). Owner-scoped, indexed count — cheap.
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { countUnread } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    return NextResponse.json({ unread: await countUnread(owner.id) });
  } catch (err) {
    return errorResponse(err);
  }
}
