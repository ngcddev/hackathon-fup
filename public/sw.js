// Service worker mínimo para que la app sea instalable.
//
// Regla de PII: NO se guarda en caché ninguna respuesta de la API ni de las páginas autenticadas
// (contienen datos del hospital). Lo único que se cachea es la página estática /offline.html y los
// íconos. Si una navegación falla por falta de red, se muestra /offline.html; todo lo demás va
// directo a la red.

const CACHE = 'hslv-shell-v1';
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.mode !== 'navigate') return;
  event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
});
