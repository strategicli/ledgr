// "Keep a copy in the cloud" (ADR-277): the CLOUD copy's door. Everything here
// runs on the fresh cloud copy, reached only by /setup (the owner typing the
// code) and /api/pair + /api/machine/pair/fill (the hub). The rules are pure, in pairing.ts;
// this file reads the facts, applies them, and writes.
//
// The fill writes with the sync triggers paused (ALTER TABLE … DISABLE TRIGGER
// USER inside the same transaction as the write), so the copied rows carry no
// change-log entries of their own. That matters: an entry stamped "now" on the
// cloud would make every edit the hub made while the fill ran look OLDER than
// the copy, and the merge would throw those edits away. Foreign keys stay
// enforced (constraint triggers are not USER triggers); pairing.ts orders the
// tables for them. Everything is one statement group per request, so each
// request fits the 60-second function limit and a failed one leaves nothing.
import { sql, type SQL } from "drizzle-orm";
import { dbSupportsTransactions, getDb } from "@/db";
import { jobState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isClerkConfigured } from "@/lib/auth/keyless";
import { setMethod } from "@/lib/auth/builtin-state";
import { installHasOwner } from "@/lib/instance-owner";
import { createPeer, setPeerRevoked } from "@/lib/sync/peers";
import { SYNCED_TABLES } from "@/lib/sync/engine";
import { latestSchemaVer } from "@/lib/sync/version";
import {
  claimDecision,
  CODE_TTL_MS,
  cloudUnclaimed,
  enterCodeRefusal,
  FILL_EXCLUDED,
  fillRefusal,
  hashPairingCode,
  normalizePairingCode,
  PAIRING_WINDOW_MS,
  pairingCodeShapeOk,
  pairingWindowOpen,
  parseCloudPairState,
  type CloudFacts,
  type CloudPairState,
  type FillStep,
} from "@/lib/sync/pairing";

const STATE_KEY = "pair:cloud";
const STAGE_KEY = "pair:stage";
const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string) {
  if (!IDENT.test(name)) throw new PairError(400, `refusing identifier "${name}"`);
  return sql.identifier(name);
}

