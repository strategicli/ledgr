// Attachment metadata + presigned upload flow (PRD §3.4, slice 5).
// The row is created at presign time, before the browser PUTs the bytes to
// R2, so every object in the bucket has a metadata row to be found by (an
// orphaned row for an upload that never finished is harmless metadata; an
// untracked object would leak quota). Bytes never touch the app server.
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { attachments, items } from "@/db/schema";
import { ItemError } from "@/lib/items";
import { getStorage } from "@/lib/storage";

// PRD §3.4: per-user quota ~10GB. Per-file cap keeps one paste from eating
// the quota; raise it when meeting audio (§4.15) actually needs more.
const QUOTA_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export type AttachmentRequest = {
  itemId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

function sanitizeFilename(filename: string): string {
  // Object keys keep the real filename for OneDrive-export friendliness,
  // minus path separators, reserved characters, and whitespace runs.
  const cleaned = filename
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "_")
    .trim();
  return cleaned.slice(0, 200) || "file";
}

export async function createAttachment(
  ownerId: string,
  req: AttachmentRequest
) {
  const storage = getStorage();
  if (!storage) {
    throw new ItemError(
      "bad_request",
      "file storage is not configured (R2 env vars missing)"
    );
  }
  if (!req.filename) throw new ItemError("bad_request", "filename is required");
  if (!req.contentType) {
    throw new ItemError("bad_request", "contentType is required");
  }
  if (!Number.isFinite(req.sizeBytes) || req.sizeBytes <= 0) {
    throw new ItemError("bad_request", "sizeBytes must be a positive number");
  }
  if (req.sizeBytes > MAX_FILE_BYTES) {
    throw new ItemError(
      "bad_request",
      `file exceeds the ${MAX_FILE_BYTES / (1024 * 1024)}MB per-file limit`
    );
  }

  const db = getDb();

  // Owner-scoped item check: attachments only hang off live, owned items.
  const parent = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.id, req.itemId),
        eq(items.ownerId, ownerId),
        sql`${items.deletedAt} IS NULL`
      )
    );
  if (parent.length === 0) throw new ItemError("not_found", "item not found");

  const used = await db
    .select({ total: sql<string>`coalesce(sum(${attachments.sizeBytes}), 0)` })
    .from(attachments)
    .where(eq(attachments.ownerId, ownerId));
  if (Number(used[0].total) + req.sizeBytes > QUOTA_BYTES) {
    throw new ItemError("bad_request", "storage quota exceeded (~10GB)");
  }

  const id = crypto.randomUUID();
  const filename = sanitizeFilename(req.filename);
  // Owner prefix makes per-user accounting and cleanup a prefix operation.
  const storageKey = `${ownerId}/${id}/${filename}`;

  await db.insert(attachments).values({
    id,
    ownerId,
    parentItemId: req.itemId,
    filename,
    contentType: req.contentType,
    sizeBytes: req.sizeBytes,
    storageKey,
  });

  const presigned = await storage.presignUpload(storageKey, req.contentType);
  return { id, filename, storageKey, ...presigned };
}

export async function listAttachments(ownerId: string, itemId: string) {
  return getDb()
    .select({
      id: attachments.id,
      filename: attachments.filename,
      contentType: attachments.contentType,
      sizeBytes: attachments.sizeBytes,
      storageKey: attachments.storageKey,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.ownerId, ownerId),
        eq(attachments.parentItemId, itemId)
      )
    );
}
