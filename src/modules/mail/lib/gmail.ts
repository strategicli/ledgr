// Gmail provider for the mail module: the MailProvider action list over the
// Gmail REST API. Plain fetch through googleFetch (google-auth.ts), no
// googleapis package. Gmail has labels, not folders: system labels become
// folders with roles, user labels are both folders and tags, and "archive" is
// a synthetic folder (everything not in inbox/sent/drafts/trash/spam).
// Verified against a stubbed fetch (scripts/verify-mail-google.mts); the real
// API shapes are from Google's docs.
import { googleClient, googleFetch } from "./google-auth";
import { readMailStore } from "./store";
import {
  MailProviderError,
  type FullMessage,
  type InlineImage,
  type ListMessagesQuery,
  type MailAddress,
  type MailAttachmentMeta,
  type MailFolder,
  type MailProvider,
  type MailTag,
  type MessageChange,
  type MessagePage,
  type MessageSummary,
  type OutgoingMessage,
} from "./types";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
export const ARCHIVE_ID = "ARCHIVE";
export const ARCHIVE_QUERY = "-in:inbox -in:sent -in:drafts -in:trash -in:spam";

const SYSTEM_ROLES: Record<string, MailFolder["role"]> = {
  INBOX: "inbox",
  SENT: "sent",
  DRAFT: "drafts",
  TRASH: "trash",
  SPAM: "spam",
};
// Labels Gmail puts on messages that are not user labels (so not tags).
const isSystemLabel = (l: string) =>
  l in SYSTEM_ROLES || ["UNREAD", "STARRED", "IMPORTANT", "CHAT"].includes(l) || l.startsWith("CATEGORY_");

type Header = { name: string; value: string };
type Part = {
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: Part[];
};
type GMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: Part;
};
type GLabel = {
  id: string;
  name: string;
  type?: "system" | "user";
  messagesUnread?: number;
  color?: { backgroundColor?: string };
};

// Every Gmail call: googleFetch, JSON in and out, Google's own error message
// on a non-2xx. Empty bodies (DELETE, batchModify) come back as {}.
async function gmail<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = init.body ? { "content-type": "application/json" } : {};
  const res = await googleFetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } }).error?.message;
    throw new MailProviderError(msg ?? `Gmail request failed: ${res.status}`, "request", res.status);
  }
  return data as T;
}

const post = (path: string, body: unknown) => gmail(path, { method: "POST", body: JSON.stringify(body) });

// --- address parsing ------------------------------------------------------

