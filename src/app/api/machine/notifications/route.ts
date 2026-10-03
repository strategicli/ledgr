import { routeGate } from "@/lib/modules/gate";
import { asUuid } from "@/lib/api";
import { isResponse, machineHttp } from "@/lib/machine/http";
import {
  isNotificationState,
  listNotifications,
  markAllRead,
  notificationCounts,
  setNotificationState,
  type ListFilter,
} from "@/lib/notifications";

// Notification center for token clients (ADR-288); mirrors /api/notifications.
export const dynamic = "force-dynamic";
const http = machineHttp("GET, PATCH");
const PARAMS = new Set(["filter"]);
const FILTERS = ["all", "unread", "read", "archived"];

export const OPTIONS = http.options;

// GET ?filter=all|unread|read|archived (default all) -> { notifications, counts }
export async function GET(request: Request) {
  const a = await http.authorize(request, PARAMS);
  if (isResponse(a)) return a;
  try {
    const off = await routeGate(a.ownerId, "notification-center");
    if (off) return http.cors(off);
    const filter = a.params.get("filter") ?? "all";
    if (!FILTERS.includes(filter)) {
      return http.json({ error: `filter must be one of: ${FILTERS.join(", ")}` }, 400);
    }
    const [notifications, counts] = await Promise.all([
      listNotifications(a.ownerId, filter as ListFilter),
      notificationCounts(a.ownerId),
    ]);
    return http.json({ notifications, counts });
  } catch (err) {
    return http.fail(err);
  }
}

// PATCH { ids: string[], state } or { markAllRead: true } -> { changed, counts }
export async function PATCH(request: Request) {
  const a = await http.authorize(request);
  if (isResponse(a)) return a;
  const body = await http.body(request);
  if (isResponse(body)) return body;
  try {
    const off = await routeGate(a.ownerId, "notification-center");
    if (off) return http.cors(off);
    let changed: number;
    if (body.markAllRead === true) {
      changed = await markAllRead(a.ownerId);
    } else {
      if (!isNotificationState(body.state)) {
        return http.json({ error: "state must be unread, read or archived" }, 400);
      }
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        return http.json({ error: "ids must be a non-empty array (or pass markAllRead: true)" }, 400);
      }
      if (body.ids.length > 500) return http.json({ error: "too many ids (max 500)" }, 400);
      const ids = body.ids.map((id, i) => asUuid(id, `ids[${i}]`));
      changed = await setNotificationState(a.ownerId, ids, body.state);
    }
    return http.json({ changed, counts: await notificationCounts(a.ownerId) });
  } catch (err) {
    return http.fail(err);
  }
}
