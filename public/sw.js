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
    icon: "/pwa-192x192.png?v=2",
    // Android paints the badge from its alpha only: a white star, not the coloured tile.
    badge: "/badge-96x96.png",
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
// With the app already open: focus it and ask it to open the conversation itself ("open-url"),
// so it does not reload. If it does not answer (an old version of the app), navigate it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/unibox";

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = all.find((c) => c.url.startsWith(self.location.origin));
    if (!client) {
      await self.clients.openWindow(url);
      return;
    }
    try { await client.focus(); } catch (e) { /* focusing is best-effort */ }
    const answered = await new Promise((resolve) => {
      try {
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(false), 1500);
        channel.port1.onmessage = () => { clearTimeout(timer); resolve(true); };
        client.postMessage({ type: "open-url", url }, [channel.port2]);
      } catch (e) {
        resolve(false);
      }
    });
    if (!answered) {
      // navigate() can reject if the client is not controlled yet.
      try { await client.navigate(url); } catch (e) { /* nothing else to do */ }
    }
  })());
});
