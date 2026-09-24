'use client';

import { useEffect } from 'react';

// Registra el service worker que hace la app instalable. Solo en producción: en desarrollo
// (HMR) un service worker activo estorba.
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
  }, []);
  return null;
}
