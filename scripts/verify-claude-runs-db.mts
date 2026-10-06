// Claude Runs (ADR-286), the database half, against the DEV database under a
// throwaway owner. A local HTTP server stands in for the push service, so the
// real encrypt-and-send path runs end to end: a run pings only when "Notify me"
// is ticked, only once, on create or on a later update; with push unset it
// stays unclaimed and is retried by the copy that failed; with the Notification
// center on it also lands in the inbox; and cleanup trashes only runs past 60 days.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createECDH, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, pushSubscriptions, notifications } = await import("../src/db/schema");
const { generateVapidKeys } = await import("../src/lib/push/vapid");
const { saveSubscription } = await import("../src/lib/push/store");
const { createItem, updateItem } = await import("../src/lib/item-mutations");
const { trashOldRuns, retryPendingNotifications } = await import("../src/modules/claude-runs/lib/runs");
const { eq, sql } = await import("drizzle-orm");

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  (${JSON.stringify(detail)})`}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The stand-in push service: counts deliveries, answers 201 like FCM.
let hits = 0;
const server = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    hits++;
    res.writeHead(201).end();
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push/verify-claude-runs-${Date.now()}`;
async function hitsAfter(expect: number) {
  for (let i = 0; i < 40 && hits < expect; i++) await sleep(100);
  await sleep(300); // and nothing extra arrives
  return hits;
}

const keys = generateVapidKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = "mailto:verify@example.invalid";

const db = getDb();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-claude-runs-${Date.now()}@example.invalid`, settings: { modules: { "claude-runs": true } } })
  .returning({ id: users.id });
const ownerId = owner.id;
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
await saveSubscription(ownerId, {
  endpoint,
  p256dh: ecdh.getPublicKey().toString("base64url"),
  auth: randomBytes(16).toString("base64url"),
});
const props = async (id: string) =>
  ((await db.select({ p: items.properties }).from(items).where(eq(items.id, id)))[0]?.p ?? {}) as Record<string, unknown>;
const body = (t: string) => ({ format: "markdown", text: t });

try {
  const quiet = await createItem(ownerId, { type: "claude_run", title: "Quiet run", body: body("Nothing to report") });
  check("a run without Notify me sends nothing", (await hitsAfter(1)) === 0);

  const loud = await createItem(ownerId, {
    type: "claude_run",
    title: "Needs you",
    body: body("# 3 invoices need approval\ndetails"),
    properties: { notifyme: true },
  });
  check("a run created with Notify me pings once", (await hitsAfter(1)) === 1, hits);
  check("and is stamped notifiedAt", typeof (await props(loud.id)).notifiedAt === "string");

  await updateItem(ownerId, loud.id, { properties: { ...(await props(loud.id)), notifyme: true } });
  check("saving it again does not ping twice", (await hitsAfter(2)) === 1, hits);

  await updateItem(ownerId, quiet.id, { propertyPatch: { notifyme: true } });
  check("ticking Notify me later with a one-key patch (what MCP uses) pings", (await hitsAfter(2)) === 2, hits);

  // The bug this guards: Ledgr lowercases property keys, so the checkbox the
  // screen writes is `notifyme`, and the code must read that key.
  const { getType } = await import("../src/lib/types");
  const t = await getType("claude_run");
  check("the type's checkbox key is the one the code reads", t?.propertySchema.some((d) => d.key === "notifyme") === true, t?.propertySchema);

  const legacy = await createItem(ownerId, { type: "claude_run", title: "Camel key", properties: { notifyMe: true } });
  check("the camel-case spelling from the first release still pings", (await hitsAfter(3)) === 3, hits);

  const note = await createItem(ownerId, { type: "note", title: "not a run", properties: { notifyme: true } });
  check("another type with the same property sends nothing", (await hitsAfter(4)) === 3, hits);

  const privateKey = process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  const unset = await createItem(ownerId, { type: "claude_run", title: "No keys", properties: { notifyme: true } });
  check("with push unset nothing is sent", (await hitsAfter(4)) === 3, hits);
  check("and the run stays unclaimed", !("notifiedAt" in (await props(unset.id))));
  const mark = (await props(unset.id)).notifyRetry as { on?: string; attempts?: number } | undefined;
  check("and is marked for this copy to retry", typeof mark?.on === "string" && mark.attempts === 1, mark);

  process.env.VAPID_PRIVATE_KEY = privateKey;
  const retried = await retryPendingNotifications(ownerId);
  check("the retry job sends it once push works", retried === 1 && (await hitsAfter(4)) === 4, { retried, hits });
  check("and then it is claimed", typeof (await props(unset.id)).notifiedAt === "string");
  check("a second retry pass finds nothing", (await retryPendingNotifications(ownerId)) === 0);

  // With the Notification center on, a run also lands in the inbox. The inbox
  // is only where notifications are reviewed, so it is NOT delivery: with no
  // device reached the run is still retried, and the retry adds no second entry.
  await db.update(users).set({ settings: { modules: { "claude-runs": true, "notification-center": true } } }).where(eq(users.id, ownerId));
  const inboxed = await createItem(ownerId, { type: "claude_run", title: "Inbox run", body: body("Summary line\nmore"), properties: { notifyme: true } });
  await hitsAfter(5);
  const inboxRows = async (id: string) =>
    db.select({ kind: notifications.kind, body: notifications.body }).from(notifications).where(eq(notifications.relatedItemId, id));
  const rows = await inboxRows(inboxed.id);
  check("with the Notification center on it lands in the inbox", rows.length === 1 && rows[0].kind === "claude_run" && rows[0].body === "Summary line", rows);
  check("and still pushes", hits === 5, hits);
  delete process.env.VAPID_PRIVATE_KEY;
  const inboxOnly = await createItem(ownerId, { type: "claude_run", title: "Inbox only", properties: { notifyme: true } });
  let p2 = await props(inboxOnly.id);
  for (let i = 0; i < 40 && !("notifyRetry" in p2); i++) p2 = (await sleep(100), await props(inboxOnly.id));
  check("with no device reached, the inbox entry does not count: a retry is queued", !("notifiedAt" in p2) && "notifyRetry" in p2, p2);
  check("and the inbox has the entry", (await inboxRows(inboxOnly.id)).length === 1);
  process.env.VAPID_PRIVATE_KEY = privateKey;
  await retryPendingNotifications(ownerId);
  check("the retry pushes", (await hitsAfter(6)) === 6, hits);
  check("without a second inbox entry", (await inboxRows(inboxOnly.id)).length === 1);

  await db.execute(sql`update items set created_at = now() - interval '61 days' where id = ${quiet.id}`);
  const trashed = await trashOldRuns(ownerId);
  const [q] = await db.select({ d: items.deletedAt }).from(items).where(eq(items.id, quiet.id));
  const [l] = await db.select({ d: items.deletedAt }).from(items).where(eq(items.id, loud.id));
  const [n] = await db.select({ d: items.deletedAt }).from(items).where(eq(items.id, note.id));
  check("cleanup trashes only runs past 60 days", trashed === 1 && q.d !== null && l.d === null && n.d === null, { trashed });
} finally {
  // The "push unset" case logs to Build -> Errors on purpose; drop that row.
  await db.execute(sql`delete from error_log where source = ${"claude-runs"} and created_at > now() - make_interval(mins => 10)`);
  await db.delete(notifications).where(eq(notifications.ownerId, ownerId));
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
  server.close();
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
