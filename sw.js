/* Caches the app shell and each bank image/JSON the first time it is opened, so the app works offline. */
const CACHE = "certification-killer-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.json", "bank/index.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(event.request).then((hit) => {
        if (hit) return hit;
        return fetch(event.request).then((res) => {
          if (res.ok && new URL(event.request.url).origin === self.location.origin) {
            cache.put(event.request, res.clone());
          }
          return res;
        }).catch(() => hit);
      })
    )
  );
});
