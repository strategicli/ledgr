// "Keep a copy in the cloud" (ADR-277): the HUB's side. The owner pastes the
// address of a fresh cloud copy on Build → Network, this hub shows a one-time
// code, the owner types it on the cloud's /setup page, and this hub then claims
// the pairing, fills the cloud copy with everything, and lists it as a copy it
// keeps in sync. The hub always calls the cloud; the cloud never calls back.
//
// The fill runs in the background of this long-lived process (a hub is never
// serverless), reading ONE consistent snapshot of the database: a read-only,
// repeatable-read transaction held for the whole copy. Without that, a link
// made mid-copy could arrive before the item it points at. Progress is kept in
// job_state so the page can show it; if the process stops mid-fill, the next
// look at the page starts it again from the top (every write on the cloud is an
// upsert, so a second pass is safe), keeping the ORIGINAL start point so no
// change made in between is skipped.
import { sql, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobState } from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { getSettings, updateSettings } from "@/lib/settings";
import { claimFor, MOVABLE_JOB_NAMES, MOVABLE_JOBS, type JobOwners } from "@/lib/job-owners";
import { installLabel } from "@/lib/job-owners-store";
import {
  readLocalDeviceId,
  readSyncHubs,
  requestCheckIn,
  writeCursor,
  writeSyncHubs,
} from "@/lib/sync/client";
import { latestSchemaVer } from "@/lib/sync/version";
import { createLogger, errorMessage } from "@/lib/log";
import {
  claimUnsetJobs,
  fillTables,
  fitRefusal,
  mb,
  newPairingCode,
  normalizeCloudUrl,
  packRows,
  planFill,
  publicHubPairState,
  splitBytes,
  START_SEQ_MARGIN_MINUTES,
  WINDOW_CLOSED,
  type ForeignKey,
  type HubPairState,
} from "@/lib/sync/pairing";

const log = createLogger("pairing-hub");
const STATE_KEY = "pair:hub";
// A cloud copy is contacted every 15 minutes, both ways. Not "only when there
// are changes" (ADR-252): this copy is where the phone falls back to when the
// hub is off, so edits made there must come back without waiting for the hub
// to have something to send, and the owner's "Check in now" must reach it. The
// cost is a free Neon database awake about a third of the time, inside its free
// compute. The owner can change both on the row's Settings. Share links do not
// wait for the schedule: minting or revoking one checks in at once (ADR-277).
const CLOUD_CADENCE_MINUTES = 15;
const PAGE = 500;
const PIECE_BYTES = 1_000_000;
const IDENT = /^[a-z_][a-z0-9_]*$/;

type Shared = { running: boolean };
const shared: Shared = ((globalThis as { __ledgrPairing?: Shared }).__ledgrPairing ??= { running: false });

async function readState(): Promise<HubPairState | null> {
  const rows = await getDb().select({ value: jobState.value }).from(jobState).where(eq(jobState.key, STATE_KEY));
  const v = rows[0]?.value as HubPairState | undefined;
  return v && typeof v.url === "string" ? v : null;
}

async function writeState(s: HubPairState): Promise<void> {
  await getDb()
    .insert(jobState)
    .values({ key: STATE_KEY, value: s })
    .onConflictDoUpdate({ target: jobState.key, set: { value: s, updatedAt: new Date() } });
}

async function patchState(patch: Partial<HubPairState>): Promise<HubPairState | null> {
  const s = await readState();
  if (!s) return null;
  const next = { ...s, ...patch };
  await writeState(next);
  return next;
}

// ── Talking to the cloud copy ───────────────────────────────────────────────

class CloudRefused extends Error {}

async function cloudJson(url: string, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, { ...init, signal: AbortSignal.timeout(75_000) });
  } catch (err) {
    throw new Error(`Could not reach ${url}: ${errorMessage(err)}`);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg = typeof body?.error === "string" ? body.error : `The cloud copy answered ${res.status}.`;
    // 4xx is the cloud saying no, on purpose; retrying will not change it.
    if (res.status < 500) throw new CloudRefused(msg);
    throw new Error(msg);
  }
  if (!body) throw new Error(`${url} did not answer like a copy of Ledgr.`);
  return body;
}

