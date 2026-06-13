// Slice 31 verification: public share links against the live Neon DB under a
// throwaway owner. Covers issuance, public resolve (token → item render),
// listing, revocation (resolve then yields null), trashed-item protection,
// independent tokens, owner scoping, and the shared print-document render.
// Run: npx tsx scripts/verify-share.mts
// Safe to delete once the slice is closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { createShareToken, listShareTokens, revokeShareToken, resolveShareToken } = await import("../src/lib/share");
const { renderPrintDocument } = await import("../src/lib/print-html");
const { makeMarkdownBody } = await import("../src/lib/body");
const { eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-share-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;

const body = makeMarkdownBody("## Sermon outline\n\nGrace and peace to all.");
const mk = async (v: Record<string, unknown>) =>
  (await db.insert(items).values({ ownerId, ...(v as object) } as typeof items.$inferInsert).returning({ id: items.id }))[0].id;

try {
  const itemId = await mk({ type: "note", title: "Sunday notes", body });

  // --- issuance + resolve --------------------------------------------------
  const row = await createShareToken(ownerId, itemId);
  check("issuance returns an unguessable token", row.token.length >= 30 && row.revokedAt === null, `len=${row.token.length}`);

  const resolved = await resolveShareToken(row.token);
  check("public resolve returns the item by token", !!resolved && resolved.itemId === itemId && resolved.title === "Sunday notes");
  const rbody = resolved?.body as { format?: string; text?: string } | null;
  check("resolve carries the markdown body for rendering", rbody?.format === "markdown" && (rbody.text ?? "").includes("Sermon outline"));

  // --- render --------------------------------------------------------------
  const html = renderPrintDocument(resolved!.title, resolved!.body, { footerHtml: "Shared from Ledgr · read-only" });
  check("render is a full HTML document", html.startsWith("<!doctype html>") && html.includes("<title>Sunday notes</title>"));
  check("render shows the body, heading shifted under the title", html.includes("<h3>Sermon outline</h3>") && html.includes("Grace and peace to all."));
  check("share render carries the read-only footer", html.includes("Shared from Ledgr"));

  // --- listing -------------------------------------------------------------
  const list = await listShareTokens(ownerId, itemId);
  check("listing returns the issued token", list.length === 1 && list[0].token === row.token);

  // --- independent tokens --------------------------------------------------
  const row2 = await createShareToken(ownerId, itemId);
  check("a second token is independent", row2.token !== row.token);

  // --- revocation ----------------------------------------------------------
  const revoked = await revokeShareToken(ownerId, row.token);
  check("revoke reports success", revoked === true);
  check("a revoked token no longer resolves", (await resolveShareToken(row.token)) === null);
  check("the other token still resolves (revocation is per-link)", (await resolveShareToken(row2.token)) !== null);
  check("re-revoking is a no-op (idempotent)", (await revokeShareToken(ownerId, row.token)) === false);

  // --- trashed item protection --------------------------------------------
  await db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, itemId));
  check("a live token on a trashed item does not resolve", (await resolveShareToken(row2.token)) === null);
  await db.update(items).set({ deletedAt: null }).where(eq(items.id, itemId));

  // --- unknown token -------------------------------------------------------
  check("an unknown token resolves to null", (await resolveShareToken("not-a-real-token")) === null);

  // --- owner scoping -------------------------------------------------------
  const [otherUser] = await db.insert(users).values({ email: `verify-share-other-${Date.now()}@example.invalid` }).returning({ id: users.id });
  try {
    let rejected = false;
    try {
      await createShareToken(otherUser.id, itemId); // not their item
    } catch {
      rejected = true;
    }
    check("issuance is owner-scoped (other owner can't share this item)", rejected);
    check("listing is owner-scoped (other owner sees no tokens)", (await listShareTokens(otherUser.id, itemId)).length === 0);
    check("revocation is owner-scoped (other owner can't revoke)", (await revokeShareToken(otherUser.id, row2.token)) === false);
    check("the token still resolves after a foreign revoke attempt", (await resolveShareToken(row2.token)) !== null);
  } finally {
    await db.delete(users).where(eq(users.id, otherUser.id));
  }
} finally {
  // Deleting the owner's items cascades their share_tokens (item_id FK).
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
