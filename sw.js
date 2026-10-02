self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Permite que las peticiones vayan directo a la red (Express/DB)
  event.respondWith(fetch(event.request));
});
