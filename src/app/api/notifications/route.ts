// Notification center API (ADR-129). GET lists by filter; PATCH changes state
// for one or many (the single-item row actions and the bulk bar both POST here),
// or marks all unread → read. Owner-scoped via requireOwner; the store helpers
// already scope every query to the owner.
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import {
  isNotificationState,
  listNotifications,
  markAllRead,
  notificationCounts,
  setNotificationState,
  type ListFilter,
} from "@/lib/notifications";

export const dynamic = "force-dynamic";

function parseFilter(raw: string | null): ListFilter {
  if (raw === "unread" || raw === "read" || raw === "archived" || raw === "all") {
    return raw;
  }
  return "all";
}

// GET /api/notifications?filter=all|unread|read|archived — the list + per-tab
// counts.
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const url = new URL(request.url);
    const filter = parseFilter(url.searchParams.get("filter"));
    const [items, counts] = await Promise.all([
      listNotifications(owner.id, filter),
      notificationCounts(owner.id),
    ]);
    return NextResponse.json({ notifications: items, counts });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/notifications — { ids: string[], state } to set one/many, or
// { markAllRead: true } to clear the unread queue. Returns the changed count
// and the fresh unread total (for the client to sync the app-icon badge).
export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json()) as {
      ids?: unknown;
      state?: unknown;
      markAllRead?: unknown;
    };

    let changed = 0;
    if (body.markAllRead === true) {
      changed = await markAllRead(owner.id);
    } else {
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((x): x is string => typeof x === "string")
        : [];
      if (!isNotificationState(body.state)) {
        return NextResponse.json({ error: "invalid state" }, { status: 400 });
      }
      if (ids.length === 0) {
        return NextResponse.json({ error: "no ids" }, { status: 400 });
      }
      changed = await setNotificationState(owner.id, ids.slice(0, 500), body.state);
    }

    const counts = await notificationCounts(owner.id);
    return NextResponse.json({ changed, counts });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
