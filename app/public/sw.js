// Tess Console service worker (PWA install). Deliberately conservative:
// it ONLY caches content-hashed, immutable static assets (cache-first). Every
// dynamic/authenticated request goes straight to the network, so the SW can never
// serve a stale app shell or leak one user's state to another.
const CACHE = "tess-static-v3";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The network owns ALL API responses, including /api/media (banners, thumbnails,
  // video). These are dynamic and get re-rendered IN PLACE at the same path, so
  // caching them by extension (e.g. a banner's .png) served stale images forever.
  if (url.pathname.startsWith("/api/")) return;
  const isImmutable =
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:png|svg|ico|webmanifest|woff2?)$/.test(url.pathname);
  if (!isImmutable) return; // network owns everything dynamic / authenticated

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })(),
  );
});
