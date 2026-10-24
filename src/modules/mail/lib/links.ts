// Phase 4: email ↔ Ledgr item links (the reason the module exists).
//
// The link lives on the item, in `properties.email`, the same key email
// capture has always written ({messageId, internetMessageId, fromName,
// fromEmail, receivedAt}). So an item imported through the "Ledgr Import"
// folder shows as linked in Mail too. Mail adds `account`, `threadId`,
// `subject` and `preview`, so the item still says who wrote what after the
// email itself is deleted. Matching prefers internetMessageId: it is the same
// on both providers and survives the message moving folders.
//
// One email can link to many items (each item carries its own copy).
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { createAttachmentFromBytes } from "@/lib/attachments";
import { bodyMarkdown, makeMarkdownBody } from "@/lib/body";
import { createItem, updateItem } from "@/lib/item-mutations";
import { getItem } from "@/lib/items";
import { buildEmbedReference } from "@/lib/mcp/tools/attachments";
import { relateItems } from "@/lib/relations";
import { emailToMarkdown } from "@/modules/email-capture/lib/html";
import { provider, readMessage } from "./reading";
import type { AccountId, FullMessage } from "./types";

export type LinkType = "task" | "note" | "event";

export type EmailLink = {
  account?: AccountId;
  messageId: string;
  internetMessageId: string | null;
  threadId?: string;
  subject?: string;
  fromName: string | null;
  fromEmail: string | null;
  receivedAt: string | null;
  preview?: string;
  // Set by the flag job once a finished task's email has been unflagged.
  flagCleared?: boolean;
};

export type LinkedItem = { id: string; type: string; title: string; status: string | null };

