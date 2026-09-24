'use client';

import { useState } from 'react';
import { useKpis } from '@/components/app/KpisProvider';
import { useSession } from '@/components/app/SessionProvider';
import { useToast } from '@/components/app/ToastProvider';
import { useApi } from '@/components/app/useApi';
import { StatusBadge, batchStatusLabel } from '@/components/ui/Badge';
import { Card, Stat } from '@/components/ui/Card';
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable';
import { fmtDateTime, fmtInt, fmtPct } from '@/components/ui/format';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { apiPost, errorMessage } from '@/lib/api/client';
import type { BatchLoadType, RevertBatchResponse, SourceBatch, SourcesResponse } from '@/lib/types/api';

const LOAD_TYPE: Record<BatchLoadType, string> = {
  historical: 'Carga histórica del HIS',
  ui_import: 'Corrección manual',
  seed_synthetic: 'Datos simulados',
};

const shortId = (id: string) => id.slice(0, 8).toUpperCase();

const columns: Column<SourceBatch>[] = [
  { key: 'id', label: 'Lote', bold: true, value: (b) => shortId(b.batch_id) },
  { key: 'type', label: 'Tipo de carga', value: (b) => LOAD_TYPE[b.load_type] },
  { key: 'table', label: 'Tabla destino', mono: true, value: (b) => b.target_table },
  { key: 'file', label: 'Archivo', mono: true, value: (b) => b.file_name ?? '—' },
  { key: 'source', label: 'Área de origen', value: (b) => b.source_system },
  { key: 'user', label: 'Usuario', value: (b) => b.imported_by?.full_name ?? 'Sistema' },
  { key: 'date', label: 'Fecha', value: (b) => b.imported_at, render: (b) => fmtDateTime(b.imported_at) },
  { key: 'read', label: 'Leídas', align: 'right', value: (b) => b.rows_read, render: (b) => fmtInt(b.rows_read) },
  { key: 'loaded', label: 'Cargadas', align: 'right', value: (b) => b.rows_loaded, render: (b) => fmtInt(b.rows_loaded) },
  { key: 'rejected', label: 'Rechazadas', align: 'right', value: (b) => b.rows_rejected, render: (b) => fmtInt(b.rows_rejected) },
  { key: 'status', label: 'Estado', value: (b) => batchStatusLabel(b.status), render: (b) => <StatusBadge status={b.status} simulated={b.is_simulated} /> },
];

const filters: TableFilter<SourceBatch>[] = [
  { label: 'Todas las tablas', get: (b) => b.target_table },
  { label: 'Todos los estados', get: (b) => batchStatusLabel(b.status) },
];

