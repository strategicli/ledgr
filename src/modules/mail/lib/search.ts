// Mail search: one query language for both accounts. The owner types Gmail-style
// operators; this parses them once and translates to each provider, so a search
// means the same thing in Outlook, Gmail and the combined inbox. Pure: no
// network, no DB (scripts/verify-mail-search.mts runs it directly).
//
//   words  "exact phrase"  -exclude  -"exclude phrase"
//   from:  to:  subject:  filename:   (value may be "quoted")
//   has:attachment  is:unread  is:read  is:flagged (is:starred)
//   after:2026-10-01  before:2026/10/25  (also 10/25/2026)
//   in:inbox|sent|drafts|archive|spam|trash
//
// Anything that looks like an operator but isn't one ("Re:", "10:30") is kept
// as plain text, so it can never turn into a provider syntax error.

export type MailRole = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";
const ROLES: MailRole[] = ["inbox", "sent", "drafts", "archive", "spam", "trash"];

export type MailQuery = {
  text: string[];
  exclude: string[];
  from: string[];
  to: string[];
  subject: string[];
  filename: string[];
  hasAttachment?: boolean;
  // true = unread only, false = read only.
  unread?: boolean;
  flagged?: boolean;
  // YYYY-MM-DD. after is inclusive, before is exclusive (Gmail's meaning).
  after?: string;
  before?: string;
  in?: MailRole;
};

export const emptyQuery = (): MailQuery => ({ text: [], exclude: [], from: [], to: [], subject: [], filename: [] });

// True when the query asks for words or people, which searches the whole
// mailbox (Gmail's behaviour) rather than the folder on screen.
export function isTextSearch(q: MailQuery): boolean {
  return !!(q.text.length || q.exclude.length || q.from.length || q.to.length || q.subject.length || q.filename.length || q.after || q.before || q.in);
}

function toDate(v: string): string | undefined {
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v))) [y, mo, d] = [Number(m[3]), Number(m[1]), Number(m[2])];
  else return undefined;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return dt.toISOString().slice(0, 10);
}

// Tokens: optional leading "-", optional "op:", then a "quoted" or bare value.
const TOKEN = /(-?)(?:([a-zA-Z_]+):)?(?:"([^"]*)"?|(\S+))/g;

export function parseMailQuery(input: string): MailQuery {
  const q = emptyQuery();
  const s = input.slice(0, 500);
  for (const m of s.matchAll(TOKEN)) {
    const neg = m[1] === "-";
    const op = m[2]?.toLowerCase();
    const quoted = m[3] !== undefined;
    const value = (quoted ? m[3] : m[4] ?? "").trim();
    const literal = () => {
      // Not an operator we know: keep the whole thing as text, operator and all.
      const t = op ? `${m[2]}:${value}` : value;
      if (!t) return;
      (neg ? q.exclude : q.text).push(t);
    };
    if (!op) {
      if (value) (neg ? q.exclude : q.text).push(value);
      continue;
    }
    const v = value.toLowerCase();
    switch (op) {
      case "from":
      case "to":
      case "subject":
      case "filename":
        if (!value) break;
        if (neg) q.exclude.push(value);
        else q[op].push(value);
        break;
      case "has":
        if (v === "attachment" || v === "attachments" || v === "file" || v === "files") q.hasAttachment = !neg;
        else literal();
        break;
      case "is":
        if (v === "unread") q.unread = !neg;
        else if (v === "read") q.unread = neg;
        else if (v === "flagged" || v === "starred") q.flagged = !neg;
        else literal();
        break;
      case "after":
      case "before": {
        const d = toDate(value);
        if (d && !neg) q[op] = d;
        else literal();
        break;
      }
      case "in":
        if (ROLES.includes(v as MailRole) && !neg) q.in = v as MailRole;
        else literal();
        break;
      default:
        literal();
    }
  }
  return q;
}

// ---- Gmail: its own operators, so this is mostly re-quoting.

