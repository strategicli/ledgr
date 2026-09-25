// "Keep a copy in the cloud" (ADR-277): the pure half. A hub pairs with a fresh
// cloud copy by a one-time code, fills it with everything, then keeps it in
// sync as an ordinary hub entry. No I/O here, so scripts/verify-pairing.mts can
// exercise every rule in CI; the impure halves are pairing-cloud.ts (the cloud's
// door) and pairing-hub.ts (the hub's runner).
//
// THE SHAPE, because the direction is easy to get backwards: in sync terms the
// CLOUD is the passive side (it serves /api/machine/sync) and the hub dials it,
// exactly like Brandon's own pair. So the cloud never calls the hub, which is
// why this works from behind any home router with no tunnel.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { EXCLUDED_TABLES } from "../../../scripts/lib/pg-copy.mjs";

// ── The pairing code ────────────────────────────────────────────────────────

// Crockford's base32 minus the letters people misread (no I, L, O, U). Twelve
// characters is 60 bits. The code is shown on the hub and typed on the cloud,
// and a wrong guess at the cloud burns one of CLAIM_ATTEMPTS, so guessing it is
// not a real attack; the length is for the typo-free reading, not the math.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LEN = 12;

export function newPairingCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** How a code is shown: ABCD-EFGH-JKMN. */
export function formatPairingCode(code: string): string {
  return normalizePairingCode(code).replace(/(.{4})(?=.)/g, "$1-");
}

/** Forgiving about what a person types: case, dashes, spaces, O for 0, I/L for 1. */
export function normalizePairingCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V")
    .slice(0, 32);
}

export function pairingCodeShapeOk(code: string): boolean {
  return code.length === CODE_LEN && [...code].every((c) => ALPHABET.includes(c));
}

export function hashPairingCode(code: string): string {
  return createHash("sha256").update(`ledgr-pair:${normalizePairingCode(code)}`).digest("hex");
}

