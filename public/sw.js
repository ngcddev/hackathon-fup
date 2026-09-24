// Service worker de la PWA: instalable y con arranque sin conexión (OFF-01 a OFF-04).
//
// Regla de PII: NO se guarda en caché ninguna respuesta de /api. Solo se guardan:
//   1. Archivos estáticos de /_next/static (JS, CSS y fuentes con hash en el nombre): no traen datos.
//   2. El HTML de las páginas ya visitadas. Ese HTML es solo el armazón de la aplicación (menú, nombre
//      y rol de quien inició sesión); los indicadores se piden por /api y la última copia de los
//      agregados vive en el navegador (KpisProvider), nunca filas de pacientes (OFF-06).
//   3. /offline.html y los íconos.
// Al cerrar sesión la aplicación borra las páginas guardadas (OFF-09, clearOfflinePages).
//
// Estrategia: las páginas van primero a la red y solo usan la copia si no hay conexión, así nunca se
// muestra un armazón viejo estando en línea.

const VERSION = 'v2';
const PAGES_CACHE = `hslv-pages-${VERSION}`; // el prefijo "hslv-pages-" lo usa clearOfflinePages
const STATIC_CACHE = `hslv-static-${VERSION}`;
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png'];
const MAX_STATIC_ENTRIES = 300;
const NEVER_CACHE_PAGES = ['/login'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PAGES_CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== PAGES_CACHE && key !== STATIC_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// La caché de páginas se indexa solo por ruta: /agent?q=… usa la copia de /agent.
function pageKey(url) {
  return new Request(url.origin + url.pathname);
}

function isCacheablePage(url, response) {
  const type = response.headers.get('content-type') || '';
  return (
    response.status === 200 &&
    response.type === 'basic' &&
    !response.redirected &&
    type.includes('text/html') &&
    !NEVER_CACHE_PAGES.includes(url.pathname)
  );
}

async function navigate(event, url) {
  try {
    const response = await fetch(event.request);
    if (isCacheablePage(url, response)) {
      const copy = response.clone();
      event.waitUntil(caches.open(PAGES_CACHE).then((cache) => cache.put(pageKey(url), copy)));
    }
    return response;
  } catch {
    const cache = await caches.open(PAGES_CACHE);
    return (await cache.match(pageKey(url))) || (await cache.match('/offline.html')) || Response.error();
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES)).map((key) => cache.delete(key)));
}

async function staticAsset(event) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(cache.put(event.request, copy).then(() => trim(cache)));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event, url));
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(staticAsset(event));
  }
});
