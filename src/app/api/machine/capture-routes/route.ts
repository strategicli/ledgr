import { isResponse, machineHttp } from "@/lib/machine/http";
import { INBOX_SOURCES, routeFor } from "@/lib/inbox-sources";
import { getSettings } from "@/lib/settings";

// GET /api/machine/capture-routes (ADR-288), read-only: where each arrival path
// lands. -> { routes: [{ key, label, route }] }; route is "inbox", "filed", or a
// project item id (the same table MCP describe_workspace returns).
export const dynamic = "force-dynamic";
const http = machineHttp("GET");

export const OPTIONS = http.options;

export async function GET(request: Request) {
  const a = await http.authorize(request, new Set());
  if (isResponse(a)) return a;
  try {
    const settings = await getSettings(a.ownerId);
    return http.json({
      routes: INBOX_SOURCES.map((s) => {
        const r = routeFor(settings.inboxRoutes, s.key);
        return { key: s.key, label: s.label, route: r.destinationId ?? (r.inbox ? "inbox" : "filed") };
      }),
    });
  } catch (err) {
    return http.fail(err);
  }
}
