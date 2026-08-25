import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { isMovableJob } from "@/lib/job-owners";
import { setJobOwner, type ClaimAction } from "@/lib/job-owners-store";

export const dynamic = "force-dynamic";

// PATCH /api/jobs/owner {job, action} — which install runs an exclusive
// scheduled job. Owner authed (a settings surface).
//
// Three actions, and the asymmetry between them is deliberate:
//
//   claim    run it HERE. Only ever "here", because the slot must hold a real
//            `sync_device` id and this install only knows its own (the two id
//            spaces are explained in src/lib/job-owners.ts).
//   nobody   run it nowhere. Works from any install.
//   default  back to "wherever it is switched on", i.e. how it behaved before
//            this feature existed. Also works from any install.
//
// The last two working from anywhere is what makes a job recoverable when the
// machine holding it is switched off, lost, or reinstalled.
//
// The value goes to `users.settings`, which SYNCS, so the answer reaches every
// other install on its next exchange and each one re-reads it before its next
// run. That is the exactly-one guarantee: one slot, so a conflict cannot be
// stored.
const ACTIONS: ClaimAction[] = ["claim", "nobody", "default"];

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const body = (await request.json()) as { job?: unknown; action?: unknown };
    if (typeof body.job !== "string" || !isMovableJob(body.job)) {
      return NextResponse.json({ error: "unknown job" }, { status: 400 });
    }
    if (typeof body.action !== "string" || !ACTIONS.includes(body.action as ClaimAction)) {
      return NextResponse.json(
        { error: `action must be one of ${ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }
    const result = await setJobOwner(owner.id, body.job, body.action as ClaimAction);
    if (result.error) {
      // A refused claim is a 409: the request was well formed, the state says no.
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ jobOwners: result.owners });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
