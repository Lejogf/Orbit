// Service worker: shows charge alerts pushed by the Flow API, even when the app
// is closed, and opens the right screen when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Flow', body: 'You have a new alert.', href: '/alerts', tag: 'flow' };
  try {
    data = { ...data, ...event.data.json() };
  } catch (_) {
    // Keep the defaults.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { href: data.href },
      // Money alerts stay until the customer sees them.
      requireInteraction: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || '/alerts';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(href);
          return client.focus();
        }
      }
      return self.clients.openWindow(href);
    }),
  );
});