// Same escape set as email capture's footer, so text from a stranger can't
// turn into formatting or links.
function esc(s: string): string {
  return s.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`);
}

export function mailHref(account: AccountId, threadId: string): string {
  return `/mail?account=${account}&m=${encodeURIComponent(`${account}:${threadId}`)}`;
}

function footer(m: FullMessage): string {
  const sender = [m.from?.name, m.from?.email && `(${m.from.email})`].filter(Boolean).join(" ");
  const when = m.receivedAt ? new Date(m.receivedAt).toDateString() : "";
  return [
    "---",
    "",
    `**From:** ${esc(sender || "unknown sender")}${when ? `, ${when}` : ""}`,
    `**Subject:** ${esc(m.subject || "(no subject)")}`,
    `[View email in Mail](${mailHref(m.account, m.threadId)})`,
  ].join("\n");
}

export function bodyFor(type: LinkType, m: FullMessage): string {
  // A note takes the email's text (the owner chose to import it); a task or
  // meeting keeps only the preview and points at the live email.
  const text = type === "note" ? emailToMarkdown(m.bodyText, m.bodyHtml) : esc(m.preview);
  return [text, footer(m)].filter(Boolean).join("\n\n");
}

export function emailLinkFor(m: FullMessage): EmailLink {
  return {
    account: m.account,
    messageId: m.id,
    internetMessageId: m.internetMessageId,
    threadId: m.threadId,
    subject: m.subject,
    fromName: m.from?.name ?? null,
    fromEmail: m.from?.email ?? null,
    receivedAt: m.receivedAt,
    preview: m.preview.slice(0, 300),
  };
}

async function personByEmail(ownerId: string, email: string): Promise<string | null> {
  const res = await getDb().execute(sql`
    select id from items
    where owner_id = ${ownerId} and type = 'person' and deleted_at is null and is_template = false
      and lower(properties ->> 'email') = ${email.toLowerCase()}
    limit 1
  `);
  return (res.rows[0] as { id?: string } | undefined)?.id ?? null;
}

export async function createFromEmail(
  ownerId: string,
  account: AccountId,
  messageId: string,
  type: LinkType
): Promise<LinkedItem> {
  const m = await readMessage(account, messageId);
  const item = await createItem(ownerId, {
    type,
    title: m.subject.trim() || "(no subject)",
    body: makeMarkdownBody(bodyFor(type, m)),
    properties: { email: emailLinkFor(m) },
    // Filed on purpose, so it skips the Inbox.
    inbox: false,
  });
  // The sender's person record, when Ledgr already has one. ponytail: no
  // person is created for unknown senders; add that if the owner wants it.
  const personId = m.from?.email ? await personByEmail(ownerId, m.from.email) : null;
  if (personId) await relateItems(ownerId, item.id, personId);
  // A task flags its email; the flag job clears it when the task is done.
  if (type === "task") await provider(account).modify([m.id], { flagged: true });
  return { id: item.id, type: item.type, title: item.title ?? "", status: item.status ?? null };
}

// The items linked to each email, keyed by the email's own id. Matches by
// internetMessageId first (stable everywhere), then the provider id.
export async function linkedItems(
  ownerId: string,
  emails: { id: string; internetMessageId: string | null }[]
): Promise<Record<string, LinkedItem[]>> {
  if (emails.length === 0) return {};
  const imids = emails.map((e) => e.internetMessageId).filter((x): x is string => !!x);
  const ids = emails.map((e) => e.id);
  const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
  const res = await getDb().execute(sql`
    select id, type, title, status,
      properties -> 'email' ->> 'internetMessageId' as imid,
      properties -> 'email' ->> 'messageId' as mid
    from items
    where owner_id = ${ownerId} and deleted_at is null and properties ? 'email'
      and (properties -> 'email' ->> 'messageId' in (${list(ids)})
        ${imids.length ? sql`or properties -> 'email' ->> 'internetMessageId' in (${list(imids)})` : sql``})
    order by created_at
  `);
  const out: Record<string, LinkedItem[]> = {};
  for (const r of res.rows as { id: string; type: string; title: string | null; status: string | null; imid: string | null; mid: string | null }[]) {
    for (const e of emails) {
      if ((e.internetMessageId && r.imid === e.internetMessageId) || r.mid === e.id) {
        (out[e.id] ??= []).push({ id: r.id, type: r.type, title: r.title ?? "", status: r.status });
      }
    }
  }
  return out;
}

// Copy one attachment into Ledgr's storage and add it to the item's body.
export async function saveAttachment(
  ownerId: string,
  account: AccountId,
  messageId: string,
  attachmentId: string,
  itemId: string
): Promise<{ fileUrl: string }> {
  const a = await provider(account).getAttachment(messageId, attachmentId);
  const stored = await createAttachmentFromBytes(ownerId, {
    itemId,
    filename: a.name,
    contentType: a.contentType,
    bytes: a.bytes,
  });
  const item = await getItem(ownerId, itemId);
  const ref = buildEmbedReference(a.contentType, stored.fileUrl, a.name);
  const existing = bodyMarkdown(item?.body);
  const next = existing.trim() ? `${existing.replace(/\s+$/, "")}\n\n${ref}\n` : `${ref}\n`;
  await updateItem(ownerId, itemId, { body: makeMarkdownBody(next) });
  return { fileUrl: stored.fileUrl };
}

// The flag job: every finished task made from an email unflags that email,
// once. Runs on the hub on a schedule, so a task finished anywhere (phone,
// the cloud copy, Claude) is caught after sync. Reopening doesn't re-flag.
export async function clearFlagsForFinishedTasks(ownerId: string): Promise<{ cleared: number; failed: number }> {
  const res = await getDb().execute(sql`
    select id, properties -> 'email' as email from items
    where owner_id = ${ownerId} and type = 'task' and deleted_at is null
      and properties ? 'email' and properties ? 'completed_at'
      and properties -> 'email' ? 'account'
      and coalesce((properties -> 'email' ->> 'flagCleared')::boolean, false) = false
    limit 50
  `);
  let cleared = 0;
  let failed = 0;
  for (const row of res.rows as { id: string; email: EmailLink }[]) {
    const { account, messageId } = row.email;
    try {
      if (account) await provider(account).modify([messageId], { flagged: false });
    } catch (err) {
      // A deleted email has nothing left to unflag: mark it done anyway.
      if ((err as { status?: number }).status !== 404) {
        failed++;
        continue;
      }
    }
    await updateItem(ownerId, row.id, { propertyPatch: { email: { ...row.email, flagCleared: true } } });
    cleared++;
  }
  return { cleared, failed };
}
