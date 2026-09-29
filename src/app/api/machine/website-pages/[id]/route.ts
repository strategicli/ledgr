// PATCH /api/machine/website-pages/[id], body { design?: {language?, palette?,
// font?}, starter? }: set a Website Page's look, and/or fill the page from a
// starter while it is still empty (refused with a 400 once it has content).
// Answers { id, design }. The body itself is written like any item.
import { asUuid } from "@/lib/api";
import { verifyApiRequest } from "@/lib/auth/credentials";
import { json, preflight, withMachineOwner } from "@/modules/website-pages/lib/machine";
import { applyStarter, setDesign } from "@/modules/website-pages/lib/service";
import type { Design } from "@/modules/website-pages/lib/theme";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await verifyApiRequest(request.headers.get("authorization")))) return json({ error: "unauthorized" }, 401);
  return withMachineOwner(request, async (ownerId) => {
    const id = asUuid((await ctx.params).id, "id");
    const b = (await request.json().catch(() => ({}))) as { design?: unknown; starter?: unknown };
    if (typeof b.starter === "string") await applyStarter(ownerId, id, b.starter);
    const design = await setDesign(ownerId, id, b.design && typeof b.design === "object" ? (b.design as Partial<Design>) : {});
    return { id, design };
  });
}
