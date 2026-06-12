// Storage-provider interface (PRD §3.4, CLAUDE.md provider-interface
// discipline). The app talks to this, never to R2 directly, so a future
// local build can swap in a filesystem provider. Bytes never proxy through
// the app server: uploads go browser → presigned PUT URL, reads come off
// the public CDN base.

export type PresignedUpload = {
  // PUT the file bytes here, Content-Type header required to match.
  uploadUrl: string;
  // Where the object serves from afterwards (CDN, long-cacheable).
  publicUrl: string;
};

export interface StorageProvider {
  presignUpload(key: string, contentType: string): Promise<PresignedUpload>;
  publicUrl(key: string): string;
  deleteObject(key: string): Promise<void>;
}
