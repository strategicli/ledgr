// PJ7 / ADR-111 verification: the Digest engine. Pure: digestStatus (staleness
// vs upcoming vs none), composeDigest payload, daysUntil. Live Neon under a
// THROWAWAY owner (so it can't touch real projects): a stale project triggers,
// a fresh one doesn't, an upcoming milestone triggers, a recent review resets
// the clock, and dedup suppresses a second ping in the same window.
// Run: npx tsx scripts/verify-digest.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users, activityEvents } = await import("../src/db/schema");
const { createItem, getItem } = await import("../src/lib/items");
const { setHome } = await import("../src/lib/relations");
const { digestStatus, composeDigest, daysUntil } = await import("../src/lib/digest/compose");
const { runDigestNotify } = await import("../src/lib/digest/notify");
const { eq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const DAY = 86_400_000;
const sender = { async send() { return { ok: true } as const; } } as never;

console.log("\n# Pure: digestStatus");
{
  const now = new Date("2026-06-29T12:00:00Z");
  const old = new Date(now.getTime() - 9 * DAY);
  check("quiet ≥ stalenessDays → staleness", digestStatus({ lastActivityAt: old, lastReviewedAt: null, stalenessDays: 7, upcomingMilestoneDays: [], upcomingDays: 7, now }).trigger === "staleness");
  check("recent activity → no trigger", digestStatus({ lastActivityAt: new Date(now.getTime() - DAY), lastReviewedAt: null, stalenessDays: 7, upcomingMilestoneDays: [], upcomingDays: 7, now }).trigger === null);
  check("upcoming milestone within window → upcoming", digestStatus({ lastActivityAt: new Date(now.getTime() - DAY), lastReviewedAt: null, stalenessDays: 7, upcomingMilestoneDays: [3], upcomingDays: 7, now }).trigger === "upcoming_milestone");
  check("a milestone beyond the window doesn't trigger", digestStatus({ lastActivityAt: new Date(now.getTime() - DAY), lastReviewedAt: null, stalenessDays: 7, upcomingMilestoneDays: [30], upcomingDays: 7, now }).trigger === null);
  check("no activity ever → not stale (don't nag empty)", digestStatus({ lastActivityAt: null, lastReviewedAt: null, stalenessDays: 7, upcomingMilestoneDays: [], upcomingDays: 7, now }).trigger === null);
  check("a recent review beats old activity (reset)", digestStatus({ lastActivityAt: old, lastReviewedAt: new Date(now.getTime() - DAY), stalenessDays: 7, upcomingMilestoneDays: [], upcomingDays: 7, now }).trigger === null);
}

console.log("\n# Pure: composeDigest + daysUntil");
{
  const msg = composeDigest({ title: "Booklet", tasksClosed: 3, daysQuiet: 9, nextActionText: "email printer", upcoming: { label: "to printer", daysUntil: 4 } });
  check("payload composes the three inputs", msg.body.includes("3 tasks closed") && msg.body.includes("to printer in 4 days") && msg.body.includes("no activity in 9 days") && msg.body.includes("next: email printer"), msg.body);
  check("empty inputs → a gentle fallback", composeDigest({ title: "P", tasksClosed: 0, daysQuiet: 0, nextActionText: null }).body === "Time to check in.");
  const now = new Date("2026-06-29T12:00:00Z");
  check("daysUntil counts UTC calendar days", daysUntil(new Date("2026-07-02T00:00:00Z"), now) === 3);
}

const db = getDb();
const stamp = Date.now();
const [owner] = await db.insert(users).values({ email: `verify-digest-${stamp}@example.invalid` }).returning({ id: users.id });
const ownerId = owner.id;
const created: string[] = [];
async function make(type: string, title: string, extra: Record<string, unknown> = {}) {
  const it = await createItem(ownerId, { type, title, ...extra });
  created.push(it.id);
  return it;
}
async function digestStamp(id: string) {
  const it = await getItem(ownerId, id);
  return ((it.properties as Record<string, unknown> | null)?.notify as Record<string, unknown> | undefined)?.digestNotifiedAt;
}

console.log("\n# Live: fresh vs stale (isolated owner)");
{
  const project = await make("project", "Digest stale project");
  const fresh = await runDigestNotify(ownerId, sender, new Date()); // ~now, just created
  check("a fresh project does not ping", (await digestStamp(project.id)) === undefined && fresh.notified === 0);

  const future = new Date(Date.now() + 10 * DAY);
  const stale = await runDigestNotify(ownerId, sender, future); // 10 days quiet
  check("a stale project pings", stale.notified === 1 && typeof (await digestStamp(project.id)) === "string");

  const again = await runDigestNotify(ownerId, sender, future); // dedup
  check("dedup: a second run in the same window doesn't re-ping", again.notified === 0);
}

console.log("\n# Live: upcoming milestone triggers");
{
  const project = await make("project", "Digest milestone project");
  const ms = await make("milestone", "Launch", { dueDate: new Date(Date.now() + 3 * DAY) });
  await setHome(ownerId, ms.id, project.id, "contains");
  const res = await runDigestNotify(ownerId, sender, new Date()); // fresh activity, but milestone in 3d
  check("an upcoming milestone pings even when not stale", typeof (await digestStamp(project.id)) === "string", `notified ${res.notified}`);
}

console.log("\n# Live: a recent review resets the clock");
{
  const project = await make("project", "Digest reviewed project");
  const future = new Date(Date.now() + 10 * DAY);
  // A review 1 hour before the eval time — the clock is fresh.
  await db.insert(activityEvents).values({ ownerId, subjectId: project.id, kind: "checkin_reviewed", summary: "Reviewed", occurredAt: new Date(future.getTime() - 3600_000) });
  const res = await runDigestNotify(ownerId, sender, future);
  check("a just-reviewed project is not stale", (await digestStamp(project.id)) === undefined, `notified ${res.notified}`);
}

await db.delete(activityEvents).where(inArray(activityEvents.subjectId, created));
for (const id of [...created].reverse()) await db.delete(items).where(eq(items.id, id));
await db.delete(users).where(eq(users.id, ownerId));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
