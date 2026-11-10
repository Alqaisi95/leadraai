/**
 * Service worker — push delivery only.
 *
 * Deliberately does not cache anything. Offline support is a separate feature
 * with its own correctness problems (stale inventory prices are worse than no
 * prices), and shipping a cache here by accident would create them silently.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return; // nothing sensible to show
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      dir: "rtl",
      lang: "ar",
      // Collapses repeats of the same event rather than stacking them.
      tag: payload.tag,
      data: { url: payload.url || "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/notifications";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open tab rather than opening a third copy of the app.
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