/** One fill request, retried on a network failure or a 5xx, never on a refusal. */
async function fillPost(s: HubPairState, body: string): Promise<Record<string, unknown>> {
  let last: unknown;
  for (const wait of [0, 2_000, 5_000, 15_000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      return await cloudJson(s.url, "/api/machine/pair/fill", {
        method: "POST",
        headers: { authorization: `Bearer ${s.deviceToken}`, "content-type": "application/json" },
        body,
      });
    } catch (err) {
      if (err instanceof CloudRefused) throw err;
      last = err;
    }
  }
  throw last;
}

// ── Reading this hub's own database ─────────────────────────────────────────

type Exec = { execute(q: ReturnType<typeof sql>): Promise<{ rows: Record<string, unknown>[] }> };

function ident(name: string) {
  if (!IDENT.test(name)) throw new Error(`refusing identifier "${name}"`);
  return sql.identifier(name);
}

async function publicTables(db: Exec): Promise<string[]> {
  const res = await db.execute(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);
  return res.rows.map((r) => String(r.table_name));
}

async function filesOnThisDisk(): Promise<boolean> {
  return getStorage()?.kind === "local";
}

async function tablesToFill(db: Exec): Promise<string[]> {
  return fillTables(await publicTables(db), { filesOnThisDisk: await filesOnThisDisk() });
}

async function foreignKeys(db: Exec): Promise<ForeignKey[]> {
  const res = await db.execute(sql`
    select c.conrelid::regclass::text as tbl, c.confrelid::regclass::text as ref, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace`);
  return res.rows.map((r) => ({ tbl: String(r.tbl), ref: String(r.ref), col: String(r.col) }));
}

async function primaryKey(db: Exec, table: string): Promise<string> {
  const res = await db.execute(sql`
    select a.attname from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = ${`public.${table}`}::regclass and i.indisprimary`);
  // ponytail: every table today has a single-column key; a composite one would
  // need keyset paging on the tuple. Refuse loudly rather than copy half of it.
  if (res.rows.length !== 1) throw new Error(`"${table}" has no single-column key, so it can't be copied yet.`);
  return String(res.rows[0].attname);
}

