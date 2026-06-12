// Provider selection. Returns null when storage isn't configured (R2 env
// vars absent) so callers can answer "storage not configured" instead of
// crashing; the rest of the app must work without it.
import { R2Provider } from "./r2";
import type { StorageProvider } from "./types";

export type { PresignedUpload, StorageProvider } from "./types";

let cached: StorageProvider | null = null;

export function getStorage(): StorageProvider | null {
  if (cached) return cached;
  const {
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET: bucket,
    R2_ENDPOINT: endpoint,
    R2_PUBLIC_BASE_URL: publicBaseUrl,
  } = process.env;
  // A miss isn't cached: config may arrive later (env set between dev
  // restarts, tests injecting fake credentials).
  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint || !publicBaseUrl) {
    return null;
  }
  cached = new R2Provider({
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    publicBaseUrl,
  });
  return cached;
}
