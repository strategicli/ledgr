// Ledgr service worker (slices 16 + 18). Deliberately conservative (PRD
// §4.5): it caches the app shell (offline fallback, icons, hashed build
// assets), never item data on its own — the PWA promises no offline writes
// and no stale reads. The one exception is deliberate: Save Offline (PRD
// §4.7) pins verified documents (and their images) into PIN_CACHE from the
// page; this worker only ever *reads* that cache, as a fallback when the
// network fails.
//
// Bump VERSION on any change to this file's caching behavior; activate
// drops older shell caches (pins survive — they are user-meaningful data).
const VERSION = "v2";
const SHELL_CACHE = `ledgr-shell-${VERSION}`;
const PIN_CACHE = "ledgr-pin-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("ledgr-shell-") && k !== SHELL_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Cross-origin GETs (R2 attachment images): network, falling back to a
  // pinned copy if Save Offline stored one. Never cached here.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(request).catch(async () => {
        const pinned = await caches
          .open(PIN_CACHE)
          .then((cache) => cache.match(request));
        return pinned ?? Response.error();
      })
    );
    return;
  }

  // Hashed immutable build assets: cache-first. Safe because the hash in the
  // path changes with the content; activate clears old shell caches.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // Navigations: always network (fresh data); when it fails, a pinned copy
  // wins (Save Offline seam), else the offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const pinned = await caches
          .open(PIN_CACHE)
          .then((cache) => cache.match(request, { ignoreSearch: true }));
        if (pinned) return pinned;
        const offline = await caches.match(OFFLINE_URL);
        return offline ?? Response.error();
      })
    );
  }
  // Everything else (API, same-origin images, fonts): network, falling back
  // to a pinned copy when one exists. The SW itself never writes item data
  // to any cache.
  event.respondWith(
    fetch(request).catch(async () => {
      const pinned = await caches
        .open(PIN_CACHE)
        .then((cache) => cache.match(request));
      return pinned ?? Response.error();
    })
  );
});
