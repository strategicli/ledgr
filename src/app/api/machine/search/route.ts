import { isResponse, machineHttp } from "@/lib/machine/http";
import { searchItems } from "@/lib/search";

// GET /api/machine/search?q=&type=&limit= (ADR-288): the same full-text engine
// as /api/search and MCP search_items. -> { items: [{ id, type, title, snippet,
// updatedAt }] }. `snippet` marks hits with [[ ]] and is null for title-only hits.
export const dynamic = "force-dynamic";
const http = machineHttp("GET");
const PARAMS = new Set(["q", "type", "limit"]);

export const OPTIONS = http.options;

export async function GET(request: Request) {
  const a = await http.authorize(request, PARAMS);
  if (isResponse(a)) return a;
  try {
    const q = a.params.get("q")?.trim() ?? "";
    if (!q) return http.json({ error: "q is required" }, 400);
    const rawLimit = a.params.get("limit");
    let limit: number | undefined;
    if (rawLimit !== null) {
      limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return http.json({ error: "limit must be an integer from 1 to 50" }, 400);
      }
    }
    const rows = await searchItems(a.ownerId, q, {
      type: a.params.get("type") ?? undefined,
      limit,
    });
    return http.json({
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        snippet: r.snippet,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (err) {
    return http.fail(err);
  }
}
