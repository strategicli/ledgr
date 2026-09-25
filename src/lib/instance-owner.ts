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
import { getDb } from "@/db";
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
