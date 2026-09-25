// The one "who is this install's owner?" lookup for every path with no
// signed-in person: the MCP server, the REST API, the scheduled jobs, the
// calendar, email-in, Todoist and push crons (ADR-274, Phase 0 of the sign-in
// plan). Before this, five resolvers each matched users.email EXACTLY against
// their own env chain, so changing the owner row's email silently broke MCP and
// the API (Tyler's instance, 2026-08-31, twice).
//
// The rule, in order:
//   1. the caller's preferred addresses (its own knob, e.g. LEDGR_MCP_OWNER_UPN),
//      then the shared ones (the export and mailbox UPNs, a local install's
//      LEDGR_LOCAL_OWNER_EMAIL, the dev stand-in), matched case-insensitively;
//   2. otherwise, when the install has exactly ONE users row, that row. A
//      single-owner install has only one possible answer, so a renamed email
//      can no longer strand it.
// More than one row and no address match is still "no owner": this never
// guesses between people.
import { sql } from "drizzle-orm";
import { dbSupportsTransactions, getDb } from "@/db";
import { users } from "@/db/schema";

export function pickInstanceOwner(
  rows: readonly { id: string; email: string }[],
  addresses: readonly (string | undefined | null)[]
): string | null {
  for (const a of addresses) {
    if (!a) continue;
    const want = a.trim().toLowerCase();
    const hit = rows.find((r) => r.email.toLowerCase() === want);
    if (hit) return hit.id;
  }
  return rows.length === 1 ? rows[0].id : null;
}

/** The shared address chain every surface falls back to after its own knob. */
export function sharedOwnerAddresses(): (string | undefined)[] {
  return [
    process.env.ONEDRIVE_EXPORT_UPN,
    process.env.GRAPH_MAILBOX_UPN,
    process.env.LEDGR_LOCAL_OWNER_EMAIL,
    process.env.DEV_USER_EMAIL,
  ];
}

export async function resolveInstanceOwner(
  preferred: readonly (string | undefined | null)[] = []
): Promise<string | null> {
  // The users table is one row per person on the install: reading it whole is
  // cheaper than a query per candidate address.
  const rows = await getDb().select({ id: users.id, email: users.email }).from(users);
  return pickInstanceOwner(rows, [...preferred, ...sharedOwnerAddresses()]);
}

// ── The first owner (ADR-275) ────────────────────────────────────────────────
//
// An install with NO users row has nobody to recognize, which used to be a dead
// end ("Signed in, but not recognized", ADR-184). Two doors now create the
// first row, each exactly once: the first Clerk sign-in on a Clerk install
// (src/lib/owner.ts), and the setup page at the machine (src/app/setup). Both
// go through claimFirstOwner, so they share the one race guard.

/** Does this install have an owner yet? Throws when the database can't be read. */
export async function installHasOwner(): Promise<boolean> {
  const rows = await getDb().select({ id: users.id }).from(users).limit(1);
  return rows.length > 0;
}

// Any fixed number serves; nothing else in Ledgr takes an advisory lock.
const FIRST_OWNER_LOCK = 274_275_001;

/**
 * Create the first users row, or do nothing when any row already exists.
 * Returns the new row, or null when someone else was first.
 *
 * Why a lock and not just "insert where the table is empty": in Postgres's
 * default isolation, two simultaneous requests can both see an empty table and
 * both insert. Here the lock is taken in its own statement, and the insert's
 * emptiness check runs in the NEXT statement, after the lock is held, so it
 * sees any row a previous holder committed. Two claims can never both succeed.
 * The lock ends with the transaction.
 */
export async function claimFirstOwner(
  email: string,
  clerkId: string | null
): Promise<{ id: string; email: string } | null> {
  const db = getDb();
  const lock = sql`select pg_advisory_xact_lock(${sql.raw(String(FIRST_OWNER_LOCK))})`;
  const insert = sql`
    insert into users (email, clerk_id)
    select ${email}, ${clerkId}
    where not exists (select 1 from users)
    returning id, email`;
  let rows: unknown[];
  if (dbSupportsTransactions()) {
    rows = await db.transaction(async (tx) => {
      await tx.execute(lock);
      return (await tx.execute(insert)).rows;
    });
  } else {
    // neon-http has no session, but a batch runs as ONE transaction, in order.
    const [, res] = await db.batch([db.execute(lock), db.execute(insert)]);
    rows = (res as { rows?: unknown[] }).rows ?? [];
  }
  const row = rows[0] as { id: string; email: string } | undefined;
  return row ? { id: row.id, email: row.email } : null;
}
