// Claude Runs (ADR-284), the database half, against the DEV database under a
// throwaway owner. A local HTTP server stands in for the push service, so the
// real encrypt-and-send path runs end to end: a run pings only when "Notify me"
// is ticked, only once, on create or on a later update; with push unset it
// stays unclaimed; and cleanup trashes only runs past 60 days.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createECDH, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, pushSubscriptions } = await import("../src/db/schema");
const { generateVapidKeys } = await import("../src/lib/push/vapid");
const { saveSubscription } = await import("../src/lib/push/store");
const { createItem, updateItem } = await import("../src/lib/item-mutations");
const { trashOldRuns } = await import("../src/modules/claude-runs/lib/runs");
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
    properties: { notifyMe: true },
  });
  check("a run created with Notify me pings once", (await hitsAfter(1)) === 1, hits);
  check("and is stamped notifiedAt", typeof (await props(loud.id)).notifiedAt === "string");

  await updateItem(ownerId, loud.id, { properties: { ...(await props(loud.id)), notifyMe: true } });
  check("saving it again does not ping twice", (await hitsAfter(2)) === 1, hits);

  await updateItem(ownerId, quiet.id, { propertyPatch: { notifyMe: true } });
  check("ticking Notify me later with a one-key patch (what MCP uses) pings", (await hitsAfter(2)) === 2, hits);

  const note = await createItem(ownerId, { type: "note", title: "not a run", properties: { notifyMe: true } });
  check("another type with the same property sends nothing", (await hitsAfter(3)) === 2, hits);

  delete process.env.VAPID_PRIVATE_KEY;
  const unset = await createItem(ownerId, { type: "claude_run", title: "No keys", properties: { notifyMe: true } });
  check("with push unset nothing is sent", (await hitsAfter(3)) === 2, hits);
  check("and the run stays unclaimed", !("notifiedAt" in (await props(unset.id))));

  await db.execute(sql`update items set created_at = now() - interval '61 days' where id = ${quiet.id}`);
  const trashed = await trashOldRuns(ownerId);
  const [q] = await db.select({ d: items.deletedAt }).from(items).where(eq(items.id, quiet.id));
  const [l] = await db.select({ d: items.deletedAt }).from(items).where(eq(items.id, loud.id));
  const [n] = await db.select({ d: items.deletedAt }).from(items).where(eq(items.id, note.id));
  check("cleanup trashes only runs past 60 days", trashed === 1 && q.d !== null && l.d === null && n.d === null, { trashed });
} finally {
  // The "push unset" case logs to Build -> Errors on purpose; drop that row.
  await db.execute(sql`delete from error_log where source = ${"claude-runs"} and created_at > now() - make_interval(mins => 10)`);
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
  server.close();
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
