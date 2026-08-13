const CACHE = "vigilkline-v3";
self.addEventListener("install", event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(["/", "/manifest.webmanifest", "/favicon.svg"])).then(() => self.skipWaiting())
));
self.addEventListener("activate", event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
));
// Network first keeps the live app and its current style bundle fresh. Cached
// files are only used when a store has no signal.
self.addEventListener("fetch", event => event.respondWith(fetch(event.request).catch(() => caches.match(event.request))));
