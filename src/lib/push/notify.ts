// Push notification triggers (slice 30, PRD §4.5/§4.11): the morning agenda
// summary and meeting-prep-ready notices. Deterministic, no model in the loop
// (rule 3) — the AI-assembled agenda the PRD imagines is Phase 3; this is a
// plain count summary. Both run from authenticated cron endpoints over the
// same PushSender, so they verify against a stub with no keys and no network.
import { and, eq, gt, isNull, lte, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items, jobState } from "@/db/schema";
import { getMeetingPeople } from "@/lib/meetings/prep";
import { getTodayData, APP_TIMEZONE, ymdInZone } from "@/lib/today";
import { listSubscriptions, pruneSubscription } from "./store";
import type { PushMessage, PushSender } from "./types";

export const AGENDA_JOB_KEY = "notify:agenda";
export const PREP_JOB_KEY = "notify:prep";

// Default prep window: notify for meetings starting within the next 2 hours.
// The cron cadence (hourly) is narrower than the window, and the per-meeting
// flag dedups, so a meeting is notified exactly once as it comes due.
const PREP_WINDOW_MINUTES = 120;

type NotifyState = { lastSuccessAt?: string; lastRunAt?: string; lastDay?: string };

async function readState(key: string): Promise<NotifyState> {
  const rows = await getDb()
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, key));
  return (rows[0]?.value as NotifyState) ?? {};
}

async function writeState(key: string, value: NotifyState): Promise<void> {
  await getDb()
    .insert(jobState)
    .values({ key, value })
    .onConflictDoUpdate({ target: jobState.key, set: { value } });
}

export async function getPushState(): Promise<{
  agenda: NotifyState;
  prep: NotifyState;
}> {
  const [agenda, prep] = await Promise.all([
    readState(AGENDA_JOB_KEY),
    readState(PREP_JOB_KEY),
  ]);
  return { agenda, prep };
}

export type SendTally = { sent: number; pruned: number; failed: number };

// Sends one message to every live subscription the owner has, pruning any the
// push service reports Gone. A subscription send failure (not Gone) is counted
// but never aborts the others.
export async function sendToOwner(
  ownerId: string,
  sender: PushSender,
  message: PushMessage
): Promise<SendTally> {
  const subs = await listSubscriptions(ownerId);
  const tally: SendTally = { sent: 0, pruned: 0, failed: 0 };
  for (const sub of subs) {
    const result = await sender.send(sub, message);
    if (result.ok) tally.sent += 1;
    else if (result.gone) {
      await pruneSubscription(sub.endpoint);
      tally.pruned += 1;
    } else tally.failed += 1;
  }
  return tally;
}

// Morning agenda (PRD §4.11). One concise summary of today's meetings and due
// tasks; the notification click opens Today. Sent once per day — the day guard
// makes a double-fired cron a no-op.
export async function runAgendaNotify(
  ownerId: string,
  sender: PushSender,
  now = new Date()
): Promise<{ skipped: boolean; tally?: SendTally }> {
  const todayKey = `${ymdInZone(now, APP_TIMEZONE).y}-${ymdInZone(now, APP_TIMEZONE).m}-${ymdInZone(now, APP_TIMEZONE).d}`;
  const state = await readState(AGENDA_JOB_KEY);
  if (state.lastDay === todayKey) return { skipped: true };

  const { meetings, dueTasks } = await getTodayData(ownerId, now);
  const parts: string[] = [];
  parts.push(meetings.length === 1 ? "1 meeting" : `${meetings.length} meetings`);
  parts.push(dueTasks.length === 1 ? "1 task due" : `${dueTasks.length} tasks due`);
  const firstMeeting = meetings[0];
  const lead = firstMeeting?.meetingAt
    ? ` First: ${firstMeeting.title || "Untitled"} at ${new Intl.DateTimeFormat(
        "en-US",
        { timeZone: APP_TIMEZONE, hour: "numeric", minute: "2-digit" }
      ).format(firstMeeting.meetingAt)}.`
    : "";
  const message: PushMessage = {
    title: "Today's agenda",
    body: `${parts.join(", ")} today.${lead}`,
    url: "/",
    tag: "ledgr-agenda",
  };

  const tally = await sendToOwner(ownerId, sender, message);
  await writeState(AGENDA_JOB_KEY, {
    ...state,
    lastRunAt: now.toISOString(),
    lastSuccessAt: now.toISOString(),
    lastDay: todayKey,
  });
  return { skipped: false, tally };
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});

// Meeting-prep-ready (PRD §4.11). For each meeting coming due inside the window
// that has a confirmed related entity (so there's prep worth opening) and
// hasn't been notified yet, send one notice and stamp
// properties.notify.prepNotifiedAt so it never repeats.
export async function runPrepNotify(
  ownerId: string,
  sender: PushSender,
  now = new Date(),
  windowMinutes = PREP_WINDOW_MINUTES
): Promise<{ notified: number; tally: SendTally }> {
  const db = getDb();
  const windowEnd = new Date(now.getTime() + windowMinutes * 60_000);
  const candidates = await db
    .select({
      id: items.id,
      title: items.title,
      meetingAt: items.meetingAt,
    })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.type, "meeting"),
        ne(items.statusCategory, "archived"),
        isNull(items.deletedAt),
        // No prep push for a template meeting (ADR-093).
        eq(items.isTemplate, false),
        gt(items.meetingAt, now),
        lte(items.meetingAt, windowEnd),
        // not cancelled (calendar flag) and not already prep-notified
        sql`coalesce((${items.properties} #>> '{calendar,canceled}')::boolean, false) = false`,
        sql`${items.properties} #>> '{notify,prepNotifiedAt}' is null`
      )
    )
    .orderBy(items.meetingAt);

  const tally: SendTally = { sent: 0, pruned: 0, failed: 0 };
  let notified = 0;
  for (const m of candidates) {
    const people = await getMeetingPeople(ownerId, m.id);
    if (people.length === 0) continue; // no prep worth surfacing yet

    const when = m.meetingAt ? ` at ${timeFmt.format(m.meetingAt)}` : "";
    const who = people.map((e) => e.title).slice(0, 2).join(", ");
    const t = await sendToOwner(ownerId, sender, {
      title: `Prep ready: ${m.title || "Untitled"}`,
      body: `${when ? `${when.trim()}.` : ""}${who ? ` With ${who}.` : ""}`.trim() || "Open meeting prep.",
      url: `/items/${m.id}`,
      tag: `ledgr-prep-${m.id}`,
    });
    tally.sent += t.sent;
    tally.pruned += t.pruned;
    tally.failed += t.failed;
    notified += 1;

    // Stamp the flag (merge into properties; one write per meeting, ever).
    await db
      .update(items)
      .set({
        properties: sql`coalesce(${items.properties}, '{}'::jsonb) || jsonb_build_object('notify', coalesce(${items.properties} -> 'notify', '{}'::jsonb) || jsonb_build_object('prepNotifiedAt', ${now.toISOString()}::text))`,
      })
      .where(and(eq(items.id, m.id), eq(items.ownerId, ownerId)));
  }

  await writeState(PREP_JOB_KEY, {
    lastRunAt: now.toISOString(),
    lastSuccessAt: now.toISOString(),
  });
  return { notified, tally };
}
