// Phase 2 (reading): what the mail screens ask the server for. Provider-neutral
// on top of the action list; the combined inbox and the cid-image swap live
// here so neither provider has to know about the other or about the screen.
import { getGmail } from "./gmail";
import { getMicrosoftMail } from "./microsoft";
import type { AccountId, FullMessage, MailFolder, MailProvider, MessageSummary } from "./types";
import { MailProviderError } from "./types";
import { isTextSearch, parseMailQuery, type MailQuery } from "./search";

export const ACCOUNTS: AccountId[] = ["microsoft", "gmail"];

export function isAccount(v: unknown): v is AccountId {
  return v === "microsoft" || v === "gmail";
}

export function provider(account: AccountId): MailProvider {
  const p = account === "microsoft" ? getMicrosoftMail() : getGmail();
  if (!p) throw new MailProviderError(`${account === "microsoft" ? "Outlook" : "Gmail"} is not connected`, "not_configured");
  return p;
}

export function connectedAccounts(): AccountId[] {
  return ACCOUNTS.filter((a) => (a === "microsoft" ? getMicrosoftMail() : getGmail()) !== null);
}

export async function listFolders(account: AccountId): Promise<MailFolder[]> {
  return provider(account).listFolders();
}

// The combined view's page token carries one token per account; an account
// whose list has run out is simply absent from it.
type CombinedToken = Partial<Record<AccountId, string>>;

function encodeToken(t: CombinedToken): string | null {
  return Object.keys(t).length ? Buffer.from(JSON.stringify(t)).toString("base64url") : null;
}

function decodeToken(s: string | undefined): CombinedToken | null {
  if (!s) return null;
  try {
    const t = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as unknown;
    if (!t || typeof t !== "object") return null;
    const out: CombinedToken = {};
    for (const a of ACCOUNTS) {
      const v = (t as Record<string, unknown>)[a];
      if (typeof v === "string") out[a] = v;
    }
    return out;
  } catch {
    return null;
  }
}

export type ListRequest = {
  account: AccountId | "all";
  // A folder id for one account; for "all", a role ("inbox" by default).
  folder?: string;
  // What the owner typed, in the search.ts language.
  search?: string;
  // The list chips: narrow the folder on screen without searching words.
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
  filesOnly?: boolean;
  pageToken?: string;
  limit?: number;
};

export type ListResult = {
  messages: MessageSummary[];
  nextPageToken: string | null;
  // Accounts that failed in a combined view; the rest still show.
  errors: { account: AccountId; error: string }[];
  // True when the words searched the whole mailbox rather than the folder.
  searchedAll?: boolean;
};

// Each provider's fixed name for a role, so the combined view never has to
// list folders first: Graph's well-known folder names, Gmail's system labels
// (ARCHIVE is gmail.ts's synthetic "not in any system box" folder).
const ROLE_IDS: Record<AccountId, Record<string, string>> = {
  microsoft: { inbox: "inbox", sent: "sentitems", drafts: "drafts", trash: "deleteditems", spam: "junkemail", archive: "archive" },
  gmail: { inbox: "INBOX", sent: "SENT", drafts: "DRAFT", trash: "TRASH", spam: "SPAM", archive: "ARCHIVE" },
};

export function queryFor(req: Pick<ListRequest, "search" | "unreadOnly" | "flaggedOnly" | "filesOnly">): MailQuery {
  const q = parseMailQuery(req.search ?? "");
  if (req.unreadOnly) q.unread = true;
  if (req.flaggedOnly) q.flagged = true;
  if (req.filesOnly) q.hasAttachment = true;
  return q;
}

// Where one account looks: an in: operator wins, typed words search the whole
// mailbox (as Gmail does), otherwise the folder on screen. For the combined
// view `folder` is a role; for one account it is that account's folder id.
function folderFor(a: AccountId, req: ListRequest, q: MailQuery): string | undefined {
  if (q.in) return ROLE_IDS[a][q.in];
  if (isTextSearch(q)) return undefined;
  return req.account === "all" ? ROLE_IDS[a][req.folder ?? "inbox"] : req.folder;
}

