const CACHE_NAME = "mi-express-biryani-pwa-v2";
const STATIC_ASSETS = ["./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache API/database responses or cross-origin media. Admin changes must reach customers.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Network-first for app pages so deployed code is picked up quickly.
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match("./index.html")))
    );
    return;
  }

  // Static PWA assets can use cache-first. Other same-origin assets stay network-first.
  event.respondWith(
    fetch(req, { cache: "no-store" }).catch(() => caches.match(req))
  );
});