async function generatedColumns(db: Exec, table: string): Promise<string[]> {
  const res = await db.execute(sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table} and is_generated = 'ALWAYS'`);
  return res.rows.map((r) => String(r.column_name));
}

/** One page of a table as JSON text rows, keyset-paged by its key. */
async function page(
  db: Exec,
  table: string,
  pk: string,
  after: string | null,
  drop: string[],
  nulls: string[]
): Promise<{ rows: string[]; last: string | null }> {
  for (const c of [...drop, ...nulls]) ident(c);
  const dropLit = sql.raw(`'{${drop.join(",")}}'::text[]`);
  const nullObj = JSON.stringify(Object.fromEntries(nulls.map((c) => [c, null])));
  const t = ident(table);
  const k = ident(pk);
  const res = await db.execute(sql`
    select ((to_jsonb(t) - ${dropLit}) || ${nullObj}::jsonb)::text as r, t.${k}::text as k
    from ${t} t ${after === null ? sql`` : sql`where t.${k} > ${after}`}
    order by t.${k} limit ${PAGE}`);
  return {
    rows: res.rows.map((r) => String(r.r)),
    last: res.rows.length === PAGE ? String(res.rows[res.rows.length - 1].k) : null,
  };
}

// ── Starting a pairing ──────────────────────────────────────────────────────

export type StartResult = { ok: true; state: ReturnType<typeof publicHubPairState> } | { ok: false; error: string };

/** Check everything that can be checked before anyone types a code, then show one. */
export async function startPairing(opts: {
  url: unknown;
  biggerPlan?: boolean;
  usePublicUrl?: boolean;
}): Promise<StartResult> {
  const parsed = normalizeCloudUrl(opts.url);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const url = parsed.url;
  const current = await readState();
  if (current && current.status === "filling") {
    return { ok: false, error: "A copy is being filled right now. Wait for it to finish, or cancel it first." };
  }
  if ((await readSyncHubs()).some((h) => h.url === url)) {
    return { ok: false, error: "This computer already keeps that copy in sync." };
  }
  const db = getDb() as unknown as Exec;
  const owners = await db.execute(sql`select id::text as id, password_hash is not null as pw from users`);
  if (owners.rows.length !== 1) {
    return { ok: false, error: "This copy of Ledgr needs exactly one owner before it can be copied to the cloud." };
  }

  let cloud: Record<string, unknown>;
  try {
    cloud = await cloudJson(url, "/api/pair");
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  if (cloud.ledgr !== true) return { ok: false, error: `${url} did not answer like a copy of Ledgr.` };
  if (cloud.schemaVer !== latestSchemaVer()) {
    return {
      ok: false,
      error:
        "The cloud copy runs a different version of Ledgr from this computer. Update whichever is older " +
        "(this one from Build → Updates, the cloud one by redeploying it), then try again.",
    };
  }
  if (cloud.unclaimed !== true) {
    return {
      ok: false,
      error:
        "That copy already has an owner or data, so it can't be filled from here. Pairing only works with a " +
        "brand-new, empty copy. If you just made it and this is a surprise, someone may have reached it first: " +
        "delete that deployment and its database, and make a new one.",
    };
  }
  if (cloud.preview === true) return { ok: false, error: "That is a preview deployment. Use the production address." };
  if (cloud.windowOpen !== true) return { ok: false, error: WINDOW_CLOSED };
  if (owners.rows[0].pw !== true && cloud.clerk !== true) {
    return {
      ok: false,
      error:
        "The cloud copy needs a way for you to sign in, and this computer has no password to bring with it. " +
        "Set a sign-in password first (User Settings, Sign-in), then try again.",
    };
  }

  const tables = await tablesToFill(db);
  let hubBytes = 0;
  for (const t of tables) {
    const r = await db.execute(sql`select pg_total_relation_size(${`public.${t}`}::regclass)::bigint as n`);
    hubBytes += Number(r.rows[0]?.n ?? 0);
  }
  const refusal = fitRefusal({
    hubBytes,
    cloudBytes: Number(cloud.dbBytes ?? 0),
    cloudOnNeon: cloud.onNeon === true,
    biggerPlan: opts.biggerPlan === true,
  });
  if (refusal) return { ok: false, error: refusal };

  const state: HubPairState = {
    url,
    code: newPairingCode(),
    status: "waiting",
    startedAt: new Date().toISOString(),
    usePublicUrl: opts.usePublicUrl === true,
    filesNote: await filesNote(db),
  };
  await writeState(state);
  return { ok: true, state: publicHubPairState(state) };
}

/** Attachments that stay behind, said before anything is copied (ADR-277). */
async function filesNote(db: Exec): Promise<string | null> {
  const r = await db.execute(sql`select count(*)::int as n, coalesce(sum(size_bytes), 0)::bigint as b from attachments`);
  const n = Number(r.rows[0]?.n ?? 0);
  if (n === 0) return null;
  const what = `${n} ${n === 1 ? "file" : "files"} (${mb(Number(r.rows[0]?.b ?? 0))})`;
  if (await filesOnThisDisk()) {
    return (
      `${what} stay on this computer. The cloud copy gets everything else, but it can't open these: a picture ` +
      `or file inside an item shows as missing there, including on a share link. They are still here, and in ` +
      `this computer's restore points.`
    );
  }
  return `${what} live in your file storage bucket. The cloud copy can open them only if it has the same storage settings.`;
}

// ── Moving it along ─────────────────────────────────────────────────────────

/** Where the pairing is, moved on by one step when it can be. The page polls this. */
export async function advancePairing() {
  const s = await readState();
  if (!s) return null;
  if (s.status === "waiting") {
    try {
      const cloud = await cloudJson(s.url, "/api/pair");
      if (cloud.codeEntered === true) {
        const claimed = await cloudJson(s.url, "/api/pair", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: s.code, name: installLabel() }),
        });
        const next = await patchState({
          status: "filling",
          deviceToken: String(claimed.token),
          deviceId: String(claimed.deviceId),
          error: null,
        });
        if (next) kickRunner();
        return publicHubPairState(next);
      }
    } catch (err) {
      return publicHubPairState(await patchState({ error: errorMessage(err) }));
    }
    return publicHubPairState(s);
  }
  // A fill whose process stopped part way: start it again (idempotent).
  if (s.status === "filling" && !shared.running) kickRunner();
  return publicHubPairState(s);
}

