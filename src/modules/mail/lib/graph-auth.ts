// The mail module's own Microsoft sign-in. A separate Azure app registration
// from the shared GRAPH_* one, because this one can SEND mail and WRITE the
// calendar (Mail.ReadWrite, Mail.Send, Calendars.ReadWrite,
// MailboxSettings.ReadWrite), and those rights must exist only on the hub.
// The shared registration's env vars also live on Vercel; these never do.
// Same Application Access Policy as the shared one: Brandon's mailbox only
// (runbook §1w).
import type { GraphCredentials } from "@/modules/microsoft/lib/client";
import { getGraphMailboxUpn } from "@/modules/microsoft/lib/client";
import { readMailStore } from "./store";

export function getMailGraphCredentials(): GraphCredentials | null {
  const saved = readMailStore().microsoft;
  const clientId = process.env.MAIL_GRAPH_CLIENT_ID || saved?.clientId;
  const clientSecret = process.env.MAIL_GRAPH_CLIENT_SECRET || saved?.clientSecret;
  const tenantId =
    process.env.MAIL_GRAPH_TENANT_ID || saved?.tenantId || process.env.GRAPH_TENANT_ID;
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

export function getMailUpn(): string | null {
  return process.env.MAIL_GRAPH_UPN || getGraphMailboxUpn();
}
