// OnePulso service worker — push notifications only.
//
// Deliberately NO fetch/caching handler: the app is a hashed-chunk SPA, and caching those
// chunks is exactly what produced "Failed to fetch dynamically imported module" after a
// redeploy. Being online-only is the right trade here; lazyWithRetry handles stale chunks.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Push ─────────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "OnePulso", body: "Tienes un nuevo mensaje", url: "/unibox" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    // Malformed payload — still show the default so the user is not left in silence.
  }

  const options = {
    body: data.body,
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    vibrate: [200, 100, 200],
    // A UNIQUE tag per notification. With one shared tag every new alert REPLACED the previous
    // one, so three leads replying showed only the last — the others vanished silently.
    tag: data.tag || `onepulso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    renotify: true,
    timestamp: Date.now(),
    data: { url: data.url || "/unibox" },
    actions: [
      { action: "open", title: "Abrir" },
      { action: "dismiss", title: "Cerrar" },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ── Tap ──────────────────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/unibox";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          // navigate() can reject if the client is not controlled yet; focusing still helps.
          return Promise.resolve(client.navigate(url)).catch(() => null).then(() => client.focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
