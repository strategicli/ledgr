// Phase 3 (acting): archive, delete, move, read state, flags and tags, for a
// selection that may mix both accounts (the combined inbox). Delete is always
// "move to trash", never permanent; every action here has an inverse the
// screen uses for Undo.
import { provider } from "./reading";
import type { AccountId } from "./types";

export type MailAction =
  | { kind: "read"; value: boolean }
  | { kind: "flag"; value: boolean }
  | { kind: "tags"; add: string[]; remove: string[] }
  | { kind: "move"; folderId: string }
  | { kind: "archive" }
  | { kind: "trash" }
  // Undo of trash; folderId is where the message was (Outlook needs it).
  | { kind: "restore"; folderId: string };

export type MailRef = { account: AccountId; id: string };

const MAX_ITEMS = 100;
const isStr = (v: unknown, max = 1024): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 50 && v.every((s) => isStr(s, 256));

// Trust boundary: the body of POST /api/mail/act. Returns null when malformed.
export function parseAct(body: unknown): { items: MailRef[]; action: MailAction } | null {
  if (!body || typeof body !== "object") return null;
  const { items, action } = body as { items?: unknown; action?: Record<string, unknown> };
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS || !action) return null;
  const refs: MailRef[] = [];
  for (const it of items) {
    const { account, id } = (it ?? {}) as { account?: unknown; id?: unknown };
    if ((account !== "microsoft" && account !== "gmail") || !isStr(id)) return null;
    refs.push({ account, id });
  }
  const a = action;
  switch (a.kind) {
    case "read":
    case "flag":
      return typeof a.value === "boolean" ? { items: refs, action: { kind: a.kind, value: a.value } } : null;
    case "tags":
      return strList(a.add) && strList(a.remove) ? { items: refs, action: { kind: "tags", add: a.add, remove: a.remove } } : null;
    case "move":
    case "restore":
      return isStr(a.folderId) ? { items: refs, action: { kind: a.kind, folderId: a.folderId } } : null;
    case "archive":
    case "trash":
      return { items: refs, action: { kind: a.kind } };
    default:
      return null;
  }
}

async function run(account: AccountId, ids: string[], a: MailAction): Promise<void> {
  const p = provider(account);
  switch (a.kind) {
    case "read":
      return p.modify(ids, { read: a.value });
    case "flag":
      return p.modify(ids, { flagged: a.value });
    case "tags":
      return p.modify(ids, { addTags: a.add, removeTags: a.remove });
    case "move":
      return p.move(ids, a.folderId);
    case "archive":
      return p.archive(ids);
    case "trash":
      return p.trash(ids);
    case "restore":
      return p.restore(ids, a.folderId);
  }
}

// One call per account; an account that fails doesn't stop the other.
export async function act(items: MailRef[], action: MailAction): Promise<{ account: AccountId; error: string }[]> {
  const byAccount = new Map<AccountId, string[]>();
  for (const { account, id } of items) byAccount.set(account, [...(byAccount.get(account) ?? []), id]);
  const errors: { account: AccountId; error: string }[] = [];
  await Promise.all(
    [...byAccount].map(async ([account, ids]) => {
      try {
        await run(account, ids, action);
      } catch (err) {
        errors.push({ account, error: err instanceof Error ? err.message : String(err) });
      }
    })
  );
  return errors;
}