function gq(v: string): string {
  const clean = v.replace(/"/g, "");
  return /[\s():{}[\]]/.test(clean) || !clean ? `"${clean}"` : clean;
}

export function toGmailQuery(q: MailQuery): string {
  const parts: string[] = [];
  for (const t of q.text) parts.push(gq(t));
  for (const t of q.exclude) parts.push(`-${gq(t)}`);
  for (const op of ["from", "to", "subject", "filename"] as const) for (const v of q[op]) parts.push(`${op}:${gq(v)}`);
  if (q.hasAttachment !== undefined) parts.push(q.hasAttachment ? "has:attachment" : "-has:attachment");
  if (q.unread !== undefined) parts.push(q.unread ? "is:unread" : "-is:unread");
  if (q.flagged !== undefined) parts.push(q.flagged ? "is:starred" : "-is:starred");
  if (q.after) parts.push(`after:${q.after.replace(/-/g, "/")}`);
  if (q.before) parts.push(`before:${q.before.replace(/-/g, "/")}`);
  return parts.join(" ");
}

// ---- Outlook (Microsoft Graph). Graph has two dialects that don't mix: KQL in
// $search (words, people, dates, attachments) and OData in $filter (read and
// flag state, also attachments and dates). $search can't sort or combine with
// $filter, so with words the read/flag state is checked here after the fetch.

export type GraphSearch = {
  // KQL for $search, without the outer quotes. Absent = no word search.
  search?: string;
  // OData for $filter. Starts with receivedDateTime because Graph insists the
  // $orderby property comes first in $filter.
  filter?: string;
  // Checks Graph couldn't do server-side, applied to each fetched message.
  post: { unread?: boolean; flagged?: boolean };
};

// A KQL value: always quoted, so KQL keywords (AND, OR, NOT) and colons in the
// owner's words are just words.
function kq(v: string): string {
  return `"${v.replace(/"/g, "")}"`;
}

export function toGraphSearch(q: MailQuery): GraphSearch {
  const words = q.text.length || q.exclude.length || q.from.length || q.to.length || q.subject.length || q.filename.length;
  if (words) {
    const parts: string[] = [];
    for (const t of q.text) parts.push(kq(t));
    for (const v of q.from) parts.push(`from:${kq(v)}`);
    for (const v of q.to) parts.push(`to:${kq(v)}`);
    for (const v of q.subject) parts.push(`subject:${kq(v)}`);
    for (const v of q.filename) parts.push(`attachment:${kq(v)}`);
    if (q.hasAttachment !== undefined) parts.push(`hasAttachments:${q.hasAttachment}`);
    if (q.after) parts.push(`received>=${q.after}`);
    if (q.before) parts.push(`received<${q.before}`);
    // NOT needs something before it; a query of only exclusions can't run on
    // Graph's $search, so it falls back to everything minus nothing.
    if (parts.length) for (const t of q.exclude) parts.push(`NOT ${kq(t)}`);
    return { search: parts.join(" ") || undefined, post: { unread: q.unread, flagged: q.flagged } };
  }
  const f = [`receivedDateTime ge ${q.after ?? "1900-01-01"}T00:00:00Z`];
  if (q.before) f.push(`receivedDateTime lt ${q.before}T00:00:00Z`);
  if (q.unread !== undefined) f.push(`isRead eq ${!q.unread}`);
  if (q.flagged !== undefined) f.push(q.flagged ? "flag/flagStatus eq 'flagged'" : "flag/flagStatus ne 'flagged'");
  if (q.hasAttachment !== undefined) f.push(`hasAttachments eq ${q.hasAttachment}`);
  return { filter: f.length > 1 || q.after ? f.join(" and ") : undefined, post: {} };
}

export function passesPost(m: { read: boolean; flagged: boolean }, post: GraphSearch["post"]): boolean {
  if (post.unread !== undefined && m.read === post.unread) return false;
  if (post.flagged !== undefined && m.flagged !== post.flagged) return false;
  return true;
}
