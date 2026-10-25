// Mail over MCP: everything the /mail screen can do, for Claude. Thin wrappers
// over the same libs the routes use (reading, acting, links, search), so the
// two surfaces can't drift. Claimed by the mail manifest's mcpTools slot, so
// they exist only while Mail & Calendar is on; and like the routes they refuse
// anywhere but the hub, where the sign-ins live. Never sends mail.
import { ItemError } from "@/lib/items";
import type { McpTool } from "@/lib/mcp/tools/wire";
import { emailToMarkdown } from "@/modules/email-capture/lib/html";
import { mailAvailable } from "@/modules/mail/manifest";
import { act, parseAct } from "./acting";
import { createFromEmail, importAttachments, linkedItems, mailHref, saveAttachment, type LinkType } from "./links";
import { connectedAccounts, isAccount, listFolders, listMessages, provider, readMessage, readThread } from "./reading";
import { MailProviderError, type AccountId, type FullMessage, type MessageSummary } from "./types";

const ACCOUNT = { type: "string", enum: ["microsoft", "gmail"], description: "microsoft = Outlook, gmail = Gmail." };
const LINK_TYPES: LinkType[] = ["task", "note", "event"];
// A long email body is cut here so one read can't flood the context.
const BODY_CAP = 20000;

// The hub check, plus provider errors turned into plain tool errors.
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  if (!mailAvailable()) {
    throw new ItemError("bad_request", "Mail runs only on the Ledgr installed on the owner's own computer, not on this copy.");
  }
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MailProviderError) throw new ItemError(err.status === 404 ? "not_found" : "bad_request", err.message);
    throw err;
  }
}

function account(v: unknown): AccountId {
  if (!isAccount(v)) throw new ItemError("bad_request", "account must be microsoft or gmail");
  return v;
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v || v.length > 1024) throw new ItemError("bad_request", `${name} is required`);
  return v;
}

const who = (a: { name: string | null; email: string } | null) => (a ? (a.name ? `${a.name} <${a.email}>` : a.email) : null);

async function withLinks<T extends { id: string; internetMessageId: string | null }>(ownerId: string, ms: T[]) {
  const links = await linkedItems(ownerId, ms.map((m) => ({ id: m.id, internetMessageId: m.internetMessageId })));
  return (m: T) => (links[m.id] ?? []).map((l) => ({ id: l.id, type: l.type, title: l.title, status: l.status }));
}

function summaryView(m: MessageSummary) {
  return {
    account: m.account,
    id: m.id,
    threadId: m.threadId,
    subject: m.subject || "(no subject)",
    from: who(m.from),
    receivedAt: m.receivedAt,
    preview: m.preview,
    read: m.read,
    flagged: m.flagged,
    hasAttachments: m.hasAttachments,
    tags: m.tags,
  };
}

function messageView(m: FullMessage) {
  const body = emailToMarkdown(m.bodyText, m.bodyHtml);
  return {
    account: m.account,
    id: m.id,
    subject: m.subject || "(no subject)",
    from: who(m.from),
    to: m.to.map(who),
    cc: m.cc.map(who),
    receivedAt: m.receivedAt,
    read: m.read,
    flagged: m.flagged,
    tags: m.tags,
    attachments: m.attachments.filter((a) => !a.inline).map((a) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size })),
    body: body.length > BODY_CAP ? `${body.slice(0, BODY_CAP)}\n\n[…cut at ${BODY_CAP} characters]` : body,
  };
}

const ACTION_SCHEMA = {
  type: "object",
  description:
    "What to do. kind: archive | trash (to the trash, never permanent) | read (value: true/false) | " +
    "flag (value: true/false) | move (folderId from mail_list_folders) | tags (add/remove: tag ids from " +
    "mail_list_tags) | restore (folderId; the undo of trash).",
  properties: {
    kind: { type: "string", enum: ["archive", "trash", "read", "flag", "move", "tags", "restore"] },
    value: { type: "boolean" },
    folderId: { type: "string" },
    add: { type: "array", items: { type: "string" } },
    remove: { type: "array", items: { type: "string" } },
  },
  required: ["kind"],
};