export function FuentesView() {
  const { data, loading, error, reload } = useApi<SourcesResponse>('/api/sources');
  const { can } = useSession();
  const { reload: reloadKpis } = useKpis();
  const toast = useToast();
  const [selected, setSelected] = useState<SourceBatch | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!data) return loading ? <LoadingState label="las fuentes de datos" /> : <ErrorState label="las fuentes de datos" message={error ?? undefined} onRetry={reload} />;

  const totalRows = data.tables.reduce((sum, t) => sum + t.rows, 0);
  const simulatedRows = data.tables.reduce((sum, t) => sum + t.simulated_rows, 0);
  const applied = data.batches.find((b) => b.status === 'applied');
  const problems = data.batches.filter((b) => b.status === 'rejected').length;
  const canRevert = selected !== null && can('import:revert') && selected.status === 'applied';

  const close = () => {
    setSelected(null);
    setConfirming(false);
  };

  const revert = async () => {
    if (!selected) return;
    if (!confirming) return setConfirming(true);
    setBusy(true);
    try {
      await apiPost<RevertBatchResponse>(`/api/import/batches/${selected.batch_id}/revert`);
      toast(`Lote ${shortId(selected.batch_id)} revertido. KPIs y alertas recalculados`);
      close();
      reload();
      reloadKpis();
    } catch (e) {
      toast(errorMessage(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-5">
        <Stat
          label="Última carga aplicada"
          value={<span className="text-[26px] leading-tight sm:text-[34px]">{data.last_load_at ? fmtDateTime(data.last_load_at) : '—'}</span>}
          sub={applied ? `${applied.target_table} · ${applied.imported_by?.full_name ?? 'Sistema'}` : undefined}
        />
        <Stat label="Datos simulados" value={fmtPct(data.simulated_pct)} sub={`${fmtInt(simulatedRows)} de ${fmtInt(totalRows)} filas`} origin="Simulado" />
        <Stat label="Cargas con problemas" value={problems} sub="rechazadas, entre los 50 lotes más recientes" />
      </div>

      <section className="flex flex-col gap-3.5">
        <h3 className="m-0 text-[21px] font-bold">Tablas cargadas</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3.5">
          {data.tables.map((t) => (
            <div key={t.table} className="flex flex-col gap-1.5 rounded-xl border border-line bg-white px-[18px] py-4">
              <span className="font-mono text-sm font-medium">{t.table}</span>
              <span className="text-[26px] font-extrabold">
                {fmtInt(t.rows)} <span className="text-sm font-semibold text-muted">filas</span>
              </span>
              <span className={`self-start rounded-full border ${t.simulated_rows ? 'border-dashed' : ''} border-slate-500 px-2 py-0.5 text-xs font-bold text-muted`}>
                {fmtInt(t.simulated_rows)} simuladas
              </span>
            </div>
          ))}
        </div>
      </section>

      <DataTable
        title="Historial global de lotes"
        columns={columns}
        rows={data.batches}
        rowKey={(b) => b.batch_id}
        filters={filters}
        initialSort={{ key: 'date', dir: -1 }}
        onRowClick={setSelected}
        searchPlaceholder="Buscar por archivo, usuario o lote"
        unit="lotes"
      />
      <div className="-mt-3 text-sm text-muted">Haga clic en un lote para ver su detalle.</div>

      {selected && (
        <>
          <div onClick={close} className="fixed inset-0 z-[150] bg-ink/50" />
          <aside role="dialog" aria-modal="true" className="fixed inset-y-0 right-0 z-[151] flex w-[min(640px,100vw)] flex-col border-l border-line bg-white shadow-[-12px_0_32px_-8px_rgba(0,0,0,0.2)]">
            <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-[22px]">
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-bold text-muted">
                  {shortId(selected.batch_id)} · {LOAD_TYPE[selected.load_type]}
                </span>
                <span className="break-all font-mono text-xl font-extrabold">{selected.file_name ?? 'Sin archivo'}</span>
                <span className="self-start">
                  <StatusBadge status={selected.status} simulated={selected.is_simulated} />
                </span>
              </div>
              <button type="button" onClick={close} aria-label="Cerrar" className="size-10 shrink-0 cursor-pointer rounded-lg border border-line bg-white text-xl">
                ×
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-6 py-[22px]">
              <div className="grid grid-cols-2 gap-x-5 gap-y-3.5 text-[15px]">
                <Detail label="Tabla destino" mono>
                  {selected.target_table}
                </Detail>
                <Detail label="Área de origen">{selected.source_system}</Detail>
                <Detail label="Usuario">{selected.imported_by?.full_name ?? 'Sistema'}</Detail>
                <Detail label="Fecha">{fmtDateTime(selected.imported_at)}</Detail>
                <Detail label="Leídas / cargadas / rechazadas" bold>
                  {fmtInt(selected.rows_read)} / {fmtInt(selected.rows_loaded)} / {fmtInt(selected.rows_rejected)}
                </Detail>
              </div>
              {selected.rows_rejected > 0 && (
                <Card className="p-4 text-[15px] leading-relaxed text-slate-700">
                  Este lote rechazó {fmtInt(selected.rows_rejected)} filas. El reporte fila por fila se entrega al validar el archivo en la pantalla de corrección de cada entidad.
                </Card>
              )}
            </div>
            {canRevert && (
              <div className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
                {confirming && <span className="mr-auto text-[15px] font-semibold">¿Revertir este lote y recalcular KPIs y alertas?</span>}
                {confirming && (
                  <button type="button" onClick={() => setConfirming(false)} className="h-[46px] cursor-pointer rounded-lg border border-line bg-white px-[18px] text-[15px] font-semibold">
                    Cancelar
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revert()}
                  className="h-[46px] cursor-pointer rounded-lg border-0 bg-leaf px-5 text-[15px] font-bold text-white disabled:opacity-60"
                >
                  {confirming ? 'Sí, revertir lote' : 'Revertir lote'}
                </button>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}

function Detail({ label, children, mono, bold }: { label: string; children: React.ReactNode; mono?: boolean; bold?: boolean }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-muted">{label}</div>
      <div className={`${mono ? 'font-mono' : ''} ${bold ? 'font-bold' : ''}`}>{children}</div>
    </div>
  );
}
