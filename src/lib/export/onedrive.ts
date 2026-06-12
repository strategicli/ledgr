// OneDrive export target over Microsoft Graph (slice 17, ADR-017).
// App-only client credentials (the PRD §5.1 split: unattended jobs never
// see an MFA prompt), addressing Brandon's drive as /users/{upn}/drive.
// Plain fetch, no Graph SDK (CLAUDE.md rule 5); the token is cached in
// module scope for the life of the lambda.
import type { ExportTarget } from "./target";

export type GraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  // The drive owner's UPN (Brandon's email) and the folder inside that
  // drive that holds the export tree (e.g. "Ledgr" -> /Ledgr/Export/...).
  upn: string;
  exportRoot: string;
};

// Null when the Azure app registration isn't configured yet; callers
// surface "not configured" instead of crashing (same posture as storage).
export function getGraphConfig(): GraphConfig | null {
  const {
    GRAPH_TENANT_ID: tenantId,
    GRAPH_CLIENT_ID: clientId,
    GRAPH_CLIENT_SECRET: clientSecret,
    ONEDRIVE_EXPORT_UPN: upn,
  } = process.env;
  if (!tenantId || !clientId || !clientSecret || !upn) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    upn,
    exportRoot: process.env.ONEDRIVE_EXPORT_ROOT || "Ledgr",
  };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(cfg: GraphConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const res = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Graph token request failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
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

  // One retry on throttling (429/503 with Retry-After), capped at 15s so a
  // long throttle fails the item into error_log and the next run retries.
  private async graphFetch(url: string, init: RequestInit): Promise<Response> {
    const token = await getToken(this.cfg);
    const withAuth = () =>
      fetch(url, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      });
    let res = await withAuth();
    if (res.status === 429 || res.status === 503) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 15);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await withAuth();
    }
    return res;
  }

  async putFile(path: string, content: Uint8Array | string): Promise<void> {
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    if (bytes.byteLength <= SIMPLE_UPLOAD_MAX) {
      const res = await this.graphFetch(this.itemUrl(path, ":/content"), {
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
    const session = await this.graphFetch(
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
    const res = await this.graphFetch(this.itemUrl(path, ""), {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Graph delete failed (${res.status}) for ${path}`);
    }
  }
}