/** Constant-time: the stored value is a hash, the offered one is hashed first. */
export function pairingCodeMatches(offered: string, storedHash: string): boolean {
  const a = Buffer.from(hashPairingCode(offered), "hex");
  const b = Buffer.from(typeof storedHash === "string" ? storedHash : "", "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── The cloud's door ────────────────────────────────────────────────────────

/** How long after a cloud copy's database was first migrated it accepts pairing. */
export const PAIRING_WINDOW_MS = 2 * 60 * 60 * 1000;
/** How long a code typed on the cloud stays good. */
export const CODE_TTL_MS = 15 * 60 * 1000;
/** Wrong codes before the typed one is thrown away and must be typed again. */
export const CLAIM_ATTEMPTS = 5;

/**
 * Is the cloud copy's pairing door open? Only for a while after it was first
 * set up, then only when its owner reopens it from the host's settings.
 *
 * "First set up" is the oldest `types.created_at`: the system types are seeded
 * by the migrations, so that stamp is when this database was first migrated,
 * which on Vercel is the first deploy. Nobody without database access can move
 * it, and redeploying does not either (the seeds insert once).
 */
export function pairingWindowOpen(opts: {
  firstMigratedAt: Date | null;
  now: number;
  override: string | undefined;
}): boolean {
  if (opts.override === "1") return true;
  if (!opts.firstMigratedAt) return false;
  const age = opts.now - opts.firstMigratedAt.getTime();
  return age >= 0 && age < PAIRING_WINDOW_MS;
}

/** The cloud's pairing record, in its own job_state (never synced, never filled). */
export type CloudPairState =
  | { status: "code"; codeHash: string; expiresAt: string; attempts: number }
  | { status: "paired" | "filling" | "done"; deviceId: string; at: string };

export function parseCloudPairState(raw: unknown): CloudPairState | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (v.status === "code" && typeof v.codeHash === "string" && typeof v.expiresAt === "string") {
    return { status: "code", codeHash: v.codeHash, expiresAt: v.expiresAt, attempts: Number(v.attempts) || 0 };
  }
  if ((v.status === "paired" || v.status === "filling" || v.status === "done") && typeof v.deviceId === "string") {
    return { status: v.status, deviceId: v.deviceId, at: typeof v.at === "string" ? v.at : "" };
  }
  return null;
}

/** What the cloud knows about itself when it decides. */
export type CloudFacts = {
  hasOwner: boolean;
  hasItems: boolean;
  windowOpen: boolean;
  preview: boolean;
  state: CloudPairState | null;
};

/** An empty, unowned copy: the only kind that may ever be paired or filled. */
export function cloudUnclaimed(f: Pick<CloudFacts, "hasOwner" | "hasItems">): boolean {
  return !f.hasOwner && !f.hasItems;
}

/** Why the cloud refuses a code typed on its /setup page, or null to accept it. */
export function enterCodeRefusal(f: CloudFacts): string | null {
  if (f.preview) return "A preview deployment can't be paired. Use the production address.";
  if (!cloudUnclaimed(f)) return "This copy of Ledgr already has an owner or data, so it can't be paired.";
  if (f.state && f.state.status !== "code") return "This copy is already paired with a Ledgr.";
  if (!f.windowOpen) return WINDOW_CLOSED;
  return null;
}

export const WINDOW_CLOSED =
  "Pairing is closed on this copy. A new cloud copy accepts a pairing code for two hours after it is first " +
  "set up. To open it again, add the setting LEDGR_ALLOW_PAIRING with the value 1 in your host's " +
  "environment settings (on Vercel: Project, Settings, Environment Variables), redeploy, and try again. " +
  "Once the copy is paired it has an owner, and the setting does nothing after that.";

export type ClaimDecision =
  | { ok: true }
  | { ok: false; status: number; error: string; burn: boolean; wipe: boolean };

/**
 * The hub offering a code. `burn` counts a wrong guess; `wipe` throws the typed
 * code away (it expired, or it has been guessed at too often).
 */
export function claimDecision(f: CloudFacts, offered: string, now: number): ClaimDecision {
  const no = (status: number, error: string, burn = false, wipe = false): ClaimDecision => ({
    ok: false,
    status,
    error,
    burn,
    wipe,
  });
  const refusal = enterCodeRefusal(f);
  if (refusal) return no(409, refusal);
  const s = f.state;
  if (!s || s.status !== "code") return no(409, "No pairing code has been typed on the cloud copy yet.");
  if (Date.parse(s.expiresAt) <= now) return no(410, "The code typed on the cloud copy expired. Type it again.", false, true);
  if (s.attempts >= CLAIM_ATTEMPTS) return no(429, "Too many wrong codes. Type the code on the cloud copy again.", false, true);
  if (!pairingCodeMatches(offered, s.codeHash)) {
    return no(403, "That code doesn't match the one typed on the cloud copy.", true, s.attempts + 1 >= CLAIM_ATTEMPTS);
  }
  return { ok: true };
}

export type FillStep = "begin" | "rows" | "links" | "stage" | "finish" | "cancel";

/**
 * May this device run this fill step now? The token already proved WHICH
 * device; this proves it is the one the copy was paired with, and that the copy
 * is at the right point. A copy that already has an owner is never filled: the
 * only owner row a fill may meet is the one its own `begin` wrote.
 */
export function fillRefusal(
  f: Pick<CloudFacts, "hasOwner" | "hasItems" | "state">,
  step: FillStep,
  deviceId: string
): string | null {
  const s = f.state;
  if (!s || s.status === "code" || s.deviceId !== deviceId) return "This device is not paired with this copy.";
  if (s.status === "done") return "This copy is already filled.";
  if (step === "cancel") return f.hasOwner ? "This copy already has data, so it can't be unpaired this way." : null;
  if (step === "begin") {
    if (s.status === "paired") return cloudUnclaimed(f) ? null : "This copy already has an owner or data.";
    return null; // filling: a resumed begin, checked against the owner row itself
  }
  return s.status === "filling" ? null : "The fill has not begun.";
}

// ── What a fill copies ──────────────────────────────────────────────────────

/**
 * Tables a hub never copies into a cloud copy, beyond the ones no fill ever
 * copies (pg-copy's EXCLUDED_TABLES: the oplog, device identity, sign-in state).
 *
 *   - job_state: per-install bookkeeping, including this hub's tokens for its
 *     other copies and the pairing record itself.
 *   - api_credentials: machine and connector tokens are per install. Copied,
 *     a token revoked at the hub would keep working in the cloud, since the
 *     table does not sync.
 *   - push_subscriptions: browser push endpoints; a copy would notify twice.
 *   - error_log: this machine's errors.
 *   - sync_schema_ver: the migrations write it on both sides.
 */
export const FILL_EXCLUDED = new Set<string>([
  ...(EXCLUDED_TABLES as Set<string>),
  "job_state",
  "api_credentials",
  "push_subscriptions",
  "error_log",
  "sync_schema_ver",
]);

export function fillTables(allTables: string[], opts: { filesOnThisDisk: boolean }): string[] {
  return allTables.filter(
    (t) => !FILL_EXCLUDED.has(t) && !(opts.filesOnThisDisk && t === "attachments")
  );
}

export type ForeignKey = { tbl: string; col: string; ref: string };
export type FillPlan = { order: string[]; deferred: Record<string, string[]> };

/**
 * The order to fill tables in, and the columns to leave empty on the first
 * pass and set on a second one.
 *
 * Foreign keys stay enforced on the cloud while it fills (only the sync
 * triggers are paused), so a row must arrive after the rows it points at.
 * Referenced tables go first. A column that points into its own table
 * (items.parent_id, items.next_action_task_id) or around a cycle cannot be
 * ordered row by row, so it is "deferred": sent empty, then filled in once every
 * row exists. Deterministic (alphabetical among equals) so a resumed fill takes
 * the same path.
 */
export function planFill(tables: string[], fks: ForeignKey[]): FillPlan {
  const set = new Set(tables);
  const remaining = [...tables].sort();
  const placed = new Set<string>();
  const order: string[] = [];
  const deferred: Record<string, string[]> = {};
  const defer = (t: string, col: string) => {
    const list = (deferred[t] ??= []);
    if (!list.includes(col)) list.push(col);
  };
  for (const fk of fks) if (set.has(fk.tbl) && fk.tbl === fk.ref) defer(fk.tbl, fk.col);
  const blockers = (t: string) =>
    fks.filter((fk) => fk.tbl === t && fk.ref !== t && set.has(fk.ref) && !placed.has(fk.ref));
  while (remaining.length > 0) {
    let i = remaining.findIndex((t) => blockers(t).length === 0);
    if (i < 0) {
      // A cycle between tables: break it at the first table by deferring the
      // columns that still point at unplaced ones.
      i = 0;
      for (const fk of blockers(remaining[0])) defer(fk.tbl, fk.col);
    }
    const [t] = remaining.splice(i, 1);
    placed.add(t);
    order.push(t);
  }
  for (const cols of Object.values(deferred)) cols.sort();
  return { order, deferred };
}

// ── Chunking for a 60-second, 4.5 MB request ────────────────────────────────

/**
 * Vercel refuses a request body over 4.5 MB, so a chunk stays well under it
 * (the rows travel inside a JSON string, which escapes quotes). A row bigger
 * than this on its own (an imported book) is sent in pieces and assembled on
 * the cloud before it is written.
 */
export const CHUNK_BYTES = 1_500_000;
export const CHUNK_ROWS = 500;

export type Packed = { kind: "rows"; rows: string[] } | { kind: "big"; row: string };

/** Group JSON rows into request-sized chunks, in order; oversize rows go alone. */
export function packRows(rows: string[], maxBytes = CHUNK_BYTES, maxRows = CHUNK_ROWS): Packed[] {
  const out: Packed[] = [];
  let cur: string[] = [];
  let bytes = 0;
  const flush = () => {
    if (cur.length) out.push({ kind: "rows", rows: cur });
    cur = [];
    bytes = 0;
  };
  for (const r of rows) {
    const n = Buffer.byteLength(r, "utf8");
    if (n > maxBytes) {
      flush();
      out.push({ kind: "big", row: r });
      continue;
    }
    if (cur.length > 0 && (bytes + n > maxBytes || cur.length >= maxRows)) flush();
    cur.push(r);
    bytes += n;
  }
  flush();
  return out;
}

/** Split a string into pieces of at most `size` UTF-8 bytes, never mid-character. */
export function splitBytes(text: string, size = CHUNK_BYTES): string[] {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of text) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > size && cur) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  if (cur || out.length === 0) out.push(cur);
  return out;
}

