/* AquaFlow terminal service worker (PRD 5.5: the POS must open offline).
 *
 * - Navigations to /terminal: network first, cached copy when offline.
 * - Next.js static assets (/_next/static/*, hashed and immutable): cache first.
 * - API calls are never cached here; the terminal keeps its own offline copy
 *   of the price list and queues sales in IndexedDB.
 */
const CACHE = "aquaflow-shell-v1";
const SHELL = ["/terminal"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  if (req.mode === "navigate" && url.pathname.startsWith("/terminal")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/terminal", copy));
          }
          return res;
        })
        .catch(() => caches.match("/terminal").then((hit) => hit || Response.error()))
    );
  }
});