// Split a header on commas that sit outside quotes and <angle brackets>, then
// read each piece as `"Name, X" <a@b>`, `Name <a@b>` or a bare `a@b`.
export function parseAddressList(value: string | undefined | null): MailAddress[] {
  if (!value) return [];
  const pieces: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle = true;
    else if (!quoted && ch === ">") angle = false;
    if (ch === "," && !quoted && !angle) {
      pieces.push(cur);
      cur = "";
    } else cur += ch;
  }
  pieces.push(cur);
  const out: MailAddress[] = [];
  for (const raw of pieces) {
    const p = raw.trim();
    if (!p) continue;
    const m = p.match(/^(.*?)<([^<>]+)>\s*$/);
    if (m) {
      const name = m[1].trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim();
      out.push({ name: name || null, email: m[2].trim() });
    } else {
      out.push({ name: null, email: p.replace(/^"(.*)"$/, "$1") });
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&#39;": "'", "&quot;": '"', "&lt;": "<", "&gt;": ">" };
export function decodeEntities(s: string): string {
  return s.replace(/&(amp|quot|lt|gt|#39);/g, (m) => ENTITIES[m] ?? m);
}

const decodeB64 = (data: string) => Buffer.from(data, "base64url").toString("utf8");

// --- message mapping ------------------------------------------------------

function header(p: Part | undefined, name: string): string | undefined {
  const n = name.toLowerCase();
  return p?.headers?.find((h) => h.name.toLowerCase() === n)?.value;
}

function toSummary(m: GMessage): MessageSummary {
  const labels = m.labelIds ?? [];
  const h = m.payload;
  return {
    id: m.id,
    account: "gmail",
    threadId: m.threadId,
    internetMessageId: header(h, "Message-ID") ?? null,
    subject: header(h, "Subject") ?? "",
    from: parseAddressList(header(h, "From"))[0] ?? null,
    to: parseAddressList(header(h, "To")),
    receivedAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    preview: decodeEntities(m.snippet ?? ""),
    read: !labels.includes("UNREAD"),
    flagged: labels.includes("STARRED"),
    // ponytail: false at list level, the metadata format has no parts to inspect;
    // getMessage knows the truth. Upgrade: a has:attachment search or format=full.
    hasAttachments: false,
    tags: labels.filter((l) => !isSystemLabel(l)),
    folderIds: labels,
  };
}

// Depth-first walk of the MIME tree: first html, first plain text, every
// attachment (a part with a filename and an attachmentId).
function walk(
  p: Part,
  out: { html: string | null; text: string | null; atts: MailAttachmentMeta[]; imgs?: Part[] }
) {
  const type = (p.mimeType ?? "").toLowerCase();
  if (out.imgs && type.startsWith("image/") && header(p, "Content-ID")) out.imgs.push(p);
  if (p.filename && p.body?.attachmentId) {
    const disp = header(p, "Content-Disposition") ?? "";
    const cid = header(p, "Content-ID")?.replace(/^<|>$/g, "") ?? null;
    out.atts.push({
      id: p.body.attachmentId,
      name: p.filename,
      contentType: p.mimeType ?? "application/octet-stream",
      size: p.body.size ?? 0,
      inline: /^\s*inline/i.test(disp) || !!cid,
      contentId: cid,
    });
  } else if (p.body?.data) {
    if (type === "text/html" && out.html === null) out.html = decodeB64(p.body.data);
    else if (type === "text/plain" && out.text === null) out.text = decodeB64(p.body.data);
  }
  for (const c of p.parts ?? []) walk(c, out);
}

function toFull(m: GMessage): FullMessage {
  const found = { html: null as string | null, text: null as string | null, atts: [] as MailAttachmentMeta[] };
  if (m.payload) walk(m.payload, found);
  return {
    ...toSummary(m),
    hasAttachments: found.atts.some((a) => !a.inline),
    cc: parseAddressList(header(m.payload, "Cc")),
    bcc: parseAddressList(header(m.payload, "Bcc")),
    replyTo: parseAddressList(header(m.payload, "Reply-To")),
    bodyHtml: found.html,
    bodyText: found.text,
    attachments: found.atts,
    webLink: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
  };
}

// --- outgoing mail --------------------------------------------------------

const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);
const wrap76 = (b64: string) => b64.match(/.{1,76}/g)?.join("\r\n") ?? "";
// RFC 2047 for anything non-ASCII in a header.
const encWord = (s: string) => (ascii(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const fmtAddr = (a: MailAddress) =>
  a.name ? `${ascii(a.name) ? `"${a.name.replace(/(["\\])/g, "\\$1")}"` : encWord(a.name)} <${a.email}>` : a.email;

export function buildRaw(msg: OutgoingMessage, extra: { inReplyTo?: string; references?: string }): string {
  const boundary = `ledgr_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  // From is left out: Gmail fills in the signed-in address.
  const head = [
    `To: ${msg.to.map(fmtAddr).join(", ")}`,
    ...(msg.cc?.length ? [`Cc: ${msg.cc.map(fmtAddr).join(", ")}`] : []),
    ...(msg.bcc?.length ? [`Bcc: ${msg.bcc.map(fmtAddr).join(", ")}`] : []),
    `Subject: ${encWord(msg.subject)}`,
    ...(extra.inReplyTo ? [`In-Reply-To: ${extra.inReplyTo}`] : []),
    ...(extra.references ? [`References: ${extra.references}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    [
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(Buffer.from(msg.html, "utf8").toString("base64")),
    ].join("\r\n"),
    ...(msg.attachments ?? []).map((a) =>
      [
        `--${boundary}`,
        `Content-Type: ${a.contentType}; name="${encWord(a.name)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${encWord(a.name)}"`,
        "",
        wrap76(a.base64),
      ].join("\r\n")
    ),
  ];
  return `${head.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--\r\n`;
}

