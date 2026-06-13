// Slice 26 verification: the new R2 server-side putObject against the real
// bucket, then the email-in import engine against Neon with a stub MailSource
// under a throwaway owner. Covers note/task routing, HTML->text body
// conversion, inbox:true arrival, properties.email dedup (no double-import),
// graceful attachment-drop when storage is off, delta-token persistence, and
// "an errored run does not advance the delta token". Run:
//   npx tsx scripts/verify-email-in.mts
// Safe to delete once the slice is closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- Part A: real R2 putObject/deleteObject roundtrip (creds present) -------
// Constructed directly (not via getStorage) so it doesn't cache a provider
// that Part B then deletes the env out from under.
const haveR2 = !!(process.env.R2_ACCESS_KEY_ID && process.env.R2_ENDPOINT && process.env.R2_BUCKET);
if (haveR2) {
  const { R2Provider } = await import("../src/lib/storage/r2");
  const r2 = new R2Provider({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucket: process.env.R2_BUCKET!,
    endpoint: process.env.R2_ENDPOINT!,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || "https://example.invalid",
  });
  const key = `verify-email-in/${Date.now()}/probe.txt`;
  try {
    const url = await r2.putObject(key, new TextEncoder().encode("ledgr probe"), "text/plain");
    check("R2 putObject writes server-side and returns the public URL", url.includes(encodeURIComponent("probe.txt").replace("%2F", "/")) || url.endsWith("probe.txt"));
    await r2.deleteObject(key);
    check("R2 deleteObject cleans up the probe object", true);
  } catch (err) {
    check("R2 putObject/deleteObject roundtrip", false, String(err));
  }
} else {
  console.log("INFO  R2 not configured locally — skipping the putObject roundtrip.");
}

// --- force storage OFF for the engine tests (attachment-drop path) ----------
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;

const { getDb } = await import("../src/db");
const { items, jobState, users } = await import("../src/db/schema");
const { runEmailImport, getEmailState, EMAIL_JOB_KEY } = await import("../src/lib/email/sync");
type MailSource = import("../src/lib/email/types").MailSource;
type NormalizedMessage = import("../src/lib/email/types").NormalizedMessage;
const { and, eq, sql } = await import("drizzle-orm");

const db = getDb();

function msg(over: Partial<NormalizedMessage> & { id: string }): NormalizedMessage {
  return {
    id: over.id,
    subject: over.subject ?? "",
    fromName: over.fromName ?? "Sender",
    fromEmail: over.fromEmail ?? "sender@example.invalid",
    receivedAt: over.receivedAt ?? "2026-06-13T12:00:00Z",
    bodyHtml: over.bodyHtml ?? null,
    bodyText: over.bodyText ?? null,
    attachments: over.attachments ?? [],
  };
}

class FakeMail implements MailSource {
  received: (string | null)[] = [];
  moved: string[] = [];
  throwMoveFor = new Set<string>();
  next: { messages: NormalizedMessage[]; nextDeltaToken: string | null } = { messages: [], nextDeltaToken: null };
  async listNewMessages(token: string | null) {
    this.received.push(token);
    return this.next;
  }
  async markImported(id: string) {
    if (this.throwMoveFor.has(id)) throw new Error("move failed");
    this.moved.push(id);
  }
}

const [tempUser] = await db.insert(users).values({ email: `verify-email-${Date.now()}@example.invalid` }).returning({ id: users.id });
const ownerId = tempUser.id;

const findByMessageId = async (messageId: string) =>
  (
    await db
      .select()
      .from(items)
      .where(and(eq(items.ownerId, ownerId), sql`properties @> ${JSON.stringify({ email: { messageId } })}::jsonb`))
  )[0];

const fake = new FakeMail();

try {
  // --- Run 1: import note, task, html, attachment-bearing -----------------
  fake.next = {
    messages: [
      msg({ id: "m1", subject: "Hello there", bodyText: "Line one\n\nLine two" }),
      msg({ id: "m2", subject: "task:  Follow up with Roger", bodyText: "do it" }),
      msg({ id: "m3", subject: "Formatted", bodyHtml: "<p>Hi <b>there</b></p><p>bye</p>" }),
      msg({ id: "m4", subject: "Has a file", bodyText: "see attached", attachments: [{ id: "a1", name: "doc.pdf", contentType: "application/pdf", size: 10, bytes: new Uint8Array([1, 2, 3]) }] }),
    ],
    nextDeltaToken: "delta-1",
  };
  const r1 = await runEmailImport(ownerId, fake);
  check("run 1 imports all four messages", r1.imported === 4 && r1.errors === 0, JSON.stringify(r1));
  check("run 1 routes 1 task + 3 notes", r1.tasks === 1 && r1.notes === 3);
  check("run 1 starts from a null delta token", fake.received[0] === null);
  check("all four messages were marked imported (moved)", fake.moved.length === 4);

  const n1 = await findByMessageId("m1");
  check("plain message becomes a note, inbox:true", n1?.type === "note" && n1?.title === "Hello there" && n1?.inbox === true);
  check("note body splits into paragraphs", Array.isArray(n1?.body) && (n1!.body as unknown[]).length === 2);
  check("note records sender in properties.email", (n1?.properties as { email?: { fromEmail?: string } })?.email?.fromEmail === "sender@example.invalid");

  const t2 = await findByMessageId("m2");
  check("`task:` subject becomes a task with the prefix stripped", t2?.type === "task" && t2?.title === "Follow up with Roger");

  const h3 = await findByMessageId("m3");
  const h3text = JSON.stringify(h3?.body);
  check("HTML body is converted to text (tags stripped)", h3text.includes("Hi there") && h3text.includes("bye") && !h3text.includes("<"));

  const a4 = await findByMessageId("m4");
  check("attachment-bearing message imports; bytes dropped gracefully w/o storage", !!a4 && r1.attachments === 0);

  check("job_state advanced the delta token on a clean run", (await getEmailState())?.deltaToken === "delta-1");

  // --- Run 2: dedup (same message id) does not double-import --------------
  fake.next = { messages: [msg({ id: "m1", subject: "Hello there", bodyText: "x" })], nextDeltaToken: "delta-2" };
  const r2 = await runEmailImport(ownerId, fake);
  check("run 2 receives the stored delta token", fake.received[1] === "delta-1");
  check("a re-seen message is skipped, not re-imported", r2.skipped === 1 && r2.imported === 0);
  const m1count = (await db.select({ c: sql<number>`count(*)::int` }).from(items).where(and(eq(items.ownerId, ownerId), sql`properties @> ${JSON.stringify({ email: { messageId: "m1" } })}::jsonb`)))[0].c;
  check("only one item exists for the re-seen message", m1count === 1);
  check("clean run 2 advanced the token", (await getEmailState())?.deltaToken === "delta-2");

  // --- Run 3: an errored run must not advance the token -------------------
  fake.throwMoveFor.add("m5");
  fake.next = { messages: [msg({ id: "m5", subject: "Will fail to move", bodyText: "y" })], nextDeltaToken: "delta-3" };
  const r3 = await runEmailImport(ownerId, fake);
  check("a message whose move fails counts as an error", r3.errors === 1);
  check("an errored run does NOT advance the delta token", (await getEmailState())?.deltaToken === "delta-2");
  check("the errored message's item still exists (dedup catches it next run)", !!(await findByMessageId("m5")));
} finally {
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
  await db.delete(jobState).where(eq(jobState.key, EMAIL_JOB_KEY));
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
