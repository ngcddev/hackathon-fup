'use client';

import type { ReactNode } from 'react';
import type { KpisResponse } from '@/lib/types/api';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { ALL_HOSPITAL, useKpis } from './KpisProvider';

interface KpiGateProps {
  label: string; // "camas": va en "Cargando camas…" y "No pudimos cargar camas"
  children: (data: KpisResponse) => ReactNode;
}

// Muestra carga o error mientras no haya indicadores; con datos (o con la copia local) pinta la vista.
export function KpiGate({ label, children }: KpiGateProps) {
  const { data, loading, error, reload, service } = useKpis();
  // Mientras llega la respuesta del nuevo servicio no se muestran las cifras del anterior.
  if (data && (data.service_filter ?? ALL_HOSPITAL) === service) return <>{children(data)}</>;
  if (loading) return <LoadingState label={label} />;
  return <ErrorState label={label} message={error ?? undefined} onRetry={reload} />;
}
