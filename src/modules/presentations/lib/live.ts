// Public live follow (explorations/presentations.md step 6): "Go live" mints a
// token so anyone with the link can watch exactly what the presenter shows, in
// sync. No table: a row in the generic job_state key/value table (schema.ts),
// keyed "presentation-live:<token>", holds { ownerId, itemId, state, version, at }.
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobState } from "@/db/schema";
import { parseLiveState, type LiveState } from "@/modules/presentations/lib/live-state";

const STALE_MS = 12 * 60 * 60 * 1000;

type LiveRow = { ownerId: string; itemId: string; state: LiveState; version: string; at: string };

function keyFor(token: string): string {
  return `presentation-live:${token}`;
}

// 24 random bytes base64url, same posture as share tokens (share.ts).
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

// Starting a new live session first clears any of this owner+item's previous
// live rows, so an old link a viewer still has stops working once a fresh one
// starts (ponytail: a table scan over job_state; fine at this table's size).
export async function startLive(ownerId: string, itemId: string): Promise<string> {
  const db = getDb();
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState);
  for (const row of rows) {
    if (!row.key.startsWith("presentation-live:")) continue;
    const v = row.value as Partial<LiveRow>;
    if (v.ownerId === ownerId && v.itemId === itemId) {
      await db.delete(jobState).where(eq(jobState.key, row.key));
    }
  }

  const token = newToken();
  const row: LiveRow = {
    ownerId,
    itemId,
    state: { i: 0, step: 0, blank: "", countdownEnd: null, build: false },
    version: "",
    at: new Date().toISOString(),
  };
  await db.insert(jobState).values({ key: keyFor(token), value: row });
  return token;
}

// Updates the live state, only when the token still belongs to this owner.
export async function updateLive(
  ownerId: string,
  token: string,
  state: unknown,
  version: string
): Promise<boolean> {
  const parsed = parseLiveState(state);
  if (!parsed || typeof version !== "string") return false;

  const db = getDb();
  const [existing] = await db
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, keyFor(token)));
  const current = existing?.value as Partial<LiveRow> | undefined;
  if (!current || current.ownerId !== ownerId) return false;

  const row: LiveRow = { ownerId, itemId: current.itemId!, state: parsed, version, at: new Date().toISOString() };
  await db.insert(jobState).values({ key: keyFor(token), value: row }).onConflictDoUpdate({
    target: jobState.key,
    set: { value: row, updatedAt: new Date() },
  });
  return true;
}

export async function endLive(ownerId: string, token: string): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, keyFor(token)));
  const current = existing?.value as Partial<LiveRow> | undefined;
  if (!current || current.ownerId !== ownerId) return;
  await db.delete(jobState).where(eq(jobState.key, keyFor(token)));
}

// Public read: null when missing or stale. Staleness is checked here rather
// than swept, since a dead link going 404 after 12 hours is all that matters.
export async function readLive(token: string): Promise<LiveRow | null> {
  const db = getDb();
  const [existing] = await db
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, keyFor(token)));
  const row = existing?.value as LiveRow | undefined;
  if (!row) return null;
  if (Date.now() - new Date(row.at).getTime() > STALE_MS) return null;
  return row;
}
