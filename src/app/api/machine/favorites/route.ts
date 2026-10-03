import { asUuid } from "@/lib/api";
import { isResponse, machineHttp } from "@/lib/machine/http";
import { getFavoriteItems, reorderFavorites, setFavorite } from "@/lib/favorites";

// Starred items for token clients (ADR-288); mirrors /api/favorites.
export const dynamic = "force-dynamic";
const http = machineHttp("GET, POST, PATCH");

export const OPTIONS = http.options;

// GET -> { items: [{ id, title, type, icon }] } in saved order
export async function GET(request: Request) {
  const a = await http.authorize(request, new Set());
  if (isResponse(a)) return a;
  try {
    return http.json({ items: await getFavoriteItems(a.ownerId) });
  } catch (err) {
    return http.fail(err);
  }
}

// POST { itemId, favorite: boolean } -> { favorited }
export async function POST(request: Request) {
  const a = await http.authorize(request);
  if (isResponse(a)) return a;
  const body = await http.body(request);
  if (isResponse(body)) return body;
  try {
    if (typeof body.favorite !== "boolean") {
      return http.json({ error: "favorite must be true or false" }, 400);
    }
    const itemId = asUuid(body.itemId, "itemId");
    return http.json({ favorited: await setFavorite(a.ownerId, itemId, body.favorite) });
  } catch (err) {
    return http.fail(err);
  }
}

// PATCH { order: string[] } -> { ok: true }
export async function PATCH(request: Request) {
  const a = await http.authorize(request);
  if (isResponse(a)) return a;
  const body = await http.body(request);
  if (isResponse(body)) return body;
  try {
    if (!Array.isArray(body.order)) {
      return http.json({ error: "order must be an array of item ids" }, 400);
    }
    const order = body.order.map((id, i) => asUuid(id, `order[${i}]`));
    await reorderFavorites(a.ownerId, order);
    return http.json({ ok: true });
  } catch (err) {
    return http.fail(err);
  }
}