// ── Will it fit? ────────────────────────────────────────────────────────────

/** Neon's free plan: 0.5 GB of storage per project. */
export const NEON_FREE_BYTES = 512 * 1024 * 1024;

/**
 * Refuse, in plain words, a fill that would not fit a free Neon database. The
 * hub's figure counts indexes and not-yet-reclaimed space, so it overestimates,
 * which is the safe direction. Only applies when the cloud copy is on Neon and
 * the owner has not said their plan is bigger.
 */
export function fitRefusal(opts: {
  hubBytes: number;
  cloudBytes: number;
  cloudOnNeon: boolean;
  biggerPlan: boolean;
}): string | null {
  if (!opts.cloudOnNeon || opts.biggerPlan) return null;
  const need = opts.hubBytes + opts.cloudBytes;
  if (need <= NEON_FREE_BYTES * 0.9) return null;
  return (
    `Your Ledgr data takes about ${mb(opts.hubBytes)}, and a free Neon database holds ${mb(NEON_FREE_BYTES)}, ` +
    `so it would not fit with room to grow. Nothing was copied. If your cloud database is on a bigger plan, ` +
    `tick "My cloud database has more room" and try again.`
  );
}

export function mb(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes < 1024 * 1024) return "under 1 MB";
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// ── The hub's side of the story ─────────────────────────────────────────────