/** "Try again" after a failed fill. */
export async function retryPairing() {
  const s = await readState();
  if (!s || s.status !== "failed" || !s.deviceToken) return publicHubPairState(s);
  const next = await patchState({ status: "filling", error: null });
  kickRunner();
  return publicHubPairState(next);
}

/** Stop and forget. A cloud copy that has not received its owner yet is released too. */
export async function cancelPairing(): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await readState();
  if (!s) return { ok: true };
  if (s.status === "done") return { ok: false, error: "That copy is already filled and listed. Remove it from the list instead." };
  if (s.status === "filling" && shared.running) return { ok: false, error: "Wait for the current step to finish, then cancel." };
  if (s.deviceToken) {
    await fillPost(s, JSON.stringify({ step: "cancel" })).catch(() => {});
  }
  await getDb().delete(jobState).where(eq(jobState.key, STATE_KEY));
  return { ok: true };
}

export async function pairingState() {
  return publicHubPairState(await readState());
}

/** Clear a finished pairing's note from the page. */
export async function dismissPairing(): Promise<void> {
  const s = await readState();
  if (s?.status === "done") await getDb().delete(jobState).where(eq(jobState.key, STATE_KEY));
}

// ── The fill ────────────────────────────────────────────────────────────────

function kickRunner(): void {
  if (shared.running) return;
  shared.running = true;
  void runFill()
    .catch(async (err) => {
      log.warn("cloud copy fill failed", { error: errorMessage(err) });
      await patchState({ status: "failed", error: errorMessage(err) }).catch(() => {});
    })
    .finally(() => {
      shared.running = false;
    });
}

/** Name this hub for every unnamed job, and offer the cloud's address for share links. */
async function prepareSettings(s: HubPairState, ownerId: string): Promise<Partial<HubPairState>> {
  const deviceId = await readLocalDeviceId();
  const settings = await getSettings(ownerId);
  const patch: Partial<HubPairState> = { movedJobs: s.movedJobs ?? [], publicUrlSet: s.publicUrlSet ?? false };
  if (deviceId) {
    const claim = claimFor({ deviceId, label: installLabel(), now: new Date() });
    const { next, moved } = claimUnsetJobs(settings.jobOwners, MOVABLE_JOB_NAMES, claim);
    if (moved.length > 0) {
      await updateSettings(ownerId, { jobOwners: next as JobOwners });
      patch.movedJobs = [...(patch.movedJobs ?? []), ...moved.map((j) => MOVABLE_JOBS[j as keyof typeof MOVABLE_JOBS].label)];
    }
  }
  if (s.usePublicUrl && !settings.publicUrl) {
    await updateSettings(ownerId, { publicUrl: s.url });
    patch.publicUrlSet = true;
  }
  return patch;
}

class Busy extends Error {}

