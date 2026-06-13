// Email-in import engine (slice 26, PRD §5.3). Deterministic, no model in the
// loop. Polls the "Ledgr Import" Outlook folder through a MailSource: each new
// message becomes a `note` (or `task` if the subject is prefixed `task:`),
// body converted from the email, attachments stored to R2. Imported messages
// are marked read + moved (markImported) so messages/delta never re-returns
// them; a properties.email.messageId guard covers a crash between create and
// move. New items land inbox:true for manual entity tagging.
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { attachments as attachmentsTable, jobState } from "@/db/schema";
import { makeMarkdownBody } from "@/lib/body";
import { createItem } from "@/lib/items";
import { getStorage } from "@/lib/storage";
import { emailToMarkdown } from "./html";
import type { MailSource, NormalizedMessage } from "./types";

export const EMAIL_JOB_KEY = "email_import";
const TASK_PREFIX = /^task:\s*/i;

export type EmailRunResult = {
  imported: number;
  tasks: number;
  notes: number;
  attachments: number;
  skipped: number;
  errors: number;
};

export type EmailJobState = {
  lastRunAt: string;
  lastSuccessAt: string | null;
  lastResult: EmailRunResult;
  // The Graph messages/delta token to resume from next run.
  deltaToken: string | null;
};

// Already-imported guard: a prior item carrying this message id (GIN @>).
async function alreadyImported(ownerId: string, messageId: string): Promise<boolean> {
  const res = await getDb().execute(sql`
    select 1 from items
    where owner_id = ${ownerId}
      and properties @> ${JSON.stringify({ email: { messageId } })}::jsonb
    limit 1
  `);
  return res.rows.length > 0;
}

function routeMessage(msg: NormalizedMessage): { type: "task" | "note"; title: string } {
  const subject = (msg.subject || "").trim();
  if (TASK_PREFIX.test(subject)) {
    return { type: "task", title: subject.replace(TASK_PREFIX, "").trim() || "(no subject)" };
  }
  return { type: "note", title: subject || "(no subject)" };
}

async function storeAttachments(
  ownerId: string,
  itemId: string,
  msg: NormalizedMessage
): Promise<number> {
  if (msg.attachments.length === 0) return 0;
  const storage = getStorage();
  if (!storage) return 0; // No R2 configured: import the item, drop the bytes.
  const db = getDb();
  let stored = 0;
  for (const att of msg.attachments) {
    const id = crypto.randomUUID();
    const key = `${ownerId}/${id}/${att.name}`;
    await storage.putObject(key, att.bytes, att.contentType);
    await db.insert(attachmentsTable).values({
      id,
      ownerId,
      parentItemId: itemId,
      filename: att.name,
      contentType: att.contentType,
      sizeBytes: att.size,
      storageKey: key,
    });
    stored++;
  }
  return stored;
}

export async function runEmailImport(
  ownerId: string,
  source: MailSource,
  opts: { onError?: (messageId: string, err: unknown) => void } = {}
): Promise<EmailRunResult> {
  const db = getDb();
  const prior = (
    await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, EMAIL_JOB_KEY))
  )[0]?.value as EmailJobState | undefined;

  const { messages, nextDeltaToken } = await source.listNewMessages(prior?.deltaToken ?? null);

  const result: EmailRunResult = { imported: 0, tasks: 0, notes: 0, attachments: 0, skipped: 0, errors: 0 };

  for (const msg of messages) {
    try {
      if (await alreadyImported(ownerId, msg.id)) {
        // Created before but the move didn't land; move it now and skip.
        await source.markImported(msg.id);
        result.skipped++;
        continue;
      }
      const { type, title } = routeMessage(msg);
      const item = await createItem(ownerId, {
        type,
        title,
        body: makeMarkdownBody(emailToMarkdown(msg.bodyText, msg.bodyHtml)),
        inbox: true,
        properties: {
          email: {
            messageId: msg.id,
            fromName: msg.fromName,
            fromEmail: msg.fromEmail,
            receivedAt: msg.receivedAt,
          },
        },
      });
      result.attachments += await storeAttachments(ownerId, item.id, msg);
      await source.markImported(msg.id);
      result.imported++;
      if (type === "task") result.tasks++;
      else result.notes++;
    } catch (err) {
      result.errors++;
      opts.onError?.(msg.id, err);
    }
  }

  // Advance the delta token only when no message errored — a failed import
  // must be re-seen next run, not skipped past.
  const now = new Date().toISOString();
  const advancedToken = result.errors === 0 ? nextDeltaToken : (prior?.deltaToken ?? null);
  const state: EmailJobState = {
    lastRunAt: now,
    lastSuccessAt: result.errors === 0 ? now : (prior?.lastSuccessAt ?? null),
    lastResult: result,
    deltaToken: advancedToken,
  };
  await db
    .insert(jobState)
    .values({ key: EMAIL_JOB_KEY, value: state })
    .onConflictDoUpdate({ target: jobState.key, set: { value: state } });

  return result;
}

export async function getEmailState(): Promise<EmailJobState | null> {
  const rows = await getDb()
    .select({ value: jobState.value })
    .from(jobState)
    .where(eq(jobState.key, EMAIL_JOB_KEY));
  return (rows[0]?.value as EmailJobState) ?? null;
}
