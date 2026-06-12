// Export-target interface (slice 17). The engine writes the export tree
// through this, never to Graph directly, mirroring the storage-provider
// discipline (CLAUDE.md): OneDrive is the production target, the local
// filesystem target verifies the engine against Neon without credentials
// and is the Phase 4 local-build seam.
//
// Paths are relative to the export root (e.g. "task/2026/foo-1a2b3c4d.md",
// "_archive/note/2025/...", "_attachments/<itemId>/<file>"), always
// forward-slash. There is no moveFile: the incremental selection only ever
// picks items whose content changed (soft delete and restore both bump
// updated_at), so a relocation is always a fresh put + delete of the old
// path.

export interface ExportTarget {
  putFile(path: string, content: Uint8Array | string): Promise<void>;
  // Must succeed when the file is already gone.
  deleteFile(path: string): Promise<void>;
}
