// Client-side data-access seam (ADR-139). The UI calls `apiRequest(...)` and
// never `fetch('/api/...')` directly, so the transport is swappable:
//
//   - Cloud target: plain `fetch` to the Next `/api/*` route (identical to what
//     the call sites do today — this is a behavior-preserving indirection).
//   - Desktop target (no server): the Electron preload exposes a `DesktopDataBridge`
//     on `window.__ledgrDesktop`; requests go over IPC to the main process, which
//     dispatches the same `path`/`method`/`body` to the same `@/lib` functions the
//     `/api/*` routes wrap. No HTTP, no port.
//
// The `/api/*` REST surface stays the contract for BOTH transports, so the seam
// is thin and the two sides can't drift on shape. Parity lives in `@/lib` +
// components; only this file knows how a request physically travels.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

// The contract the desktop (Electron) preload bridge implements. Kept minimal
// and mirrors an HTTP call so the main-process router is a straight dispatch.
export interface DesktopDataBridge {
  request(req: {
    method: string;
    path: string;
    body?: unknown;
  }): Promise<{ ok: boolean; status: number; data: unknown }>;
}

declare global {
  interface Window {
    __ledgrDesktop?: DesktopDataBridge;
  }
}

export type ApiRequestInit = {
  method?: string;
  // JSON-serializable payload; stringified for the HTTP transport, passed as-is
  // to the IPC bridge. Presence flips the default method to POST.
  body?: unknown;
  signal?: AbortSignal;
  cache?: RequestCache;
};

// Fetch data through the active transport. Resolves with the parsed JSON body;
// throws `ApiError(status)` on a non-2xx response (callers `.catch` exactly as
// they handle a failed fetch today).
export async function apiRequest<T = unknown>(
  path: string,
  init: ApiRequestInit = {}
): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");

  const bridge =
    typeof window !== "undefined" ? window.__ledgrDesktop : undefined;
  if (bridge) {
    const res = await bridge.request({ method, path, body: init.body });
    if (!res.ok) throw new ApiError(res.status);
    return res.data as T;
  }

  const res = await fetch(path, {
    method,
    cache: init.cache,
    signal: init.signal,
    ...(init.body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(init.body),
        }
      : {}),
  });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}
