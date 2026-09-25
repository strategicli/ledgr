// Provider selection. Returns null when storage isn't configured so callers can
// answer "storage not configured" instead of crashing; the rest of the app must
// work without it.
//
//   1. R2, whenever its four settings exist. Every install that has a bucket
//      today keeps it, unchanged.
//   2. Otherwise the install's own disk, but ONLY under the supervisor (a
//      self-hosted install, which has a data folder that persists). Never on
//      Vercel: a serverless function's disk is scratch space that vanishes.
//   3. Otherwise null, as before.
import { LocalDiskProvider, localFilesDir, localSigningKeyPath } from "./local";
import { R2Provider } from "./r2";
import type { StorageProvider } from "./types";

export type { PresignedUpload, StorageProvider } from "./types";
export { LocalDiskProvider } from "./local";

// No caching: constructing an R2Provider is a local, no-I/O AwsClient signer
// setup, not worth memoizing, and env can legitimately change mid-process
// (dev restarts, tests injecting fake credentials) — a cached instance would
// silently keep using stale config.
//
// FOUR vars, not five: R2_PUBLIC_BASE_URL is gone with the private bucket
// (ADR-231). There is no public base to point at, which also means one less
// thing to rotate when the storage layout changes.
export function getStorage(): StorageProvider | null {
  const {
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET: bucket,
    R2_ENDPOINT: endpoint,
  } = process.env;
  if (accessKeyId && secretAccessKey && bucket && endpoint) {
    return new R2Provider({ accessKeyId, secretAccessKey, bucket, endpoint });
  }
  return localDiskStorage();
}

/**
 * The install's own files folder as a provider, or null where there is none.
 * Separate from getStorage so a surface can ask about files left on disk even
 * after R2 has been switched on (Build → Files warns about them).
 */
export function localDiskStorage(): LocalDiskProvider | null {
  const dir = process.env.LEDGR_SUPERVISOR_DIR;
  if (!dir || process.env.VERCEL || process.env.VERCEL_ENV) return null;
  return new LocalDiskProvider(localFilesDir(dir), localSigningKeyPath(dir));
}

/**
 * An absolute form of a storage URL, for handing to something that is not the
 * browser that asked: an agent that will PUT with curl, a machine caller. R2
 * URLs are already absolute and pass through untouched.
 */
export function absoluteStorageUrl(url: string, origin: string | null): string {
  // Only a local-disk URL is relative; nothing below runs for R2.
  if (!url.startsWith("/")) return url;
  const base = origin || process.env.NEXT_PUBLIC_APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
  return new URL(url, base).toString();
}

/**
 * The address a request reached this app on. Plain http unless a proxy in
 * front (Tailscale serve, a tunnel) says otherwise: a supervised install, the
 * only kind with local-disk storage, serves plain http itself.
 */
export function requestOriginFrom(h: { get(name: string): string | null }): string | null {
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : null;
}
