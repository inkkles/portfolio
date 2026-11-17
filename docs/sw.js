// Tiny service worker: only here so phones are able to show notifications.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('./'));
});
