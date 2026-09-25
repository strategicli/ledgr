// Storage-provider interface (PRD §3.4, CLAUDE.md provider-interface
// discipline). The app talks to this, never to R2 directly. Two providers:
// Cloudflare R2 (./r2) and the install's own disk (./local, for a self-hosted
// install with no bucket). With R2, bytes never proxy through the app server:
// uploads go browser → presigned PUT URL. On local disk the app IS the storage,
// so the signed URLs point back at this app (/files/local/<key>).
//
// The bucket is PRIVATE (ADR-231, 2026-08-28). There is no unsigned URL to any
// object, so `publicUrl` is gone: every read is a short-lived signed GET via
// presignDownload. What goes in an item body is still ADR-228's stable
// `/files/<id>` address; that route now decides WHO may read (the owner, or an
// anonymous viewer holding a live share token for the parent item) and signs
// the redirect. Bytes still never pass through the app server — it is a 302 to
// R2, never a proxy.
//
// This strengthens ADR-228 rather than undoing it: with no public base URL
// there is one less storage detail that can leak into stored content.

export type PresignedUpload = {
  // PUT the file bytes here, Content-Type header required to match.
  uploadUrl: string;
};

export interface StorageProvider {
  // Which backend. Almost nothing should care; the exception is the one thing
  // only a cloud bucket can do: hand a transcription vendor a URL it can reach
  // from the internet.
  readonly kind: "r2" | "local";
  // `sizeBytes` is the size the quota was checked against. R2 ignores it (its
  // presigned PUT can't bind a length); the local disk refuses anything larger.
  presignUpload(key: string, contentType: string, sizeBytes?: number): Promise<PresignedUpload>;
  // Server-side write, for bytes that originate server-side with no browser in
  // the loop — email-in attachments from Graph (slice 26), the MCP attach_file
  // tool (ADR-150).
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  // A short-lived signed GET for one object: how a browser or a vendor reads
  // bytes. R2 returns an absolute URL. The local disk returns a root-relative
  // one (this app serves the bytes), so pass it only to something that
  // resolves it against this app's address.
  presignDownload(key: string, ttlSeconds?: number): Promise<string>;
  // Server-side read, for code that wants the bytes itself (the OneDrive
  // export, the share-target stash). Shaped like a fetch of a signed URL, so a
  // missing object is a 404 response, not a throw.
  getObject(key: string): Promise<Response>;
  deleteObject(key: string): Promise<void>;
  // Enumerate stored objects under a key prefix (ADR-237): what the orphan
  // sweep reconciles against the attachments table. Owner-scoped callers pass
  // `${ownerId}/`. Names only what exists in storage — deciding which of those
  // are orphans is the caller's job, against the DB.
  listObjects(prefix: string): Promise<{ key: string; sizeBytes: number }[]>;
}
