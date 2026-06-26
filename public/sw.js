// FURQAN Academy — Service Worker
// Provides offline caching for static assets and app shell

// Bump this on any public asset change (logos, manifest, favicons) so installed
// PWAs invalidate their precache on the next service-worker activation.
const CACHE_NAME = "furqan-v3-2026-06-28";
const _OFFLINE_URL = "/offline";

// Static assets to cache on install
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/favicon-32.png",
  "/favicon-16.png",
  "/apple-touch-icon.png",
  "/logo-192.png",
  "/logo-512.png",
];

// Install: cache shell assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for pages, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Skip API routes and Supabase calls
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return;

  // Static assets (images, fonts, CSS) — cache-first
  if (
    url.pathname.match(/\.(png|jpg|jpeg|svg|webp|ico|woff2?|css)$/) ||
    url.pathname.startsWith("/logo") ||
    url.pathname.startsWith("/favicon")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }))
    );
    return;
  }

  // Pages — network-first with offline fallback
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
  }
});

// Push: display Arabic-first, RTL notifications while the app is closed.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const parsed = event.data?.json();
    payload = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    payload = { title: "فُرقان", body: event.data?.text() ?? "" };
  }

  const { title = "فُرقان", body = "", url = "/student/dashboard", tag } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      dir: "rtl",
      lang: "ar",
      icon: "/logo-192.png",
      badge: "/logo-192.png",
      data: { url },
      tag,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url ?? "/student/dashboard",
    self.location.origin
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const existingClient = clients.find((client) => client.url === targetUrl) ?? clients[0];
      if (existingClient) {
        if (existingClient.url !== targetUrl) await existingClient.navigate(targetUrl);
        return existingClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
