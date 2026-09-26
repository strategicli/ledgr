// PUT /restore-upload?t=<one-time token> — step 2 of "Restore from a backup"
// on the first-run page (ADR-282). GET — is a restore still waiting to run?
//
// Outside the proxy's matcher (src/proxy.ts) on purpose: with the proxy in
// front, Next cuts request bodies at 10MB, and a backup is bigger than that.
// So this checks no session. The credential is the token step 1 wrote into the
// data folder for the signed-in owner (15 minutes, one use), plus "addressed
// to this computer", the same pair the first-run and reset pages rely on.
//
// It saves the file to the one fixed path the supervisor reads, then asks for
// a restart. The supervisor restores while the app and Postgres are stopped
// (supervisor/ledgr-supervisor.mjs, restoreIfAsked) and writes the outcome to
// restore-result.json, which /setup reads.
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { resetTicketValid } from "@/lib/auth/builtin-core";
import { resetAvailableHere } from "@/lib/auth/signin-actions";
import {
  localDataDir,
  ownerItemCount,
  RESTORE_REQUEST_FILE,
  RESTORE_TICKET,
  RESTORE_UPLOAD,
} from "@/lib/first-run";
import { resolveInstanceOwner } from "@/lib/instance-owner";

export const dynamic = "force-dynamic";

const EXPIRED = "This upload link has expired or was already used. Choose the file again on the setup page.";

export async function GET() {
  const dir = localDataDir();
  if (!dir) return new NextResponse("Not found", { status: 404 });
  // Says only whether a restore is waiting, nothing about what is in it.
  return NextResponse.json(
    { pending: existsSync(join(dir, RESTORE_REQUEST_FILE)) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PUT(request: Request) {
  const dir = localDataDir();
  if (!dir || !(await resetAvailableHere())) return new NextResponse("Not found", { status: 404 });

  const ticketPath = join(dir, RESTORE_TICKET);
  const text = existsSync(ticketPath) ? readFileSync(ticketPath, "utf8") : null;
  const token = new URL(request.url).searchParams.get("t");
  if (!text || !resetTicketValid(text, token, Date.now())) return NextResponse.json({ error: EXPIRED }, { status: 403 });
  await unlink(ticketPath).catch(() => {}); // one use

  // The same rule as step 1, checked again now: never over items the owner
  // has not agreed to replace.
  const { replace } = JSON.parse(text) as { replace?: boolean };
  if (replace !== true) {
    const ownerId = await resolveInstanceOwner();
    if (!ownerId || (await ownerItemCount(ownerId)) > 0) {
      return NextResponse.json({ error: "This Ledgr has items in it now. Start again on the setup page." }, { status: 409 });
    }
  }
  if (!request.body) return NextResponse.json({ error: "No file arrived. Try again." }, { status: 400 });

  const dest = join(dir, RESTORE_UPLOAD);
  const part = `${dest}.part`;
  await mkdir(join(dir, "restore"), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(request.body as WebReadableStream), createWriteStream(part));
    // A backup Ledgr makes (the weekly one, or a restore point) is pg_dump's
    // custom format, which starts with PGDMP. Anything else stops here.
    const fh = await open(part, "r");
    const head = Buffer.alloc(5);
    await fh.read(head, 0, 5, 0);
    await fh.close();
    if (head.toString("latin1") !== "PGDMP") {
      await unlink(part).catch(() => {});
      return NextResponse.json(
        { error: "That file isn't a Ledgr backup. Choose a .dump file: the weekly backup, or a restore point." },
        { status: 400 }
      );
    }
    await rename(part, dest);
  } catch {
    await unlink(part).catch(() => {});
    return NextResponse.json({ error: "The file didn't finish uploading. Try again." }, { status: 500 });
  }

  const at = new Date().toISOString();
  await writeFile(join(dir, RESTORE_REQUEST_FILE), JSON.stringify({ at }, null, 2), "utf8");
  // The supervisor restores on its way through a restart (the restart door, ADR-227).
  await writeFile(
    join(dir, "restart-requested"),
    JSON.stringify({ reason: "restoring from a backup", at }, null, 2),
    "utf8"
  );
  return NextResponse.json({ requested: true });
}
