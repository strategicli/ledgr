// The mail module's Microsoft sign-in.
//
// Until sending arrives (phase 5), Outlook borrows Ledgr's shared GRAPH_*
// connection: it can already read, move and flag mail (Mail.ReadWrite) and
// read the calendar. That connection's secret also lives on Vercel, so it
// must never gain the right to send or change the calendar.
//
// Sending and calendar changes need the module's OWN app registration
// (Mail.ReadWrite, Mail.Send, Calendars.ReadWrite, MailboxSettings.ReadWrite),
// set up only on the hub (runbook §1w). When it is set up it is used for
// everything; when it is not, the providers refuse those actions themselves
// (microsoft.ts needOwnApp) rather than lean on Microsoft saying no.
import type { GraphCredentials } from "@/modules/microsoft/lib/client";
import { getGraphCredentials, getGraphMailboxUpn } from "@/modules/microsoft/lib/client";
import { readMailStore } from "./store";

// The module's own app, or null when it isn't set up.
export function getMailGraphCredentials(): GraphCredentials | null {
  const saved = readMailStore().microsoft;
  const clientId = process.env.MAIL_GRAPH_CLIENT_ID || saved?.clientId;
  const clientSecret = process.env.MAIL_GRAPH_CLIENT_SECRET || saved?.clientSecret;
  const tenantId =
    process.env.MAIL_GRAPH_TENANT_ID || saved?.tenantId || process.env.GRAPH_TENANT_ID;
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

// What Outlook actually signs in with: the own app when present, else the
// shared connection (read and file only).
export function getMailGraphConnection(): { creds: GraphCredentials; ownApp: boolean } | null {
  const own = getMailGraphCredentials();
  if (own) return { creds: own, ownApp: true };
  const shared = getGraphCredentials();
  return shared ? { creds: shared, ownApp: false } : null;
}

export function getMailUpn(): string | null {
  return process.env.MAIL_GRAPH_UPN || getGraphMailboxUpn();
}