// --- the provider ---------------------------------------------------------

export class GmailProvider implements MailProvider {
  readonly account = "gmail" as const;

  async listFolders(): Promise<MailFolder[]> {
    const { labels = [] } = await gmail<{ labels?: GLabel[] }>("/labels");
    const wanted = labels.filter((l) => l.type === "user" || l.id in SYSTEM_ROLES);
    // ponytail: the list call carries no unread counts, so this is one GET per
    // label (N+1). Fine for a personal mailbox; upgrade: counts only for visible labels.
    const full = await Promise.all(wanted.map((l) => gmail<GLabel>(`/labels/${encodeURIComponent(l.id)}`)));
    const idByName = new Map(full.map((l) => [l.name, l.id]));
    const folders: MailFolder[] = full.map((l) => {
      const slash = l.name.lastIndexOf("/");
      return {
        id: l.id,
        account: "gmail",
        name: l.name,
        role: SYSTEM_ROLES[l.id] ?? null,
        parentId: slash > 0 ? (idByName.get(l.name.slice(0, slash)) ?? null) : null,
        unread: l.messagesUnread ?? 0,
      };
    });
    folders.push({ id: ARCHIVE_ID, account: "gmail", name: "All archived", role: "archive", parentId: null, unread: 0 });
    return folders;
  }

  async listTags(): Promise<MailTag[]> {
    const { labels = [] } = await gmail<{ labels?: GLabel[] }>("/labels");
    return labels
      .filter((l) => l.type === "user")
      .map((l) => ({ id: l.id, account: "gmail", name: l.name, color: l.color?.backgroundColor ?? null }));
  }

