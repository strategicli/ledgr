// Where the mail module keeps its sign-ins: one JSON file in the hub's data
// folder (LEDGR_SUPERVISOR_DIR), beside install-secrets.json. Deliberately not
// the database: the database syncs to the cloud copy on Vercel, and the whole
// point of this module is that the right to read and send mail never leaves
// the hub. The file is written owner-only (0600) and atomically.
//
// Env vars, when set, win over the file (testing escape hatch). The owner's
// lever is the module's options at Build → Modules (ADR-222).
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type MailStore = {
  microsoft?: { tenantId?: string; clientId: string; clientSecret: string };
  google?: {
    clientId: string;
    clientSecret: string;
    // Set once the owner finishes Google's sign-in.
    refreshToken?: string;
    email?: string;
    // In flight between "Connect Gmail" and Google's redirect back.
    pending?: { state: string; verifier: string; redirectUri: string; at: number };
  };
};

function storePath(): string | null {
  const dir = process.env.LEDGR_SUPERVISOR_DIR;
  return dir ? join(dir, "mail-accounts.json") : null;
}

export function readMailStore(): MailStore {
  const p = storePath();
  if (!p) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as MailStore;
  } catch {
    return {};
  }
}

export function writeMailStore(next: MailStore): void {
  const p = storePath();
  if (!p) throw new Error("mail sign-ins can only be saved on the hub");
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, p);
}

export function updateMailStore(fn: (s: MailStore) => MailStore): MailStore {
  const next = fn(readMailStore());
  writeMailStore(next);
  return next;
}
