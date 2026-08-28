// Attachment metadata + presigned upload flow (PRD §3.4, slice 5).
// The row is created at presign time, before the browser PUTs the bytes to
// R2, so every object in the bucket has a metadata row to be found by (an
// orphaned row for an upload that never finished is harmless metadata; an
// untracked object would leak quota). Bytes never touch the app server.
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { attachments, items } from "@/db/schema";
import { ItemError } from "@/lib/items";
import { getStorage, type StorageProvider } from "@/lib/storage";
import { attachmentUrl } from "./attachment-url";

// PRD §3.4: per-user quota ~10GB. Per-file cap keeps one paste from eating
// the quota. Audio/video (meeting recording v1b, ADR-088) gets a larger cap —
// a multi-hour recording is hundreds of MB, and the audio-retention purge
// (ADR-089) reclaims it after the transcript is produced, so it doesn't sit in
// the quota forever. (R2 presigned single PUT supports up to 5GB.)
export const QUOTA_BYTES = 10 * 1024 * 1024 * 1024;
// Warn before the wall, not at it (2026-08-28, Tyler's ask). The 10GB cap above
// happens to be exactly Cloudflare R2's free storage tier, so crossing it costs
// real money rather than just failing — worth knowing at 80% instead of finding
// out when an upload is refused. `critical` is the "stop and clear something
// out" line; the audio-retention purge (ADR-089) is usually what frees the most.
export const QUOTA_WARN_FRACTION = 0.8;
export const QUOTA_CRITICAL_FRACTION = 0.95;

export type StorageUsage = {
  usedBytes: number;
  quotaBytes: number;
  fraction: number;
  level: "ok" | "warn" | "critical";
  // Ready-to-show text, or null while there is nothing worth saying. Built here
  // so every surface (upload response, MCP tool, any future settings gauge)
  // words it the same way.
  message: string | null;
};

function gb(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

// Pure so it is node-testable without a DB, the same discipline the attachment
// URL helpers follow.
export function storageUsageFrom(usedBytes: number): StorageUsage {
  const fraction = usedBytes / QUOTA_BYTES;
  const level =
    fraction >= QUOTA_CRITICAL_FRACTION
      ? "critical"
      : fraction >= QUOTA_WARN_FRACTION
        ? "warn"
        : "ok";
  const pct = Math.round(fraction * 100);
  const message =
    level === "ok"
      ? null
      : `${gb(usedBytes)} of ${gb(QUOTA_BYTES)} used (${pct}%)` +
        (level === "critical"
          ? " — almost full. Uploads stop at 100%, and this is also Cloudflare R2's free tier."
          : " — approaching the limit, which is also Cloudflare R2's free tier.");
  return { usedBytes, quotaBytes: QUOTA_BYTES, fraction, level, message };
}

// Current usage for one owner. Standalone for surfaces that want it without
// uploading anything; the upload path does NOT call this, because
// reserveAttachment already has the sum in hand.
export async function getStorageUsage(ownerId: string): Promise<StorageUsage> {
  const rows = await getDb()
    .select({ total: sql<string>`coalesce(sum(${attachments.sizeBytes}), 0)` })
    .from(attachments)
    .where(eq(attachments.ownerId, ownerId));
  return storageUsageFrom(Number(rows[0].total));
}
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_AV_FILE_BYTES = 2 * 1024 * 1024 * 1024;

function maxFileBytesFor(contentType: string): number {
  return /^(audio|video)\//i.test(contentType) ? MAX_AV_FILE_BYTES : MAX_FILE_BYTES;
}

export type AttachmentRequest = {
  itemId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

// Stable attachment addresses (ADR-228) live in ./attachment-url — pure and
// client-safe, since client components and the person-image helper need them and
// must not pull the DB in. Re-exported here so server callers have one import.
export {
  attachmentUrl,
  parseAttachmentUrl,
  rewriteProviderUrlsInText,
  stableAttachmentUrl,
} from "./attachment-url";

// One attachment by id, owner-scoped.
export async function getAttachment(
  ownerId: string,
  id: string
): Promise<{ filename: string; contentType: string } | null> {
  const rows = await getDb()
    .select({
      filename: attachments.filename,
      contentType: attachments.contentType,
    })
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.ownerId, ownerId)))
    .limit(1);
  return rows[0] ?? null;
}

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

