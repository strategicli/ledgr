// GET /files/[id] — the stable address of an attachment (ADR-228), now access
// controlled (ADR-231). Redirects to wherever the bytes currently live, so item
// bodies never contain a storage provider's URL and switching providers needs
// no body rewrite. This is the indirection that keeps storage swappable.
//
// A REDIRECT, not a proxy: bytes must never pass through the app server
// (CLAUDE.md principle 8, src/lib/storage/types.ts). The browser follows the
// 302 to R2 and reads from there. On a self-hosted install with no bucket the
// bytes live on this machine's disk, and the 302 goes to this app's own signed
// /files/local/<key> URL instead (src/lib/storage/local.ts); the gate below is
// the same either way.
//
// WHO MAY READ. The bucket is private, so there is no unsigned URL to any
// object and the UUID alone is no longer the credential. Two ways in, and
// nothing else:
//   - the OWNER, by Clerk session. This is the default and covers the app.
//   - an ANONYMOUS viewer holding `?s=<share token>`, but only if that token is
//     live and belongs to THIS attachment's parent item. A share page rewrites
//     its body's addresses to carry its own token (src/app/share/[token]).
// Both failures are a flat 404, never a 403: a wrong or revoked token must not
// confirm that an id exists.
//
// This is what lets a private file (an SSN scan) and a public share of a
// different item both be true at once — the earlier design could only have one.
//
// The route stays in the public matcher (proxy.ts) because the share path takes
// no session; "public route" means Clerk does not REQUIRE a session here, not
// that this handler skips its own check.
import { NextResponse } from "next/server";
import { getAttachmentForRead } from "@/lib/attachments";
import { SHARE_PARAM } from "@/lib/attachment-url";
import { moduleIsOn } from "@/lib/modules/gate";
import { resolveOwner } from "@/lib/owner";
import { resolveShareToken } from "@/modules/sharing/lib/share";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Never cached. The redirect target is a signed URL that expires, so a cached
// 302 would eventually hand out a dead link — and, worse, a cache shared
// between viewers would hand one reader's signed URL to another. Re-signing is
// one HMAC and no I/O; the bytes themselves still come off R2's CDN.
const CACHE_CONTROL = "private, no-store";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  // Not asUuid(): a malformed id here is a bad URL, not a bad API call, so it
  // gets the same 404 as an id that simply isn't ours.
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const att = await getAttachmentForRead(id);
  if (!att) {
    // Only the signed-in owner learns why, and the words are the same for
    // every missing id, so this confirms nothing about any file. The common
    // real cause: files live on the copy of Ledgr they were added to, and the
    // attachment rows are not in sync yet, so another copy has no record.
    const owner = await resolveOwner();
    return new NextResponse(
      owner
        ? "Not found. This copy of Ledgr has no record of this file. Files stay on the copy they were added to; they don't sync between copies yet."
        : "Not found",
      { status: 404 }
    );
  }

  const token = new URL(request.url).searchParams.get(SHARE_PARAM);
  let allowed = false;
  if (token) {
    // Scoped deliberately to the parent item: a live token for item A must not
    // become a skeleton key for every attachment the owner has.
    const shared = await resolveShareToken(token);
    // A share link whose module is off opens nothing, its images included.
    allowed =
      !!shared &&
      shared.itemId === att.parentItemId &&
      (await moduleIsOn(shared.ownerId, "sharing"));
  } else {
    const owner = await resolveOwner();
    allowed = !!owner && owner.id === att.ownerId;
  }
  if (!allowed) return new NextResponse("Not found", { status: 404 });

  // Checked after the lookup, so a copy with no file storage (a cloud copy of a
  // hub whose files stay on its own disk, ADR-277) still gives the owner the
  // "files stay on the copy they were added to" answer above for a file it has
  // no record of, rather than a bare "not configured".
  const storage = getStorage();
  if (!storage) {
    return new NextResponse("File storage is not configured on this copy of Ledgr.", { status: 503 });
  }
  const target = await storage.presignDownload(att.storageKey);
  // The local disk signs a root-relative URL (this app serves the bytes), and
  // a relative Location keeps the browser on whatever address it came in on:
  // localhost, the tailnet name, a phone. NextResponse.redirect insists on an
  // absolute URL, so that path stays for R2's absolute one, unchanged.
  if (target.startsWith("/")) {
    return new NextResponse(null, {
      status: 302,
      headers: { location: target, "cache-control": CACHE_CONTROL },
    });
  }
  return NextResponse.redirect(target, {
    status: 302,
    headers: { "cache-control": CACHE_CONTROL },
  });
}
