// Ledgr service worker (slice 16). Deliberately conservative (PRD §4.5): it
// caches the app shell (offline fallback, icons, hashed build assets), never
// item data — the PWA promises no offline writes and no stale reads. Pulpit
// Ready (PRD §4.7, later slice) will pin verified documents into PIN_CACHE;
// the navigation fallback below already consults it, so that slice only adds
// the pin/verify protocol, not new routing.
//
// Bump VERSION on any change to this file's caching behavior; activate
// drops older shell caches (pins survive — they are user-meaningful data).
const VERSION = "v1";
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
  if (url.origin !== self.location.origin) return;

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
  // wins (Pulpit Ready seam), else the offline page.
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
  // Everything else (API, images, fonts): network only. The SW never caches
  // item data.
});
