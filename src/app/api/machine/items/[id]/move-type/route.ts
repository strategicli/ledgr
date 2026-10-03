import { asUuid } from "@/lib/api";
import { isResponse, machineHttp } from "@/lib/machine/http";
import { moveItemType } from "@/lib/item-mutations";

// POST /api/machine/items/[id]/move-type { targetType, dryRun? } (ADR-288): the
// token half of POST /api/items/[id]/move-type, through the same moveItemType.
// dryRun:true -> { summary } without writing; otherwise { summary, item }.
export const dynamic = "force-dynamic";
const http = machineHttp("POST");

export const OPTIONS = http.options;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const a = await http.authorize(request, new Set());
  if (isResponse(a)) return a;
  const body = await http.body(request);
  if (isResponse(body)) return body;
  try {
    const id = asUuid((await context.params).id, "id");
    const targetType =
      typeof body.targetType === "string" ? body.targetType.trim() : "";
    if (!targetType) return http.json({ error: "targetType is required" }, 400);
    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
      return http.json({ error: "dryRun must be a boolean" }, 400);
    }
    const result = await moveItemType(a.ownerId, id, targetType, {
      dryRun: body.dryRun === true,
    });
    return http.json(result);
  } catch (err) {
    return http.fail(err);
  }
}
