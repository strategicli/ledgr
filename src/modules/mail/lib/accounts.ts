// What the module's options show: which accounts are set up, and a live,
// read-only test of each (list the folders, count the inbox). Never returns a
// secret, only whether one is saved.
import { errorMessage } from "@/lib/log";
import { getMailGraphCredentials, getMailUpn } from "./graph-auth";
import { googleClient } from "./google-auth";
import { getGmail } from "./gmail";
import { getMicrosoftMail } from "./microsoft";
import { readMailStore } from "./store";
import type { MailProvider } from "./types";

export type AccountStatus = {
  microsoft: { configured: boolean; mailbox: string | null };
  gmail: { appConfigured: boolean; connected: boolean; email: string | null };
};

export function accountStatus(): AccountStatus {
  const g = readMailStore().google;
  return {
    microsoft: { configured: !!getMailGraphCredentials(), mailbox: getMailUpn() },
    gmail: { appConfigured: !!googleClient(), connected: !!g?.refreshToken, email: g?.email ?? null },
  };
}

export type AccountCheck = { ok: true; folders: number; inboxUnread: number } | { ok: false; error: string } | null;

async function check(p: MailProvider | null): Promise<AccountCheck> {
  if (!p) return null;
  try {
    const folders = await p.listFolders();
    return { ok: true, folders: folders.length, inboxUnread: folders.find((f) => f.role === "inbox")?.unread ?? 0 };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function checkAccounts(): Promise<{ microsoft: AccountCheck; gmail: AccountCheck }> {
  const [microsoft, gmail] = await Promise.all([check(getMicrosoftMail()), check(getGmail())]);
  return { microsoft, gmail };
}
