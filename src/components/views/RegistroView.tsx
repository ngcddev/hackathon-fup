'use client';

import { useState } from 'react';
import { useApi } from '@/components/app/useApi';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { fmtDateTime, fmtInt } from '@/components/ui/format';
import type { AdminLogAction, AdminLogEntry, LogType, LogsResponse, QueryLogEntry, QueryLogStatus } from '@/lib/types/api';

const STATUS: Record<QueryLogStatus, string> = { ok: 'Correcto', rejected: 'Rechazado', error: 'Error' };
const ACTION: Record<AdminLogAction, string> = {
  create: 'Usuario creado',
  role_change: 'Cambio de rol',
  deactivate: 'Usuario desactivado',
  reactivate: 'Usuario activado',
  password_reset: 'Contraseña restablecida',
};

const queryColumns: Column<QueryLogEntry>[] = [
  { key: 'date', label: 'Fecha', value: (e) => e.asked_at, render: (e) => fmtDateTime(e.asked_at) },
  { key: 'user', label: 'Usuario', value: (e) => e.user.full_name },
  { key: 'question', label: 'Pregunta', value: (e) => e.question, render: (e) => <span className="block max-w-[420px] whitespace-normal">{e.question}</span> },
  { key: 'origin', label: 'Origen', value: (e) => (e.origin === 'predefined' ? 'Predefinida' : `IA${e.llm_provider ? ` (${e.llm_provider})` : ''}`) },
  { key: 'status', label: 'Resultado', bold: true, value: (e) => STATUS[e.status] },
  { key: 'rows', label: 'Filas', align: 'right', value: (e) => e.row_count, render: (e) => (e.row_count === null ? '—' : fmtInt(e.row_count)) },
  { key: 'ms', label: 'Duración (ms)', align: 'right', value: (e) => e.duration_ms, render: (e) => fmtInt(e.duration_ms) },
];

const queryFilters: TableFilter<QueryLogEntry>[] = [
  { label: 'Todos los usuarios', get: (e) => e.user.full_name },
  { label: 'Todos los resultados', get: (e) => STATUS[e.status] },
];

const adminColumns: Column<AdminLogEntry>[] = [
  { key: 'date', label: 'Fecha', value: (e) => e.created_at, render: (e) => fmtDateTime(e.created_at) },
  { key: 'actor', label: 'Actor', value: (e) => e.actor.full_name },
  { key: 'action', label: 'Acción', bold: true, value: (e) => ACTION[e.action] },
  { key: 'target', label: 'Cuenta afectada', value: (e) => e.target.full_name },
  { key: 'old', label: 'Valor anterior', value: (e) => e.old_value },
  { key: 'new', label: 'Valor nuevo', value: (e) => e.new_value },
];

const adminFilters: TableFilter<AdminLogEntry>[] = [
  { label: 'Todos los actores', get: (e) => e.actor.full_name },
  { label: 'Todas las acciones', get: (e) => ACTION[e.action] },
];

export function RegistroView() {
  const [type, setType] = useState<LogType>('queries');
  const { data, loading, error, reload } = useApi<LogsResponse>(`/api/admin/logs?type=${type}&limit=200`);

  return (
    <div className="flex flex-col gap-5">
      <Tabs
        size="md"
        active={type}
        onChange={setType}
        tabs={[
          { key: 'queries', label: 'Consultas al agente' },
          { key: 'admin', label: 'Acciones administrativas' },
        ]}
      />
      {/* Mientras llega la otra pestaña, el estado anterior no se muestra bajo el título equivocado. */}
      {!data || data.type !== type ? (
        loading || !error ? <LoadingState label="el registro de actividad" /> : <ErrorState label="el registro de actividad" message={error} onRetry={reload} />
      ) : data.type === 'queries' ? (
        <DataTable
          key="queries"
          columns={queryColumns}
          rows={data.entries}
          rowKey={(e) => String(e.query_log_id)}
          filters={queryFilters}
          initialSort={{ key: 'date', dir: -1 }}
          searchPlaceholder="Buscar por usuario o pregunta"
          unit="eventos"
          pageSize={15}
        />
      ) : (
        <DataTable
          key="admin"
          columns={adminColumns}
          rows={data.entries}
          rowKey={(e) => String(e.admin_log_id)}
          filters={adminFilters}
          initialSort={{ key: 'date', dir: -1 }}
          searchPlaceholder="Buscar por actor o cuenta"
          unit="eventos"
          pageSize={15}
        />
      )}
    </div>
  );
}