/**
 * The cloud copy's address as typed: an https origin. Plain http only for this
 * machine itself, which is how the two-install test rig runs.
 */
export function normalizeCloudUrl(raw: unknown): { url: string } | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { error: "Paste the web address of your cloud copy." };
  let u: URL;
  try {
    u = new URL(raw.trim().includes("://") ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return { error: "That isn't a web address. It looks like https://your-ledgr.vercel.app" };
  }
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) {
    return { error: "The address has to start with https://, so your data travels encrypted." };
  }
  return { url: u.origin };
}

/**
 * Pairing names this hub for every scheduled job nobody has named yet, and
 * leaves every choice the owner already made alone. Unset means "the cloud
 * copy runs it" (ADR-225), which for a hub-first owner is the wrong machine:
 * the data, the files and the job's own bookkeeping all live on the hub. The
 * default itself is untouched, so no existing install changes.
 */
export function claimUnsetJobs<C>(
  owners: Partial<Record<string, C | null>>,
  jobs: readonly string[],
  claim: C
): { next: Partial<Record<string, C | null>>; moved: string[] } {
  const next = { ...owners };
  const moved: string[] = [];
  for (const job of jobs) {
    if (Object.hasOwn(owners, job)) continue;
    next[job] = claim;
    moved.push(job);
  }
  return { next, moved };
}

/** The hub's pairing record, in its own job_state. Holds the device token. */
export type HubPairState = {
  url: string;
  code: string;
  status: "waiting" | "filling" | "done" | "failed";
  startedAt: string;
  usePublicUrl: boolean;
  deviceToken?: string;
  deviceId?: string;
  // The oplog position the fill covers. Changes after it go by ordinary sync.
  startSeq?: number;
  progress?: { table: string; tables: number; done: number; rows: number };
  filesNote?: string | null;
  // Said on screen: which scheduled jobs pairing moved to this hub, and whether
  // it set the public address.
  movedJobs?: string[];
  publicUrlSet?: boolean;
  signIn?: string | null;
  error?: string | null;
  finishedAt?: string;
};

/** What the owner's page sees: never the device token. */
export function publicHubPairState(s: HubPairState | null) {
  if (!s) return null;
  return {
    url: s.url,
    code: s.status === "waiting" ? formatPairingCode(s.code) : null,
    status: s.status,
    startedAt: s.startedAt,
    progress: s.progress ?? null,
    filesNote: s.filesNote ?? null,
    movedJobs: s.movedJobs ?? [],
    publicUrlSet: s.publicUrlSet ?? false,
    signIn: s.signIn ?? null,
    error: s.error ?? null,
    finishedAt: s.finishedAt ?? null,
  };
}

/**
 * Where the fill's coverage starts in the hub's oplog. Deliberately a few
 * minutes BEFORE the snapshot: an op number is taken before its transaction
 * commits, so a slow write in flight at snapshot time can hold a lower number
 * than ones already visible. Sending some changes the copy already has is
 * harmless (they apply in order and end where the hub is); missing one is not.
 */
export const START_SEQ_MARGIN_MINUTES = 5;
