// GET /files/[id] — the stable address of an attachment (ADR-228). Redirects to
// wherever the bytes currently live, so item bodies never contain a storage
// provider's URL and switching providers (or public base URLs) needs no body
// rewrite. This is the indirection that keeps storage swappable.
//
// A REDIRECT, not a proxy: bytes must never pass through the app server
// (CLAUDE.md principle 8, src/lib/storage/types.ts). The browser follows the
// 302 to the CDN and reads from there exactly as before.
//
// PUBLIC, like /share and /api/ics: the attachment's UUID is unguessable and is
// the credential. It has to be public — a public share page renders an item body
// whose images are now /files/<id>, and an anonymous viewer has no session. This
// is not a privacy change: the provider URLs these addresses replace were
// world-readable too. Short-lived presigned GETs are the upgrade path if a
// privacy tier ever lands (the confidential-tier exploration, ADR-075 declined
// for v1.0), and it would be a change here only.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { attachments } from "@/db/schema";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// The id -> storage key mapping is immutable, so this is cacheable. One hour,
// not a year, deliberately: the redirect TARGET changes when the public base
// changes (the r2.dev -> custom domain move), and a long cache would serve the
// old base until it expired.
const CACHE_CONTROL = "public, max-age=3600";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  // Not asUuid(): a malformed id here is a bad URL, not a bad API call, so it
  // gets the same 404 as an id that simply isn't ours.
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const storage = getStorage();
  if (!storage) {
    return new NextResponse("File storage is not configured.", { status: 503 });
  }

  // Not owner-scoped, matching the public-by-unguessable-id contract above.
  const rows = await getDb()
    .select({ storageKey: attachments.storageKey })
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);
  if (rows.length === 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.redirect(storage.publicUrl(rows[0].storageKey), {
    status: 302,
    headers: { "cache-control": CACHE_CONTROL },
  });
}
