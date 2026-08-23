// The impure thin layer around engine.ts: gather local state, run the pure
// merge, execute the resulting actions. Deliberately raw SQL throughout —
// rows travel as Postgres jsonb (to_jsonb, snake_case) so the engine compares
// like with like, and the executor never needs a per-table drizzle mapping.
import { sql, type SQL } from "drizzle-orm";
import { getDb, dbSupportsTransactions } from "@/db";
import {
  mergeOps,
  SYNCED_TABLES,
  stableStringify,
  type LocalRow,
  type LocalState,
  type SyncOp,
  type WriteAction,
} from "./engine";
import { replacePassageRefs } from "@/lib/passages/refs";

// The minimal db surface apply needs; both drizzle drivers satisfy it, and the
// verify suite passes its own node-postgres instances for the two-DB tier.
export type SyncDb = {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
  transaction<T>(fn: (tx: SyncDb) => Promise<T>): Promise<T>;
};

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): ReturnType<typeof sql.identifier> {
  if (!IDENT.test(name)) throw new Error(`sync: refusing identifier "${name}"`);
  return sql.identifier(name);
}

// jsonb columns arrive as JS objects/arrays; stringify them so the pg driver
// doesn't render a JS array as a Postgres array literal. Scalars pass through
// and Postgres coerces the unknown-typed param from the column context.
function bind(value: unknown): unknown {
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

// uuid[] params as an explicit Postgres array literal — drizzle's sql template
// doesn't reliably map a JS array param across both drivers. Values are
// validated uuids, so the literal is injection-safe.
const UUID = /^[0-9a-f-]{36}$/i;
function uuidArray(ids: string[]): string {
  for (const id of ids) {
    if (!UUID.test(id)) throw new Error(`sync: refusing non-uuid id "${id}"`);
  }
  return `{${ids.join(",")}}`;
}

async function readLocalState(db: SyncDb, ops: SyncOp[]): Promise<LocalState> {
  const owners = await db.execute(sql`select id from users`);
  const state: LocalState = {
    ownerIds: new Set(owners.rows.map((r) => String(r.id))),
    rows: new Map(),
    relationByKey: new Map(),
  };

  // Group the batch's row ids per table.
  const byTbl = new Map<string, Set<string>>();
  for (const op of ops) {
    if (!SYNCED_TABLES[op.tbl]) continue;
    let set = byTbl.get(op.tbl);
    if (!set) byTbl.set(op.tbl, (set = new Set()));
    set.add(op.rowId);
  }

  for (const [tbl, idSet] of byTbl) {
    const ids = [...idSet];
    // Current rows, rendered as jsonb so they match op.changed byte-for-byte.
    // `types` has a text pk; its ops carry the md5-derived rowId the trigger
    // writes, so the lookup recomputes it in SQL.
    const rows =
      tbl === "types"
        ? await db.execute(
            sql`select md5('types:' || t.key)::uuid::text as row_id, to_jsonb(t) as row
                from types t where md5('types:' || t.key)::uuid = any(${uuidArray(ids)}::uuid[])`
          )
        : await db.execute(
            sql`select t.id::text as row_id, to_jsonb(t) - 'search' as row
                from ${ident(tbl)} t where t.id = any(${uuidArray(ids)}::uuid[])`
          );
    for (const r of rows.rows) {
      state.rows.set(`${tbl}:${r.row_id}`, {
        row: r.row as Record<string, unknown>,
        fields: {},
      });
    }
    for (const id of ids) {
      const key = `${tbl}:${id}`;
      if (!state.rows.has(key)) state.rows.set(key, { row: null, fields: {} });
    }

    // Per-field stamps from the local oplog: the latest local write per field
    // (origin device when that write was itself an applied foreign op).
    // ponytail: scans every op for the touched rows; bounded once the
    // retention prune lands (phase 3), fine for v1 batch sizes.
    const stamps = await db.execute(
      sql`select to_jsonb(o) as op from sync_ops o
          where o.tbl = ${tbl} and o.row_id = any(${uuidArray(ids)}::uuid[]) order by o.seq`
    );
    for (const s of stamps.rows) {
      const o = s.op as {
        row_id: string;
        at: string;
        device_id: string;
        origin_device_id: string | null;
        kind: string;
        changed: Record<string, unknown>;
      };
      const local = state.rows.get(`${tbl}:${o.row_id}`);
      if (!local) continue;
      const stamp = { at: o.at, deviceId: o.origin_device_id ?? o.device_id };
      for (const f of Object.keys(o.changed)) local.fields[f] = stamp;
    }
  }

  // relations set membership: resolve the natural keys the batch touches.
  const relOps = ops.filter((o) => o.tbl === "relations");
  if (relOps.length > 0) {
    const srcIds = [
      ...new Set(
        relOps
          .map((o) => o.changed.source_id)
          .filter((v): v is string => typeof v === "string")
      ),
    ];
    if (srcIds.length > 0) {
      const rels = await db.execute(
        sql`select to_jsonb(r) as row from relations r where r.source_id = any(${uuidArray(srcIds)}::uuid[])`
      );
      for (const r of rels.rows) {
        const row = r.row as Record<string, unknown>;
        state.relationByKey.set(`${row.source_id}|${row.target_id}|${row.role}`, String(row.id));
        const key = `relations:${row.id}`;
        const existing = state.rows.get(key);
        state.rows.set(key, { row, fields: existing?.fields ?? {} });
      }
    }
  }

  // Bodies already snapshotted, so a losing body never lands in revisions twice.
  const bodyItemIds = [
    ...new Set(ops.filter((o) => o.tbl === "items" && "body" in o.changed).map((o) => o.rowId)),
  ];
  if (bodyItemIds.length > 0) {
    const revs = await db.execute(
      sql`select item_id::text as item_id, body from revisions where item_id = any(${uuidArray(bodyItemIds)}::uuid[])`
    );
    const byItem = new Map<string, string[]>();
    for (const r of revs.rows) {
      const list = byItem.get(String(r.item_id)) ?? [];
      list.push(stableStringify(r.body));
      byItem.set(String(r.item_id), list);
    }
    for (const [itemId, bodies] of byItem) {
      const local = state.rows.get(`items:${itemId}`);
      if (local) (local as LocalRow).revisionBodies = bodies;
    }
  }

  return state;
}

async function runAction(db: SyncDb, action: WriteAction): Promise<void> {
  if (action.kind === "insert") {
    const cols = Object.keys(action.row);
    await db.execute(
      sql`insert into ${ident(action.tbl)} (${sql.join(cols.map(ident), sql`, `)})
          values (${sql.join(
            cols.map((c) => sql`${bind(action.row[c])}`),
            sql`, `
          )})
          on conflict do nothing`
    );
    return;
  }
  if (action.kind === "update") {
    const sets = Object.entries(action.fields).map(
      ([c, v]) => sql`${ident(c)} = ${bind(v)}`
    );
    await db.execute(
      sql`update ${ident(action.tbl)} set ${sql.join(sets, sql`, `)}
          where ${ident(action.pkCol)} = ${action.pkVal}`
    );
    return;
  }
  if (action.kind === "delete") {
    await db.execute(
      sql`delete from ${ident(action.tbl)} where ${ident(action.pkCol)} = ${action.pkVal}`
    );
    return;
  }
  // snapshot_revision: the losing side of a body conflict, forced into the
  // same revisions safety net every ordinary save uses.
  await db.execute(
    sql`insert into revisions (item_id, body) values (${action.itemId}, ${bind(action.body)})`
  );
}

/**
 * The item + body an action wrote, when the write could change that item's
 * passage edges: an insert carrying a body, or an update whose merged fields
 * include one. Anything else (a soft-delete stamp, a title edit, a non-items
 * table) yields null, so a 500-op batch only derives for the bodies in it.
 *
 * `fields` and `row` already hold the MERGED winning values, so the derived
 * edges match what the row will actually contain and no re-read is needed.
 */
export function passageBodyFromAction(
  action: WriteAction
): { itemId: string; body: unknown } | null {
  if (action.kind === "insert" && action.tbl === "items" && action.row.body != null) {
    return { itemId: String(action.row.id), body: action.row.body };
  }
  if (action.kind === "update" && action.tbl === "items" && "body" in action.fields) {
    return { itemId: action.pkVal, body: action.fields.body };
  }
  return null;
}

export type ApplyResult = { actions: number; rejected: number };

/**
 * Merge + execute a batch of foreign ops. On drivers with sessions
 * (node-postgres) the whole batch runs in one transaction and each action
 * SET LOCALs the ledgr.sync_origin GUC to the op's ORIGINAL writer, so the
 * oplog triggers stamp origin_device_id and push can exclude echoes. On
 * neon-http (no session) the GUC is skipped; the triggers' IS DISTINCT FROM
 * guards plus value-diff-only actions terminate the echo after one round.
 */
export async function applySyncOps(
  ops: SyncOp[],
  opts: { db?: SyncDb; transactions?: boolean } = {}
): Promise<ApplyResult> {
  const db = opts.db ?? (getDb() as unknown as SyncDb);
  const useTx = opts.transactions ?? (opts.db ? false : dbSupportsTransactions());

  const state = await readLocalState(db, ops);
  const { actions, rejected } = mergeOps(ops, state);
  if (actions.length === 0) return { actions: 0, rejected: rejected.length };

  if (useTx) {
    await db.transaction(async (tx) => {
      let origin: string | null = null;
      for (const action of actions) {
        if (action.origin !== origin) {
          origin = action.origin;
          await tx.execute(sql`select set_config('ledgr.sync_origin', ${origin}, true)`);
        }
        await runAction(tx, action);
        // Derived data the row write cannot carry: passage_refs is outside
        // ADR-206's synced set and has no trigger, so a body arriving here
        // must rebuild its own edges or the peer's passage index silently
        // freezes. Inside the transaction, so the two commit together.
        const derived = passageBodyFromAction(action);
        if (derived) await replacePassageRefs(tx, derived.itemId, derived.body);
      }
    });
  } else {
    for (const action of actions) {
      await runAction(db, action);
      const derived = passageBodyFromAction(action);
      if (derived) await replacePassageRefs(db, derived.itemId, derived.body);
    }
  }
  return { actions: actions.length, rejected: rejected.length };
}