export class PairError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Run statements as one transaction on either driver (claimFirstOwner's pattern). */
async function atomic(stmts: SQL[]): Promise<{ rows: Record<string, unknown>[] }[]> {
  const db = getDb();
  if (dbSupportsTransactions()) {
    return db.transaction(async (tx) => {
      const out: { rows: Record<string, unknown>[] }[] = [];
      for (const s of stmts) out.push((await tx.execute(s)) as { rows: Record<string, unknown>[] });
      return out;
    });
  }
  const res = await db.batch(stmts.map((s) => db.execute(s)) as [ReturnType<typeof db.execute>]);
  return res as unknown as { rows: Record<string, unknown>[] }[];
}

async function readState(): Promise<CloudPairState | null> {
  const rows = await getDb().select({ value: jobState.value }).from(jobState).where(eq(jobState.key, STATE_KEY));
  return parseCloudPairState(rows[0]?.value);
}

async function writeState(state: CloudPairState): Promise<void> {
  await getDb()
    .insert(jobState)
    .values({ key: STATE_KEY, value: state })
    .onConflictDoUpdate({ target: jobState.key, set: { value: state, updatedAt: new Date() } });
}

/** When this database was first migrated: the oldest system type's stamp. */
async function firstMigratedAt(): Promise<Date | null> {
  const res = await getDb().execute(sql`select min(created_at) as at from types`);
  const at = res.rows[0]?.at;
  return at ? new Date(String(at)) : null;
}

export async function cloudFacts(): Promise<CloudFacts & { firstMigratedAt: Date | null }> {
  const db = getDb();
  const [hasOwner, items, first, state] = await Promise.all([
    installHasOwner(),
    db.execute(sql`select 1 from items limit 1`),
    firstMigratedAt(),
    readState(),
  ]);
  return {
    hasOwner,
    hasItems: items.rows.length > 0,
    windowOpen: pairingWindowOpen({ firstMigratedAt: first, now: Date.now(), override: process.env.LEDGR_ALLOW_PAIRING }),
    preview: process.env.VERCEL_ENV === "preview",
    state,
    firstMigratedAt: first,
  };
}

/** What anyone may learn from GET /api/pair. Says nothing about a claimed copy. */
export async function cloudStatus() {
  const f = await cloudFacts();
  const base = { ledgr: true, schemaVer: latestSchemaVer() };
  if (!cloudUnclaimed(f) && f.state?.status !== "filling") return { ...base, unclaimed: false as const };
  const size = await getDb().execute(sql`select pg_database_size(current_database())::bigint as n`);
  return {
    ...base,
    unclaimed: cloudUnclaimed(f),
    windowOpen: f.windowOpen,
    windowEndsAt: f.firstMigratedAt ? new Date(f.firstMigratedAt.getTime() + PAIRING_WINDOW_MS).toISOString() : null,
    codeEntered: f.state?.status === "code" && Date.parse(f.state.expiresAt) > Date.now(),
    pairing: f.state && f.state.status !== "code" ? f.state.status : null,
    preview: f.preview,
    clerk: isClerkConfigured(),
    onNeon: /\.neon\.tech$/.test(safeHost(process.env.DATABASE_URL)),
    dbBytes: Number(size.rows[0]?.n ?? 0),
  };
}

function safeHost(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}

/** The owner typing the hub's code on this copy's /setup page. */
export async function enterPairingCode(raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const code = normalizePairingCode(raw);
  if (!pairingCodeShapeOk(code)) return { ok: false, error: "That doesn't look like a pairing code. It has 12 letters and numbers." };
  const refusal = enterCodeRefusal(await cloudFacts());
  if (refusal) return { ok: false, error: refusal };
  await writeState({
    status: "code",
    codeHash: hashPairingCode(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    attempts: 0,
  });
  return { ok: true };
}

/** The hub offering the code. On a match, mints its device token, exactly once. */
export async function claimPairing(rawCode: unknown, rawName: unknown): Promise<{ token: string; deviceId: string }> {
  const f = await cloudFacts();
  const d = claimDecision(f, normalizePairingCode(rawCode), Date.now());
  if (!d.ok) {
    if (d.wipe) await getDb().execute(sql`delete from job_state where key = ${STATE_KEY} and value->>'status' = 'code'`);
    else if (d.burn) {
      await getDb().execute(sql`
        update job_state set value = jsonb_set(value, '{attempts}', to_jsonb(coalesce((value->>'attempts')::int, 0) + 1)), updated_at = now()
        where key = ${STATE_KEY} and value->>'status' = 'code'`);
    }
    throw new PairError(d.status, d.error);
  }
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 60) : "Main copy";
  const peer = await createPeer(name, { pullOnly: false });
  // Compare-and-set on the very code that matched, so two claims racing with the
  // same code cannot both win: the loser's device row is removed again.
  const storedHash = f.state?.status === "code" ? f.state.codeHash : "";
  const paired: CloudPairState = { status: "paired", deviceId: peer.deviceId, at: new Date().toISOString() };
  const won = await getDb().execute(sql`
    update job_state set value = ${JSON.stringify(paired)}::jsonb, updated_at = now()
    where key = ${STATE_KEY} and value->>'status' = 'code' and value->>'codeHash' = ${storedHash}
    returning key`);
  if (won.rows.length === 0) {
    await setPeerRevoked(peer.deviceId, true);
    throw new PairError(409, "Another pairing got there first.");
  }
  return { token: peer.token, deviceId: peer.deviceId };
}

// ── The fill ────────────────────────────────────────────────────────────────

async function tableShape(table: string): Promise<{ cols: string[]; pk: string }> {
  const allowed = await getDb().execute(sql`
    select 1 from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name = ${table}`);
  if (allowed.rows.length === 0 || FILL_EXCLUDED.has(table)) throw new PairError(400, `"${table}" is not filled`);
  const cols = await getDb().execute(sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table} and is_generated <> 'ALWAYS'
    order by ordinal_position`);
  const pk = await getDb().execute(sql`
    select a.attname from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = ${`public.${table}`}::regclass and i.indisprimary`);
  if (pk.rows.length !== 1) throw new PairError(400, `"${table}" has no single-column key`);
  return { cols: cols.rows.map((r) => String(r.column_name)), pk: String(pk.rows[0].attname) };
}

/** Wrap a write so the sync triggers on this table are paused for it alone. */
function paused(table: string, write: SQL): SQL[] {
  if (!Object.hasOwn(SYNCED_TABLES, table)) return [write];
  return [
    sql`alter table ${ident(table)} disable trigger user`,
    write,
    sql`alter table ${ident(table)} enable trigger user`,
  ];
}

function source(rows: unknown[] | null): SQL {
  return rows
    ? sql`${JSON.stringify(rows)}::jsonb`
    : sql`(select jsonb_build_array((value #>> '{}')::jsonb) from job_state where key = ${STAGE_KEY})`;
}

async function upsertRows(table: string, rows: unknown[] | null): Promise<void> {
  const { cols, pk } = await tableShape(table);
  const list = sql.join(cols.map(ident), sql`, `);
  const others = cols.filter((c) => c !== pk);
  const onConflict = others.length
    ? sql`do update set ${sql.join(others.map((c) => sql`${ident(c)} = excluded.${ident(c)}`), sql`, `)}`
    : sql`do nothing`;
  const write = sql`insert into ${ident(table)} (${list})
    select ${list} from jsonb_populate_recordset(null::${ident(table)}, ${source(rows)})
    on conflict (${ident(pk)}) ${onConflict}`;
  await atomic(rows ? paused(table, write) : [...paused(table, write), sql`delete from job_state where key = ${STAGE_KEY}`]);
}

async function linkRows(table: string, linkCols: string[], rows: unknown[]): Promise<void> {
  const { cols, pk } = await tableShape(table);
  if (linkCols.length === 0 || linkCols.some((c) => !cols.includes(c) || c === pk)) {
    throw new PairError(400, "bad link columns");
  }
  const sets = sql.join(linkCols.map((c) => sql`${ident(c)} = r.${ident(c)}`), sql`, `);
  const write = sql`update ${ident(table)} set ${sets}
    from jsonb_populate_recordset(null::${ident(table)}, ${source(rows)}) r
    where ${ident(table)}.${ident(pk)} = r.${ident(pk)}`;
  await atomic(paused(table, write));
}

export type FillBody = {
  step?: FillStep;
  owner?: Record<string, unknown>;
  table?: string;
  rows?: unknown[];
  staged?: boolean;
  cols?: string[];
  piece?: string;
  first?: boolean;
};

/** One fill request from the paired hub. `deviceId` comes from its verified token. */
export async function runFillStep(deviceId: string, body: FillBody): Promise<Record<string, unknown>> {
  const step = body.step;
  if (!step || !["begin", "rows", "links", "stage", "finish", "cancel"].includes(step)) {
    throw new PairError(400, "unknown step");
  }
  const f = await cloudFacts();
  const refusal = fillRefusal(f, step, deviceId);
  if (refusal) throw new PairError(409, refusal);

  if (step === "cancel") {
    await setPeerRevoked(deviceId, true);
    await getDb().execute(sql`delete from job_state where key in (${STATE_KEY}, ${STAGE_KEY})`);
    return { ok: true };
  }

  if (step === "begin") {
    const owner = body.owner;
    if (!owner || typeof owner.id !== "string" || typeof owner.email !== "string") {
      throw new PairError(400, "the owner row is missing");
    }
    if (f.state?.status === "paired") {
      const moved = await getDb().execute(sql`
        update job_state set value = jsonb_set(value, '{status}', '"filling"'), updated_at = now()
        where key = ${STATE_KEY} and value->>'status' = 'paired' and value->>'deviceId' = ${deviceId}
        returning key`);
      if (moved.rows.length === 0) throw new PairError(409, "The pairing changed underneath this request.");
    } else {
      // A resumed fill: the only owner row it may meet is the one it wrote.
      const existing = await getDb().execute(sql`select id::text as id from users`);
      if (existing.rows.some((r) => r.id !== owner.id)) {
        throw new PairError(409, "This copy has a different owner, so it can't be filled.");
      }
    }
    await upsertRows("users", [owner]);
    return { ok: true };
  }

  const table = typeof body.table === "string" ? body.table : "";
  if (step === "stage") {
    if (typeof body.piece !== "string") throw new PairError(400, "piece is required");
    await getDb().execute(
      body.first
        ? sql`insert into job_state (key, value) values (${STAGE_KEY}, to_jsonb(${body.piece}::text))
              on conflict (key) do update set value = excluded.value, updated_at = now()`
        : sql`update job_state set value = to_jsonb((value #>> '{}') || ${body.piece}::text), updated_at = now()
              where key = ${STAGE_KEY}`
    );
    return { ok: true };
  }
  if (step === "rows") {
    // The owner row arrives only through `begin`, the one place that checks it.
    if (table === "users") throw new PairError(400, "the owner row is sent with begin");
    if (body.staged) await upsertRows(table, null);
    else if (Array.isArray(body.rows) && body.rows.length > 0) await upsertRows(table, body.rows);
    return { ok: true };
  }
  if (step === "links") {
    if (!Array.isArray(body.rows) || !Array.isArray(body.cols)) throw new PairError(400, "rows and cols are required");
    if (body.rows.length > 0) await linkRows(table, body.cols, body.rows);
    return { ok: true };
  }

  // finish: a hub whose owner has a password makes that the way in here, unless
  // this copy already signs in with Clerk (whose first sign-in then matches the
  // owner row that just arrived, by email).
  const pw = await getDb().execute(sql`select 1 from users where password_hash is not null limit 1`);
  let signIn: "password" | "clerk" | "none" = isClerkConfigured() ? "clerk" : "none";
  if (signIn === "none" && pw.rows.length > 0) {
    await setMethod("builtin");
    signIn = "password";
  }
  await writeState({ status: "done", deviceId, at: new Date().toISOString() });
  await getDb().execute(sql`delete from job_state where key = ${STAGE_KEY}`);
  return { ok: true, signIn };
}
