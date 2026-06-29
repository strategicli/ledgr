// Slice 30 verification: the hand-rolled Web Push stack + the notify engines.
// The crypto is proven by self-test (no live push service): VAPID JWT signed
// then verified with the public key, and message encryption round-tripped
// (encrypt to a generated subscription, decrypt from its side, compare). Then
// the store CRUD, send-and-prune, and the agenda/prep triggers run against the
// live Neon DB under a throwaway owner with a stub sender (no network, no
// VAPID keys). Run: npx tsx scripts/verify-push.mts
// Safe to delete once the slice is closed.
import { readFileSync } from "node:fs";
import {
  createDecipheriv,
  createECDH,
  hkdfSync,
  randomBytes,
  verify as cryptoVerify,
  createPublicKey,
} from "node:crypto";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, relations, users, pushSubscriptions, jobState, notifications } = await import("../src/db/schema");
const { generateVapidKeys, signVapidJwt, audienceFor, b64urlEncode, b64urlDecode } = await import("../src/lib/push/vapid");
const { encryptPush } = await import("../src/lib/push/encrypt");
const store = await import("../src/lib/push/store");
const { sendToOwner, runAgendaNotify, runPrepNotify, AGENDA_JOB_KEY, PREP_JOB_KEY } = await import("../src/lib/push/notify");
type PushSender = import("../src/lib/push/types").PushSender;
type PushMessage = import("../src/lib/push/types").PushMessage;
type PushSubscriptionRecord = import("../src/lib/push/types").PushSubscriptionRecord;
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- 1. VAPID keygen + JWT sign/verify ------------------------------------
const keys = generateVapidKeys();
const pubPoint = b64urlDecode(keys.publicKey);
check("VAPID public key is a 65-byte uncompressed EC point", pubPoint.length === 65 && pubPoint[0] === 0x04, `len=${pubPoint.length}`);
check("VAPID private key is 32 bytes", b64urlDecode(keys.privateKey).length === 32);

const config = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:test@example.invalid" };
const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";
const { jwt, publicKey: jwtKey } = signVapidJwt(audienceFor(endpoint), config, 1_700_000_000_000);
const [hB64, pB64, sB64] = jwt.split(".");
const header = JSON.parse(b64urlDecode(hB64).toString());
const payload = JSON.parse(b64urlDecode(pB64).toString());
check("JWT header is ES256/JWT", header.alg === "ES256" && header.typ === "JWT");
check("JWT aud is the push origin", payload.aud === "https://fcm.googleapis.com", payload.aud);
check("JWT carries sub and a future exp", payload.sub === "mailto:test@example.invalid" && payload.exp > 1_700_000_000);
check("Authorization header pairs the JWT with the public key", jwtKey === keys.publicKey);

// Verify the signature with the public key (built from the point as a JWK).
const vapidPubKey = createPublicKey({
  format: "jwk",
  key: { kty: "EC", crv: "P-256", x: b64urlEncode(pubPoint.subarray(1, 33)), y: b64urlEncode(pubPoint.subarray(33, 65)) },
});
const sigOk = cryptoVerify("sha256", Buffer.from(`${hB64}.${pB64}`), { key: vapidPubKey, dsaEncoding: "ieee-p1363" }, b64urlDecode(sB64));
check("JWT signature verifies against the VAPID public key", sigOk);
const tampered = cryptoVerify("sha256", Buffer.from(`${hB64}.${pB64}x`), { key: vapidPubKey, dsaEncoding: "ieee-p1363" }, b64urlDecode(sB64));
check("a tampered signing input fails verification", !tampered);

// --- 2. RFC 8291 encryption round-trip ------------------------------------
// Stand in as the user agent: generate the subscription keypair + auth secret.
const ua = createECDH("prime256v1");
ua.generateKeys();
const uaPublic = ua.getPublicKey();
const authSecret = randomBytes(16);
const p256dh = b64urlEncode(uaPublic);
const auth = b64urlEncode(authSecret);

