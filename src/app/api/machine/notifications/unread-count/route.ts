import { routeGate } from "@/lib/modules/gate";
import { isResponse, machineHttp } from "@/lib/machine/http";
import { countUnread } from "@/lib/notifications";

// GET /api/machine/notifications/unread-count -> { unread } (ADR-288)
export const dynamic = "force-dynamic";
const http = machineHttp("GET");

export const OPTIONS = http.options;

export async function GET(request: Request) {
  const a = await http.authorize(request, new Set());
  if (isResponse(a)) return a;
  try {
    const off = await routeGate(a.ownerId, "notification-center");
    if (off) return http.cors(off);
    return http.json({ unread: await countUnread(a.ownerId) });
  } catch (err) {
    return http.fail(err);
  }
}
