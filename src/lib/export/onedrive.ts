// OneDrive export target over Microsoft Graph (slice 17, ADR-017).
// App-only client credentials (the PRD §5.1 split: unattended jobs never
// see an MFA prompt), addressing Brandon's drive as /users/{upn}/drive.
// Token acquisition and the throttled fetch now live in the shared Graph
// client (src/lib/graph, slice 21/ADR-022); this file keeps only the
// OneDrive-specific path building and upload-session logic.
import { getGraphCredentials, graphFetch } from "@/lib/graph/client";
import type { ExportTarget } from "./target";

export type GraphConfig = {
  // The drive owner's UPN (Brandon's email) and the folder inside that
  // drive that holds the export tree (e.g. "Ledgr" -> /Ledgr/Export/...).
  upn: string;
  exportRoot: string;
};

// Null when the Azure app registration isn't configured yet; callers
// surface "not configured" instead of crashing (same posture as storage).
// Credentials (tenant/client/secret) are detected by the shared client; this
// adds the export-specific drive owner and root folder.
export function getGraphConfig(): GraphConfig | null {
  const upn = process.env.ONEDRIVE_EXPORT_UPN;
  if (!getGraphCredentials() || !upn) return null;
  return {
    upn,
    exportRoot: process.env.ONEDRIVE_EXPORT_ROOT || "Ledgr",
  };
}

// Upload-session chunks must be multiples of 320 KiB; 16 of them is 5 MiB.
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
const CHUNK_SIZE = 16 * 320 * 1024;

export class OneDriveExportTarget implements ExportTarget {
  constructor(private cfg: GraphConfig) {}

  // drive-relative API URL for a path inside the export tree. Each segment
  // is encoded; the :/ pattern addresses items by path. Graph auto-creates
  // intermediate folders on upload.
  private itemUrl(path: string, suffix: string): string {
    const full = [this.cfg.exportRoot, "Export", ...path.split("/")]
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      this.cfg.upn
    )}/drive/root:/${full}${suffix}`;
  }

  async putFile(path: string, content: Uint8Array | string): Promise<void> {
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    if (bytes.byteLength <= SIMPLE_UPLOAD_MAX) {
      const res = await graphFetch(this.itemUrl(path, ":/content"), {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: bytes as BodyInit,
      });
      if (!res.ok) {
        throw new Error(`Graph upload failed (${res.status}) for ${path}`);
      }
      return;
    }

    // Large files (attachment copies can reach 100MB): upload session.
    const session = await graphFetch(
      this.itemUrl(path, ":/createUploadSession"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item: { "@microsoft.graph.conflictBehavior": "replace" },
        }),
      }
    );
    if (!session.ok) {
      throw new Error(
        `Graph upload session failed (${session.status}) for ${path}`
      );
    }
    const { uploadUrl } = (await session.json()) as { uploadUrl: string };
    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_SIZE) {
      const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
      // The session URL is pre-authorized; no bearer header.
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "content-length": String(chunk.byteLength),
          "content-range": `bytes ${offset}-${offset + chunk.byteLength - 1}/${bytes.byteLength}`,
        },
        body: chunk as BodyInit,
      });
      if (!res.ok) {
        throw new Error(
          `Graph chunk upload failed (${res.status}) for ${path} at ${offset}`
        );
      }
    }
  }

  async deleteFile(path: string): Promise<void> {
    const res = await graphFetch(this.itemUrl(path, ""), {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Graph delete failed (${res.status}) for ${path}`);
    }
  }
}