const plaintext = Buffer.from(JSON.stringify({ title: "Today's agenda", body: "2 meetings, 3 tasks due today." }));
const { body } = encryptPush(p256dh, auth, plaintext);

// Decrypt from the UA side, reversing the derivation in encrypt.ts.
const salt = body.subarray(0, 16);
const idlen = body.readUInt8(20);
const asPublic = body.subarray(21, 21 + idlen);
const ciphertext = body.subarray(21 + idlen);
const ecdhSecret = ua.computeSecret(asPublic);
const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
const tag = ciphertext.subarray(ciphertext.length - 16);
const enc = ciphertext.subarray(0, ciphertext.length - 16);
const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
decipher.setAuthTag(tag);
let decrypted: Buffer | null = null;
try {
  const out = Buffer.concat([decipher.update(enc), decipher.final()]);
  decrypted = out.subarray(0, out.length - 1); // strip the 0x02 delimiter
} catch {
  decrypted = null;
}
check("encryption header keyid length is 65 (application-server key)", idlen === 65);
check("round-trip decrypts to the original plaintext", !!decrypted && decrypted.equals(plaintext), decrypted ? decrypted.toString().slice(0, 40) : "decrypt failed");

// --- stub sender -----------------------------------------------------------
class StubSender implements PushSender {
  calls: { endpoint: string; message: PushMessage }[] = [];
  goneEndpoints = new Set<string>();
  async send(sub: PushSubscriptionRecord, message: PushMessage) {
    this.calls.push({ endpoint: sub.endpoint, message });
    if (this.goneEndpoints.has(sub.endpoint)) {
      return { ok: false as const, gone: true, status: 410, detail: "gone" };
    }
    return { ok: true as const, status: 201 };
  }
}

const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-push-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;

const mk = async (v: Record<string, unknown>) =>
  (await db.insert(items).values({ ownerId, ...(v as object) } as typeof items.$inferInsert).returning({ id: items.id }))[0].id;

