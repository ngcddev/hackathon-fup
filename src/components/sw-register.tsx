'use client';

import { useEffect } from 'react';

// Registra el service worker que hace la app instalable y le permite abrir sin conexión. Solo en
// producción: en desarrollo (HMR) un service worker activo estorba. Para probarlo: `npm run build`
// y `npm start`, o el despliegue en Vercel.
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
  }, []);
  return null;
}

// Al cerrar sesión se borran las páginas guardadas por el service worker (OFF-09). Se conservan
// /offline.html y los íconos, que no tienen datos y hacen falta para la siguiente sesión sin red.
export async function clearOfflinePages() {
  if (typeof caches === 'undefined') return;
  try {
    const names = (await caches.keys()).filter((name) => name.startsWith('hslv-pages-'));
    await Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        await Promise.all(
          requests.map((request) => {
            const { pathname } = new URL(request.url);
            const isStatic = pathname === '/offline.html' || pathname.startsWith('/icons/');
            return isStatic ? undefined : cache.delete(request);
          }),
        );
      }),
    );
  } catch {
    // Sin acceso a la caché: no hay nada que borrar.
  }
}