  async listMessages(q: ListMessagesQuery): Promise<MessagePage> {
    const p = new URLSearchParams({ maxResults: String(Math.min(q.limit ?? 50, 100)) });
    const query: string[] = [];
    if (q.folderId === ARCHIVE_ID) query.push(ARCHIVE_QUERY);
    else if (q.folderId) p.append("labelIds", q.folderId);
    if (q.search) query.push(q.search);
    if (q.unreadOnly) query.push("is:unread");
    if (query.length) p.set("q", query.join(" "));
    if (q.pageToken) p.set("pageToken", q.pageToken);
    const list = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${p}`);
    const ids = (list.messages ?? []).map((m) => m.id);
    const meta = new URLSearchParams({ format: "metadata" });
    for (const h of ["From", "To", "Subject", "Message-ID", "Date"]) meta.append("metadataHeaders", h);
    const messages: MessageSummary[] = [];
    // Chunks of 10 keep us under Gmail's per-user concurrency limit.
    for (let i = 0; i < ids.length; i += 10) {
      const got = await Promise.all(ids.slice(i, i + 10).map((id) => gmail<GMessage>(`/messages/${id}?${meta}`)));
      messages.push(...got.map(toSummary));
    }
    return { messages, nextPageToken: list.nextPageToken ?? null };
  }

  async getMessage(id: string): Promise<FullMessage> {
    return toFull(await gmail<GMessage>(`/messages/${id}?format=full`));
  }

  async getThread(threadId: string): Promise<FullMessage[]> {
    const t = await gmail<{ messages?: GMessage[] }>(`/threads/${threadId}?format=full`);
    return (t.messages ?? []).map(toFull);
  }

  async getInlineImages(messageId: string): Promise<InlineImage[]> {
    const m = await gmail<GMessage>(`/messages/${messageId}?format=full`);
    const found = { html: null as string | null, text: null as string | null, atts: [] as MailAttachmentMeta[], imgs: [] as Part[] };
    if (m.payload) walk(m.payload, found);
    // ponytail: cap of 20 pictures per message, same as the Outlook side.
    const out: InlineImage[] = [];
    for (const p of found.imgs.slice(0, 20)) {
      let data = p.body?.data;
      if (!data && p.body?.attachmentId) {
        data = (await gmail<{ data?: string }>(`/messages/${messageId}/attachments/${p.body.attachmentId}`)).data;
      }
      const contentId = header(p, "Content-ID")?.trim().replace(/^<|>$/g, "");
      if (!data || !contentId) continue;
      // Gmail sends base64url; the data: URL needs standard base64.
      out.push({
        contentId,
        contentType: p.mimeType ?? "application/octet-stream",
        base64: Buffer.from(data, "base64url").toString("base64"),
      });
    }
    return out;
  }

  async getAttachment(messageId: string, attachmentId: string) {
    const [att, msg] = await Promise.all([
      gmail<{ data?: string }>(`/messages/${messageId}/attachments/${attachmentId}`),
      this.getMessage(messageId),
    ]);
    const meta = msg.attachments.find((a) => a.id === attachmentId);
    return {
      name: meta?.name ?? "attachment",
      contentType: meta?.contentType ?? "application/octet-stream",
      bytes: new Uint8Array(Buffer.from(att.data ?? "", "base64url")),
    };
  }

  private async batch(ids: string[], addLabelIds: string[], removeLabelIds: string[]) {
    if (!ids.length || (!addLabelIds.length && !removeLabelIds.length)) return;
    await post("/messages/batchModify", { ids, addLabelIds, removeLabelIds });
  }

  async modify(ids: string[], c: MessageChange): Promise<void> {
    const add = [...(c.addTags ?? [])];
    const remove = [...(c.removeTags ?? [])];
    if (c.read === false) add.push("UNREAD");
    if (c.read === true) remove.push("UNREAD");
    if (c.flagged === true) add.push("STARRED");
    if (c.flagged === false) remove.push("STARRED");
    await this.batch(ids, add, remove);
  }

  async move(ids: string[], folderId: string): Promise<void> {
    // The synthetic Archive folder and Trash are states, not labels to add.
    if (folderId === ARCHIVE_ID) return this.archive(ids);
    if (folderId === "TRASH") return this.trash(ids);
    await this.batch(ids, [folderId], folderId === "INBOX" ? [] : ["INBOX"]);
  }

  // Undo of trash: Gmail's untrash puts back the labels the message had.
  async restore(ids: string[]): Promise<void> {
    for (const id of ids) await post(`/messages/${id}/untrash`, {});
  }

  async archive(ids: string[]): Promise<void> {
    await this.batch(ids, [], ["INBOX"]);
  }

  async trash(ids: string[]): Promise<void> {
    for (const id of ids) await post(`/messages/${id}/trash`, {});
  }

  async createDraft(msg: OutgoingMessage): Promise<{ id: string }> {
    const extra: { inReplyTo?: string; references?: string } = {};
    let threadId: string | undefined;
    const target = msg.inReplyTo;
    // Replies thread on the original; a forward starts a fresh thread.
    if (target && target.mode !== "forward") {
      const p = new URLSearchParams({ format: "metadata" });
      for (const h of ["Message-ID", "References", "Subject"]) p.append("metadataHeaders", h);
      const orig = await gmail<GMessage>(`/messages/${target.messageId}?${p}`);
      const mid = header(orig.payload, "Message-ID");
      if (mid) {
        extra.inReplyTo = mid;
        extra.references = [header(orig.payload, "References"), mid].filter(Boolean).join(" ");
      }
      threadId = orig.threadId;
    }
    const raw = Buffer.from(buildRaw(msg, extra), "utf8").toString("base64url");
    const draft = await post("/drafts", { message: { raw, ...(threadId ? { threadId } : {}) } });
    return { id: (draft as { id: string }).id };
  }

  async deleteDraft(id: string): Promise<void> {
    await gmail(`/drafts/${id}`, { method: "DELETE" });
  }

  async sendDraft(id: string): Promise<void> {
    await post("/drafts/send", { id });
  }
}

// The provider, or null until the owner has set up the Google app and signed in.
export function getGmail(): GmailProvider | null {
  if (!googleClient() || !readMailStore().google?.refreshToken) return null;
  return new GmailProvider();
}