// Validate the request, run the owner/quota/cap checks, and insert the metadata
// row — everything that must happen before bytes exist, shared by both upload
// paths. Returns the resolved storage provider + the row's identifiers. The
// caller then either presigns (browser PUTs the bytes) or putObjects them
// server-side, so the two paths can't drift on quota, cap, or owner scoping.
async function reserveAttachment(
  ownerId: string,
  req: AttachmentRequest
): Promise<{
  storage: StorageProvider;
  id: string;
  filename: string;
  storageKey: string;
  usage: StorageUsage;
}> {
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
  const maxFileBytes = maxFileBytesFor(req.contentType);
  if (req.sizeBytes > maxFileBytes) {
    throw new ItemError(
      "bad_request",
      `file exceeds the ${Math.round(maxFileBytes / (1024 * 1024))}MB per-file limit`
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
  const usedAfter = Number(used[0].total) + req.sizeBytes;
  if (usedAfter > QUOTA_BYTES) {
    throw new ItemError("bad_request", "storage quota exceeded (~10GB)");
  }
  // Computed from the sum already fetched above — no second query on the upload
  // path just to say "you're getting close".
  const usage = storageUsageFrom(usedAfter);

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

  return { storage, id, filename, storageKey, usage };
}

export async function createAttachment(
  ownerId: string,
  req: AttachmentRequest
) {
  const { storage, id, filename, storageKey, usage } = await reserveAttachment(
    ownerId,
    req
  );
  const presigned = await storage.presignUpload(storageKey, req.contentType);
  // fileUrl is the one to put in a body. publicUrl is kept as a FIELD purely
  // for API/MCP back-compat (ADR-183 carve-out) and is now the same stable
  // address — with a private bucket (ADR-231) there is no world-readable URL
  // left for it to mean. Callers that need the bytes use presignDownload.
  const fileUrl = attachmentUrl(id);
  return { id, filename, storageKey, fileUrl, publicUrl: fileUrl, usage, ...presigned };
}

// Server-side attachment creation: the bytes are already in hand (no browser in
// the loop), so we reserve the row then putObject straight to R2. This is the
// path the MCP attach_file tool uses (ADR-150) — an AI can't PUT to a presigned
// URL, so it hands Ledgr the bytes and the server does the write. Same
// validation/quota/owner checks as the presign path via reserveAttachment; the
// row's sizeBytes is the actual byte length. Returns the row id + the stable
// address for embedding in the item body.
export async function createAttachmentFromBytes(
  ownerId: string,
  req: { itemId: string; filename: string; contentType: string; bytes: Uint8Array }
): Promise<{
  id: string;
  filename: string;
  storageKey: string;
  publicUrl: string;
  fileUrl: string;
  usage: StorageUsage;
}> {
  const { storage, id, filename, storageKey, usage } = await reserveAttachment(ownerId, {
    itemId: req.itemId,
    filename: req.filename,
    contentType: req.contentType,
    sizeBytes: req.bytes.byteLength,
  });
  await storage.putObject(storageKey, req.bytes, req.contentType);
  const fileUrl = attachmentUrl(id);
  return { id, filename, storageKey, publicUrl: fileUrl, fileUrl, usage };
}

// One attachment by id for the /files route (ADR-231). NOT owner-scoped on
// purpose — the route itself decides access, either by owner session or by a
// share token — so this returns the owner and parent id it needs to make that
// call, and the route must never skip it.
export async function getAttachmentForRead(
  id: string
): Promise<{ ownerId: string; parentItemId: string; storageKey: string } | null> {
  const rows = await getDb()
    .select({
      ownerId: attachments.ownerId,
      parentItemId: attachments.parentItemId,
      storageKey: attachments.storageKey,
    })
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);
  return rows[0] ?? null;
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

// --- audio retention (meeting recording v1b, ADR-089) ----------------------
// Audio is transient: once a transcript is produced from it, the audio has done
// its job (the transcript is the artifact Ledgr keeps), so it's marked for
// purge and the daily cron reclaims the bytes. Default 30-day window (Brandon's
// call) — a buffer to catch a bad transcription before the source is gone.
export const AUDIO_RETENTION_DAYS = 30;

// Stamp an attachment for purge N days out (owner-scoped). Called when a
// transcript completes from the audio (transcription-service). Idempotent.
export async function markAudioForPurge(
  ownerId: string,
  attachmentId: string,
  days = AUDIO_RETENTION_DAYS
): Promise<void> {
  await getDb()
    .update(attachments)
    .set({ purgeAfter: sql`now() + make_interval(days => ${days})` })
    .where(and(eq(attachments.id, attachmentId), eq(attachments.ownerId, ownerId)));
}

// Delete one attachment now: R2 bytes then the row (delete-now / purge share
// this). Owner-scoped. Storage injected for testability (default getStorage()).
export async function deleteAttachment(
  ownerId: string,
  id: string,
  storage = getStorage()
): Promise<void> {
  const rows = await getDb()
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.ownerId, ownerId)));
  if (rows.length === 0) throw new ItemError("not_found", "attachment not found");
  // Bytes first: if the object delete fails the row stays and we retry, so we
  // never orphan R2 bytes behind a deleted row.
  if (storage) await storage.deleteObject(rows[0].storageKey);
  await getDb()
    .delete(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.ownerId, ownerId)));
}

// Purge every attachment whose retention window has passed (the daily cron).
// R2 bytes then the row, per-item, so one failed object can't strand the rest.
// Skips when storage is unconfigured (then there are no R2 bytes to reclaim).
export async function purgeExpiredAudio(
  storage = getStorage()
): Promise<{ purgedAudio: number; failed: number }> {
  if (!storage) return { purgedAudio: 0, failed: 0 };
  const db = getDb();
  const due = await db
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(sql`${attachments.purgeAfter} is not null and ${attachments.purgeAfter} < now()`);
  let purgedAudio = 0;
  let failed = 0;
  for (const a of due) {
    try {
      await storage.deleteObject(a.storageKey);
      await db.delete(attachments).where(eq(attachments.id, a.id));
      purgedAudio += 1;
    } catch {
      failed += 1; // retried next run; the row + bytes stay
    }
  }
  return { purgedAudio, failed };
}
