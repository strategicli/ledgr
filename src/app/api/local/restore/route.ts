import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { hashToken } from "@/lib/auth/machine";
import { resetAvailableHere } from "@/lib/auth/signin-actions";
import { localDataDir, ownerItemCount, RESTORE_TICKET } from "@/lib/first-run";

export const dynamic = "force-dynamic";

// POST /api/local/restore {replace?: boolean} — step 1 of "Restore from a
// backup" on the first-run page (ADR-282). Owner-authed, at this computer
// only. Answers with a one-time upload address; the file itself goes to
// /restore-upload, which sits outside the proxy because the proxy cuts request
// bodies at 10MB (the same reason as /files/local/).
//
// A restore replaces the whole database, so an install that already holds
// items is refused unless the owner ticked "replace everything" (the 409
// carries the count for the warning). The upload checks again, so this answer
// cannot go stale in between.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const dir = localDataDir();
  if (!dir || !(await resetAvailableHere())) {
    return NextResponse.json(
      { error: "Restoring from a backup works only at the computer running Ledgr." },
      { status: 400 }
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { replace?: unknown };
    const replace = body.replace === true;
    const n = await ownerItemCount(owner.id);
    if (n > 0 && !replace) {
      return NextResponse.json(
        { error: `This Ledgr already holds ${n} item${n === 1 ? "" : "s"}. A restore replaces all of them.`, items: n },
        { status: 409 }
      );
    }
    const token = randomBytes(32).toString("base64url");
    await mkdir(join(dir, "restore"), { recursive: true });
    await writeFile(
      join(dir, RESTORE_TICKET),
      JSON.stringify({ hash: hashToken(token), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), replace }),
      "utf8"
    );
    return NextResponse.json({ uploadUrl: `/restore-upload?t=${token}` });
  } catch (err) {
    return errorResponse(err);
  }
}
