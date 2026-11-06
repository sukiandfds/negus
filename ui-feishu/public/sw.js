const BUILD_ID = new URL(self.location.href).searchParams.get("build") || "development";
const CACHE_PREFIX = "negus-shell-";
const LEGACY_CACHE_PREFIX = "codex-collab-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const APP_SHELL = [
  "/index.html",
  "/manifest.webmanifest?v=negus-4",
  "/icons/negus-icon-v2.svg",
  "/icons/negus-icon-192-v2.png",
  "/icons/negus-icon-512-v2.png",
  "/icons/negus-icon-maskable-512-v2.png",
  "/icons/negus-apple-touch-icon-v2.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => (key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX)) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/events") return;

  if (request.mode === "navigate") {
    // Only application pages may fall back to the cached application shell.
    if (!["/", "/index.html"].includes(url.pathname)) return;
    const canonicalPath = "/index.html";
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(canonicalPath);
      const refresh = fetch(request).then((response) => {
        if (!response.ok) throw new Error(`navigation HTTP ${response.status}`);
        event.waitUntil(cache.put(canonicalPath, response.clone()).catch(error => console.warn("[negus:cache]", error)));
        return response;
      });
      event.waitUntil(refresh.catch(() => {}));
      return cached || refresh;
    }));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(error => console.warn("[negus:cache]", error)));
      }
      return response;
    })),
  );
});