try {
  // --- 3. store CRUD -------------------------------------------------------
  const subA: PushSubscriptionRecord = { endpoint: `https://push.example/${ownerId}/A`, p256dh, auth };
  const subB: PushSubscriptionRecord = { endpoint: `https://push.example/${ownerId}/B`, p256dh, auth };
  await store.saveSubscription(ownerId, subA);
  await store.saveSubscription(ownerId, subB);
  check("two subscriptions saved", (await store.countSubscriptions(ownerId)) === 2);

  // Re-saving the same endpoint with new keys is an idempotent upsert.
  await store.saveSubscription(ownerId, { ...subA, p256dh: "UPDATED" });
  const after = await store.listSubscriptions(ownerId);
  check("re-subscribe upserts (no duplicate, keys updated)", after.length === 2 && after.some((s) => s.p256dh === "UPDATED"));

  await store.deleteSubscription(ownerId, subB.endpoint);
  check("unsubscribe removes by endpoint", (await store.countSubscriptions(ownerId)) === 1);

  // restore subA's real key and re-add subB for the send tests
  await store.saveSubscription(ownerId, subA);
  await store.saveSubscription(ownerId, subB);

  // --- 4. sendToOwner prunes Gone endpoints --------------------------------
  const pruneSender = new StubSender();
  pruneSender.goneEndpoints.add(subB.endpoint);
  const tally = await sendToOwner(ownerId, pruneSender, { title: "t", body: "b" });
  check("send tally counts one sent + one pruned", tally.sent === 1 && tally.pruned === 1, JSON.stringify(tally));
  check("the Gone subscription was pruned from the store", (await store.countSubscriptions(ownerId)) === 1);

  // --- 5. morning agenda ---------------------------------------------------
  await mk({ type: "event", title: "Standup", meetingAt: new Date(Date.now() + 45 * 60_000) });
  const agendaSender = new StubSender();
  const agenda1 = await runAgendaNotify(ownerId, agendaSender);
  check("agenda send is not skipped on first run", agenda1.skipped === false);
  check("agenda message titled 'Today's agenda' sent to the live sub", agendaSender.calls.length === 1 && agendaSender.calls[0].message.title === "Today's agenda", agendaSender.calls[0]?.message.body);
  check("agenda click target is Today", agendaSender.calls[0]?.message.url === "/");

  const agendaSender2 = new StubSender();
  const agenda2 = await runAgendaNotify(ownerId, agendaSender2);
  check("agenda is skipped on a second same-day run (day guard)", agenda2.skipped === true && agendaSender2.calls.length === 0);

  // --- 6. meeting-prep-ready ----------------------------------------------
  const person = await mk({ type: "person", title: "Roger" });
  // In-window meeting WITH a confirmed person -> notified.
  const soon = await mk({ type: "event", title: "Roger 1:1", meetingAt: new Date(Date.now() + 30 * 60_000) });
  await db.insert(relations).values({ sourceId: soon, targetId: person, role: "related", matchState: "confirmed" });
  // In-window meeting with NO entity -> not notified.
  await mk({ type: "event", title: "Solo block", meetingAt: new Date(Date.now() + 30 * 60_000) });
  // Out-of-window meeting (5h out) WITH an entity -> not notified.
  const later = await mk({ type: "event", title: "Later 1:1", meetingAt: new Date(Date.now() + 5 * 60 * 60_000) });
  await db.insert(relations).values({ sourceId: later, targetId: person, role: "related", matchState: "confirmed" });
  // Canceled in-window meeting WITH an entity -> not notified.
  const canceled = await mk({ type: "event", title: "Canceled 1:1", meetingAt: new Date(Date.now() + 30 * 60_000), properties: { calendar: { canceled: true } } });
  await db.insert(relations).values({ sourceId: canceled, targetId: person, role: "related", matchState: "confirmed" });

  const prepSender = new StubSender();
  const prep1 = await runPrepNotify(ownerId, prepSender);
  check("prep notifies exactly the in-window meeting with an entity", prep1.notified === 1, `notified=${prep1.notified}`);
  check("prep notification names the meeting", prepSender.calls.some((c) => c.message.title.includes("Roger 1:1")), prepSender.calls.map((c) => c.message.title).join(" | "));
  check("prep click target is the meeting", prepSender.calls[0]?.message.url === `/items/${soon}`);

  // The notified meeting is flagged; a second run does nothing.
  const flagged = await db.select({ properties: items.properties }).from(items).where(eq(items.id, soon));
  const flag = (flagged[0].properties as { notify?: { prepNotifiedAt?: string } } | null)?.notify?.prepNotifiedAt;
  check("notified meeting carries properties.notify.prepNotifiedAt", typeof flag === "string");

  const prepSender2 = new StubSender();
  const prep2 = await runPrepNotify(ownerId, prepSender2);
  check("prep does not re-notify an already-flagged meeting", prep2.notified === 0 && prepSender2.calls.length === 0);

  // --- 7. owner scoping ----------------------------------------------------
  const [otherUser] = await db.insert(users).values({ email: `verify-push-other-${Date.now()}@example.invalid` }).returning({ id: users.id });
  let crossClean = false;
  try {
    crossClean = (await store.countSubscriptions(otherUser.id)) === 0;
    const cross = await sendToOwner(otherUser.id, new StubSender(), { title: "x", body: "y" });
    crossClean = crossClean && cross.sent === 0;
  } finally {
    await db.delete(users).where(eq(users.id, otherUser.id));
  }
  check("sends are owner-scoped (other owner has no subscriptions)", crossClean);
} finally {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.ownerId, ownerId));
  // The agenda/prep senders now also persist a notification row (ADR-129);
  // clear them before the user FK delete.
  await db.delete(notifications).where(eq(notifications.ownerId, ownerId));
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
  // The notify job_state keys are global (single-user); clear what this run
  // wrote so production starts these brand-new jobs fresh.
  await db.delete(jobState).where(inArray(jobState.key, [AGENDA_JOB_KEY, PREP_JOB_KEY]));
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