const newestFirst = (x: MessageSummary, y: MessageSummary) => (y.receivedAt ?? "").localeCompare(x.receivedAt ?? "");

export async function listMessages(req: ListRequest): Promise<ListResult> {
  const limit = Math.min(Math.max(req.limit ?? 50, 1), 100);
  const query = queryFor(req);
  const searchedAll = isTextSearch(query) && !query.in;
  if (req.account !== "all") {
    const page = await provider(req.account).listMessages({
      folderId: folderFor(req.account, req, query),
      query,
      pageToken: req.pageToken,
      limit,
    });
    // Outlook returns word searches by relevance; the list is always by date.
    return { ...page, messages: [...page.messages].sort(newestFirst), errors: [], searchedAll };
  }

  // Combined: each connected account's folder with the same role, merged
  // newest first. Each account fetches a full page, so the merged page can be
  // up to twice `limit`; the next token resumes each account where it stopped.
  // ponytail: no cross-account cursor trimming, so pages vary in size.
  const prior = decodeToken(req.pageToken);
  const accounts = connectedAccounts().filter((a) => !prior || prior[a] !== undefined);
  const next: CombinedToken = {};
  const errors: ListResult["errors"] = [];
  const pages = await Promise.all(
    accounts.map(async (a) => {
      try {
        const folderId = folderFor(a, req, query);
        if (!searchedAll && !folderId) return [];
        const page = await provider(a).listMessages({ folderId, query, pageToken: prior?.[a], limit });
        if (page.nextPageToken) next[a] = page.nextPageToken;
        return page.messages;
      } catch (err) {
        errors.push({ account: a, error: err instanceof Error ? err.message : String(err) });
        return [];
      }
    })
  );
  return { messages: pages.flat().sort(newestFirst), nextPageToken: encodeToken(next), errors, searchedAll };
}

// Picture types the viewer will show inline (safe-html's data: allow-list).
const INLINE_TYPES = /^image\/(png|gif|jpe?g|webp)$/i;
// Above this, inline pictures are left out rather than bloat the page.
const INLINE_BUDGET = 8 * 1024 * 1024;

// Replace src="cid:…" with the picture itself as a data: URL, so the sandboxed
// viewer never needs to fetch anything. Unknown or oversized cids are left as
// they are and simply don't render.
export function swapInlineImages(html: string, images: { contentId: string; contentType: string; base64: string }[]): string {
  let budget = INLINE_BUDGET;
  const byCid = new Map<string, string>();
  for (const img of images) {
    if (!INLINE_TYPES.test(img.contentType) || img.base64.length > budget) continue;
    budget -= img.base64.length;
    byCid.set(img.contentId.toLowerCase(), `data:${img.contentType.toLowerCase()};base64,${img.base64}`);
  }
  if (byCid.size === 0) return html;
  return html.replace(/(["'])cid:([^"']+)\1/gi, (whole, q: string, cid: string) => {
    const data = byCid.get(cid.trim().toLowerCase());
    return data ? `${q}${data}${q}` : whole;
  });
}

async function withInlineImages(p: MailProvider, m: FullMessage): Promise<FullMessage> {
  if (!m.bodyHtml || !/cid:/i.test(m.bodyHtml)) return m;
  const images = await p.getInlineImages(m.id);
  return { ...m, bodyHtml: swapInlineImages(m.bodyHtml, images) };
}

export async function readMessage(account: AccountId, id: string): Promise<FullMessage> {
  const p = provider(account);
  return withInlineImages(p, await p.getMessage(id));
}

export async function readThread(account: AccountId, threadId: string): Promise<FullMessage[]> {
  const p = provider(account);
  const messages = await p.getThread(threadId);
  return Promise.all(messages.map((m) => withInlineImages(p, m)));
}
