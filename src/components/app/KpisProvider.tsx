'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ClientApiError, apiGet, errorMessage } from '@/lib/api/client';
import type { KpisResponse } from '@/lib/types/api';

export const ALL_HOSPITAL = 'Todo el hospital';

// Copia local de la última respuesta (OFF-03). Solo trae agregados: sin nombres ni ids de pacientes (OFF-06).
const SNAPSHOT_KEY = 'sgh_kpis_snapshot_v1';

interface Snapshot {
  service: string;
  data: KpisResponse;
}

function readSnapshot(service: string): KpisResponse | null {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    const snap = raw ? (JSON.parse(raw) as Snapshot) : null;
    return snap && snap.service === service ? snap.data : null;
  } catch {
    return null;
  }
}

function writeSnapshot(service: string, data: KpisResponse) {
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ service, data } satisfies Snapshot));
  } catch {
    // Sin almacenamiento local: la copia offline simplemente no existe.
  }
}

// Al cerrar sesión no se deja copia local de indicadores en un dispositivo compartido.
export function clearSnapshot() {
  try {
    window.localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // Nada que limpiar.
  }
}

interface KpisContextValue {
  data: KpisResponse | null;
  loading: boolean;
  error: string | null;
  stale: boolean; // se muestran datos de la copia local porque no hay conexión
  reload: () => void;
  service: string; // ALL_HOSPITAL o el nombre exacto que espera la API
  setService: (service: string) => void;
  services: string[]; // nombres exactos de los servicios conocidos
}

const KpisContext = createContext<KpisContextValue | null>(null);

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function KpisProvider({ children }: { children: ReactNode }) {
  const [service, setService] = useState(ALL_HOSPITAL);
  const [data, setData] = useState<KpisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [services, setServices] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Reinicia el estado de carga al cambiar el servicio; la respuesta llega de forma asíncrona.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    const url = service === ALL_HOSPITAL ? '/api/kpis' : `/api/kpis?service=${encodeURIComponent(service)}`;
    apiGet<KpisResponse>(url)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStale(false);
        writeSnapshot(service, result);
        if (result.service_filter === null) setServices(result.occupancy.by_service.map((s) => s.service));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Solo una falla de red (sin conexión) usa la copia local; un error del servidor se muestra como error.
        const snapshot = e instanceof ClientApiError && e.code === 'NETWORK' ? readSnapshot(service) : null;
        if (snapshot) {
          setData(snapshot);
          setStale(true);
          if (snapshot.service_filter === null) setServices(snapshot.occupancy.by_service.map((s) => s.service));
        } else {
          setError(errorMessage(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [service, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const value = useMemo(
    () => ({ data, loading, error, stale, reload, service, setService, services }),
    [data, loading, error, stale, reload, service, services],
  );
  return <KpisContext.Provider value={value}>{children}</KpisContext.Provider>;
}

export function useKpis() {
  const value = useContext(KpisContext);
  if (!value) throw new Error('useKpis debe usarse dentro de KpisProvider.');
  return value;
}
