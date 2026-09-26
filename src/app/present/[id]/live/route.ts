// Owner control for "Go live" (step 6): start/update/end a public follow link.
// Same auth + module gate as the present route itself.
import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/owner";
import { moduleIsOn } from "@/lib/modules/gate";
import { startLive, updateLive, endLive } from "@/modules/presentations/lib/live";

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
  const action = (body as Record<string, unknown>).action;

  if (action === "start") {
    const token = await startLive(owner.id, id);
    return NextResponse.json({ token, url: `/live/${token}` });
  }

  if (action === "state") {
    const { token, state, version } = body as Record<string, unknown>;
    if (typeof token !== "string" || typeof version !== "string") {
      return new NextResponse("Bad request", { status: 400 });
    }
    const ok = await updateLive(owner.id, token, state, version);
    if (!ok) return new NextResponse("Bad request", { status: 400 });
    return new NextResponse(null, { status: 204 });
  }

  if (action === "end") {
    const { token } = body as Record<string, unknown>;
    if (typeof token !== "string") return new NextResponse("Bad request", { status: 400 });
    await endLive(owner.id, token);
    return new NextResponse(null, { status: 204 });
  }

  return new NextResponse("Bad request", { status: 400 });
}