export const mailTools: McpTool[] = [
  {
    name: "mail_accounts",
    title: "List connected mail accounts",
    description: "Which mail accounts Ledgr Mail can read: microsoft (Outlook) and/or gmail. Call first if unsure.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: () => guarded(async () => ({ accounts: connectedAccounts() })),
  },
  {
    name: "mail_list_folders",
    title: "List mail folders",
    description: "An account's folders (Outlook) or labels (Gmail) with unread counts and roles (inbox, sent, archive…). The ids are what mail_search's folder and mail_act's move take.",
    inputSchema: { type: "object", properties: { account: ACCOUNT }, required: ["account"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: (_o, a) => guarded(async () => ({ folders: await listFolders(account(a.account)) })),
  },
  {
    name: "mail_list_tags",
    title: "List mail tags",
    description: "An account's tags: Outlook categories or Gmail user labels, with colors. The ids are what mail_act's tags action takes.",
    inputSchema: { type: "object", properties: { account: ACCOUNT }, required: ["account"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: (_o, a) => guarded(async () => ({ tags: await provider(account(a.account)).listTags() })),
  },
  {
    name: "mail_search",
    title: "Search or list mail",
    description:
      "List or search the owner's mail, newest first, with the Ledgr items already linked to each email. " +
      "With no query it lists the folder (default: the inbox). A query with words searches the WHOLE mailbox. " +
      "Query language (same for both accounts): words, \"exact phrase\", -exclude, from:, to:, subject:, " +
      "filename:, has:attachment, is:unread, is:read, is:flagged, after:YYYY-MM-DD, before:YYYY-MM-DD, " +
      "in:inbox|sent|drafts|archive|spam|trash. Pass nextPageToken back as pageToken for more.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", enum: ["all", "microsoft", "gmail"], description: "Default all: both accounts merged." },
        query: { type: "string", description: "Search text in the language above." },
        folder: { type: "string", description: "For one account, a folder id from mail_list_folders; for all, a role (inbox, sent, drafts, archive, spam, trash). Ignored when the query has words." },
        unreadOnly: { type: "boolean" },
        flaggedOnly: { type: "boolean" },
        withAttachments: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 25." },
        pageToken: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: (ownerId, a) =>
      guarded(async () => {
        const acct = a.account === undefined || a.account === "all" ? "all" : account(a.account);
        const res = await listMessages({
          account: acct,
          folder: typeof a.folder === "string" ? a.folder : undefined,
          search: typeof a.query === "string" ? a.query.slice(0, 500) : undefined,
          unreadOnly: a.unreadOnly === true,
          flaggedOnly: a.flaggedOnly === true,
          filesOnly: a.withAttachments === true,
          pageToken: typeof a.pageToken === "string" ? a.pageToken : undefined,
          limit: typeof a.limit === "number" ? a.limit : 25,
        });
        const linked = await withLinks(ownerId, res.messages);
        return {
          messages: res.messages.map((m) => ({ ...summaryView(m), linkedItems: linked(m) })),
          nextPageToken: res.nextPageToken,
          searchedWholeMailbox: res.searchedAll ?? false,
          ...(res.errors.length ? { accountErrors: res.errors } : {}),
        };
      }),
  },
  {
    name: "mail_read",
    title: "Read an email or conversation",
    description:
      "Read one email (id) or its whole conversation (threadId, oldest first) as plain markdown text, with " +
      "attachment ids and the Ledgr items linked to each message. Reading does not mark the email read; " +
      "use mail_act for that.",
    inputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT,
        id: { type: "string", description: "An email id from mail_search." },
        threadId: { type: "string", description: "A threadId from mail_search, for the whole conversation." },
      },
      required: ["account"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: (ownerId, a) =>
      guarded(async () => {
        const acct = account(a.account);
        let ms: FullMessage[];
        if (typeof a.threadId === "string" && a.threadId) ms = await readThread(acct, a.threadId);
        else ms = [await readMessage(acct, str(a.id, "id or threadId"))];
        const linked = await withLinks(ownerId, ms);
        return {
          messages: ms.map((m) => ({ ...messageView(m), linkedItems: linked(m) })),
          openInLedgr: ms[0] ? mailHref(acct, ms[0].threadId) : null,
        };
      }),
  },
  {
    name: "mail_act",
    title: "Archive, delete, move, flag or tag mail",
    description:
      "Change one or more emails (up to 100, may mix accounts): archive, trash, mark read/unread, flag/unflag, " +
      "move to a folder, add/remove tags, or restore from trash. Delete always means the trash, never " +
      "permanent. Returns per-account errors; an empty list means it all worked. Confirm with the owner " +
      "before acting on mail they haven't asked about.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { account: ACCOUNT, id: { type: "string" } }, required: ["account", "id"] },
        },
        action: ACTION_SCHEMA,
      },
      required: ["items", "action"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: (_o, a) =>
      guarded(async () => {
        const parsed = parseAct({ items: a.items, action: a.action });
        if (!parsed) throw new ItemError("bad_request", "Expected items [{account, id}] and a valid action.");
        const errors = await act(parsed.items, parsed.action);
        return { ok: errors.length === 0, errors };
      }),
  },
  {
    name: "mail_make_item",
    title: "Make a task, note or meeting from an email",
    description:
      "File an email in Ledgr as a task, note or meeting (event), linked both ways: the subject becomes the " +
      "title, the sender's person record is related when one exists, and the item links back to the email. " +
      "A note brings the email's text; a task or meeting keeps a preview. Making a task flags the email.",
    inputSchema: {
      type: "object",
      properties: { account: ACCOUNT, id: { type: "string" }, type: { type: "string", enum: LINK_TYPES } },
      required: ["account", "id", "type"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
    handler: (ownerId, a) =>
      guarded(async () => {
        if (!LINK_TYPES.includes(a.type as LinkType)) throw new ItemError("bad_request", "type must be task, note or event");
        return { item: await createFromEmail(ownerId, account(a.account), str(a.id, "id"), a.type as LinkType) };
      }),
  },
  {
    name: "mail_import_attachments",
    title: "Import an email's attachments into Ledgr",
    description:
      "Copy an email's files into Ledgr. Without itemId: makes a new note holding the files, linked to the " +
      "email and its sender. With itemId: adds the files to that existing item instead. attachmentIds " +
      "(from mail_read) picks files; omit it for every file.",
    inputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT,
        messageId: { type: "string" },
        attachmentIds: { type: "array", items: { type: "string" } },
        itemId: { type: "string", description: "An existing Ledgr item to add the files to." },
      },
      required: ["account", "messageId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
    handler: (ownerId, a) =>
      guarded(async () => {
        const acct = account(a.account);
        const messageId = str(a.messageId, "messageId");
        const ids = Array.isArray(a.attachmentIds) ? a.attachmentIds.filter((x): x is string => typeof x === "string").slice(0, 50) : undefined;
        if (typeof a.itemId === "string" && a.itemId) {
          const m = await readMessage(acct, messageId);
          const files = m.attachments.filter((x) => (ids?.length ? ids.includes(x.id) : !x.inline));
          if (!files.length) throw new ItemError("bad_request", "That email has no matching attachment.");
          for (const f of files) await saveAttachment(ownerId, acct, messageId, f.id, a.itemId);
          return { itemId: a.itemId, saved: files.map((f) => f.name) };
        }
        return { item: await importAttachments(ownerId, acct, messageId, ids?.length ? ids : undefined) };
      }),
  },
];

export const MAIL_TOOL_NAMES = mailTools.map((t) => t.name);
