// Public live follow (explorations/presentations.md step 6): "Go live" mints a
// token so anyone with the link can watch exactly what the presenter shows, in
// sync. No table: a row in the generic job_state key/value table (schema.ts),
// keyed "presentation-live:<token>", holds { ownerId, itemId, state, version, at }.
//
// The phone remote rides the same token: a second row, "presentation-remote:<token>",
// holds a secret key and the phone's last few taps. A separate row, so the
// presenter window's state writes and the phone's taps never overwrite each other.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobState } from "@/db/schema";
import { parseLiveState, type LiveState, type RemoteCommand } from "@/modules/presentations/lib/live-state";

const STALE_MS = 12 * 60 * 60 * 1000;
const KEEP_COMMANDS = 20;

type LiveRow = { ownerId: string; itemId: string; state: LiveState; version: string; at: string };
export type NumberedCommand = RemoteCommand & { n: number };
type RemoteRow = { ownerId: string; key: string; cmds: NumberedCommand[] };

function keyFor(token: string): string {
  return `presentation-live:${token}`;
}
function remoteKeyFor(token: string): string {
  return `presentation-remote:${token}`;
}

// 24 random bytes base64url, same posture as share tokens (share.ts).
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

// Starting a new live session first clears any of this owner+item's previous
// live rows, so an old link a viewer still has stops working once a fresh one
// starts (ponytail: a table scan over job_state; fine at this table's size).
export async function startLive(
  ownerId: string,
  itemId: string
): Promise<{ token: string; remoteKey: string }> {
  const db = getDb();
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState);
  for (const row of rows) {
    if (!row.key.startsWith("presentation-live:")) continue;
    const v = row.value as Partial<LiveRow>;
    if (v.ownerId === ownerId && v.itemId === itemId) {
      await db.delete(jobState).where(eq(jobState.key, row.key));
      await db.delete(jobState).where(eq(jobState.key, remoteKeyFor(row.key.slice("presentation-live:".length))));
    }
  }

  const token = newToken();
  const remoteKey = newToken();
  const remote: RemoteRow = { ownerId, key: remoteKey, cmds: [] };
  await db.insert(jobState).values({ key: remoteKeyFor(token), value: remote });
  const row: LiveRow = {
    ownerId,
    itemId,
    state: { i: 0, step: 0, blank: "", countdownEnd: null, build: false },
    version: "",
    at: new Date().toISOString(),
  };
  await db.insert(jobState).values({ key: keyFor(token), value: row });
  return { token, remoteKey };
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
  await db.delete(jobState).where(eq(jobState.key, remoteKeyFor(token)));
}

async function readRemote(token: string): Promise<RemoteRow | null> {
  const [existing] = await getDb()
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, remoteKeyFor(token)));
  return (existing?.value as RemoteRow | undefined) ?? null;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// The phone's tap. The key is the credential (no session on the phone); the
// live row must still be up, so an ended or stale show takes no more taps.
// ponytail: read-modify-write, so two taps landing in the same instant could
// drop one; the remote page sends its taps one at a time, which covers one phone.
export async function pushRemoteCommand(token: string, key: string, cmd: RemoteCommand): Promise<boolean> {
  const [live, remote] = await Promise.all([readLive(token), readRemote(token)]);
  if (!live || !remote || !sameSecret(remote.key, key)) return false;
  const n = (remote.cmds.at(-1)?.n ?? 0) + 1;
  const row: RemoteRow = { ...remote, cmds: [...remote.cmds, { ...cmd, n }].slice(-KEEP_COMMANDS) };
  await getDb().update(jobState).set({ value: row }).where(eq(jobState.key, remoteKeyFor(token)));
  return true;
}

// The presenter window's poll: taps numbered above `after`, oldest first.
export async function readRemoteCommands(
  ownerId: string,
  token: string,
  after: number
): Promise<NumberedCommand[] | null> {
  const remote = await readRemote(token);
  if (!remote || remote.ownerId !== ownerId) return null;
  return remote.cmds.filter((c) => c.n > after);
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
