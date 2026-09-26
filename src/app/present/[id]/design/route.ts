// Save a presentation's design (explorations/presentations.md design step).
// Same owner auth + module gate as the present route. POST { design, asDefault? }.
import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/owner";
import { moduleIsOn } from "@/lib/modules/gate";
import { updateItem } from "@/lib/item-mutations";
import { ItemError } from "@/lib/items";
import { updateSettings } from "@/lib/settings";
import { parseDesign } from "@/modules/presentations/lib/design";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await resolveOwner();
  if (!owner) return new NextResponse("Not found", { status: 404 });
  if (!(await moduleIsOn(owner.id, "presentations"))) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  if (!body || typeof body !== "object") return new NextResponse("Bad request", { status: 400 });
  const { design: rawDesign, asDefault } = body as Record<string, unknown>;
  const design = parseDesign(rawDesign);

  try {
    // updateItem's own existing-row check already excludes another owner's item
    // and anything in Trash, so a bad id 404s without a separate read here.
    await updateItem(owner.id, id, { propertyPatch: { presentation: design } });
  } catch (err) {
    if (err instanceof ItemError && err.code === "not_found") {
      return new NextResponse("Not found", { status: 404 });
    }
    throw err;
  }

  if (asDefault === true) {
    await updateSettings(owner.id, { presentationDefault: design });
  }

  return NextResponse.json({ design });
}