async function runFill(): Promise<void> {
  let s = await readState();
  if (!s || s.status !== "filling" || !s.deviceToken) return;
  const owner = await getDb().execute(sql`select id::text as id from users`);
  if (owner.rows.length !== 1) throw new Error("This copy needs exactly one owner.");
  s = (await patchState(await prepareSettings(s, String(owner.rows[0].id)))) ?? s;

  const db = getDb();
  let signIn: string | null = null;
  let startSeq = s.startSeq;
  // A snapshot is only a clean start line when no write is in flight at that
  // instant; otherwise an op numbered below the line could still commit after
  // it. Try a few times, then fall back to a safe margin (pairing.ts).
  for (let attempt = 0; ; attempt++) {
    try {
      await db.transaction(
        async (tx) => {
          const x = tx as unknown as Exec;
          const snap = await x.execute(sql`
            select cardinality(array(select pg_snapshot_xip(pg_current_snapshot())))::int as busy,
                   coalesce((select max(seq) from sync_ops), 0)::bigint as head,
                   coalesce((select max(seq) from sync_ops
                             where at < now() - make_interval(mins => ${START_SEQ_MARGIN_MINUTES})), 0)::bigint as safe`);
          const busy = Number(snap.rows[0].busy) > 0;
          if (startSeq === undefined) {
            if (busy && attempt < 10) throw new Busy();
            startSeq = Number(busy ? snap.rows[0].safe : snap.rows[0].head);
            await patchState({ startSeq });
          }
          signIn = await copyEverything(x, s!);
        },
        { isolationLevel: "repeatable read", accessMode: "read only" }
      );
      break;
    } catch (err) {
      if (!(err instanceof Busy)) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // List the copy LAST, cursor first: the loop must never see the new copy with
  // a cursor at zero, or it would send every change this hub ever made.
  await writeCursor(s.url, { push: startSeq ?? 0, pull: 0 });
  const hubs = await readSyncHubs();
  if (!hubs.some((h) => h.url === s!.url)) {
    await writeSyncHubs([
      ...hubs,
      {
        url: s.url,
        token: s.deviceToken!,
        cadence: CLOUD_CADENCE_MINUTES,
        fallback: "automatic",
        onChange: false,
      },
    ]);
  }
  await patchState({ status: "done", signIn, finishedAt: new Date().toISOString(), error: null, progress: undefined });
  requestCheckIn();
  log.info("cloud copy filled and listed", { url: s.url, startSeq });
}

async function copyEverything(db: Exec, s: HubPairState): Promise<string | null> {
  const tables = await tablesToFill(db);
  const plan = planFill(tables, await foreignKeys(db));
  const progress = { table: "users", tables: plan.order.length, done: 0, rows: 0 };
  const tick = async (table: string, rows: number) => {
    progress.table = table;
    progress.rows += rows;
    await patchState({ progress: { ...progress } });
  };

  // The owner first, through the one step that checks the copy is empty.
  const ownerRow = await db.execute(sql`select to_jsonb(u)::text as r from users u`);
  await fillPost(s, `{"step":"begin","owner":${String(ownerRow.rows[0].r)}}`);
  await tick("users", 1);

  for (const table of plan.order) {
    progress.done += 1;
    if (table === "users") continue;
    const pk = await primaryKey(db, table);
    const drop = await generatedColumns(db, table);
    const deferred = plan.deferred[table] ?? [];
    let after: string | null = null;
    for (;;) {
      const p = await page(db, table, pk, after, drop, deferred);
      for (const chunk of packRows(p.rows)) {
        if (chunk.kind === "rows") {
          await fillPost(s, `{"step":"rows","table":${JSON.stringify(table)},"rows":[${chunk.rows.join(",")}]}`);
          await tick(table, chunk.rows.length);
        } else {
          // One row too big for a request on its own: sent in pieces, then written.
          const pieces = splitBytes(chunk.row, PIECE_BYTES);
          for (let i = 0; i < pieces.length; i++) {
            await fillPost(s, JSON.stringify({ step: "stage", first: i === 0, piece: pieces[i] }));
          }
          await fillPost(s, JSON.stringify({ step: "rows", table, staged: true }));
          await tick(table, 1);
        }
      }
      if (p.last === null) break;
      after = p.last;
    }
  }

  // Second pass: the columns that point within their own table.
  for (const [table, cols] of Object.entries(plan.deferred)) {
    const pk = await primaryKey(db, table);
    for (const c of [pk, ...cols]) ident(c);
    const pick = sql.raw(cols.map((c) => `'${c}', t."${c}"`).join(", "));
    const any = sql.raw(cols.map((c) => `t."${c}" is not null`).join(" or "));
    let after: string | null = null;
    for (;;) {
      const res = await db.execute(sql`
        select jsonb_build_object(${pk}::text, t.${ident(pk)}, ${pick})::text as r, t.${ident(pk)}::text as k
        from ${ident(table)} t where (${any}) ${after === null ? sql`` : sql`and t.${ident(pk)} > ${after}`}
        order by t.${ident(pk)} limit ${PAGE}`);
      const rows = res.rows.map((r) => String(r.r));
      for (const chunk of packRows(rows)) {
        const list = chunk.kind === "rows" ? chunk.rows : [chunk.row];
        await fillPost(
          s,
          `{"step":"links","table":${JSON.stringify(table)},"cols":${JSON.stringify(cols)},"rows":[${list.join(",")}]}`
        );
      }
      if (res.rows.length < PAGE) break;
      after = String(res.rows[res.rows.length - 1].k);
    }
  }

  const done = await fillPost(s, JSON.stringify({ step: "finish" }));
  return typeof done.signIn === "string" ? done.signIn : null;
}
