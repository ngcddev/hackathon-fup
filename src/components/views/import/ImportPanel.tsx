'use client';

import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useKpis } from '@/components/app/KpisProvider';
import { useSession } from '@/components/app/SessionProvider';
import { useToast } from '@/components/app/ToastProvider';
import { useApi } from '@/components/app/useApi';
import { StatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, Notice } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { cn, downloadCsv, fmtDateTime, fmtInt } from '@/components/ui/format';
import { apiPost, errorMessage } from '@/lib/api/client';
import { importPermissionFor } from '@/lib/auth/permissions';
import {
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
  type ApplyBatchResponse,
  type CreateBatchResponse,
  type ImportRow,
  type ImportRowError,
  type ImportTarget,
  type RevertBatchResponse,
  type SendRowsResponse,
  type SourceBatch,
  type SourcesResponse,
} from '@/lib/types/api';
import { normalizeHeader, parseCsv, readFileText, type ParsedFile } from './csv';

const TARGET_LABEL: Record<ImportTarget, string> = {
  bed_inventory: 'Inventario de camas',
  drug_stock: 'Inventario de medicamentos',
  surgery_schedules: 'Programación quirúrgica',
};

// Área que se registra como origen del lote.
const SOURCE_SYSTEM: Record<ImportTarget, string> = {
  bed_inventory: 'Admisiones',
  drug_stock: 'Farmacia',
  surgery_schedules: 'Programación quirúrgica',
};

const STEPS = ['Descargar plantilla', 'Subir archivo', 'Mapear columnas', 'Vista previa', 'Validación', 'Aplicar'];
const EMPTY = '__empty__';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const CHUNK_TARGET_BYTES = 3_500_000; // margen bajo el límite de 4 MB del servidor

type Tab = 'problemas' | 'corregir' | 'historial';
type Phase = 'idle' | 'running' | 'ok' | 'fail';

interface Progress {
  done: number;
  total: number;
}

interface Failure {
  batchId: string | null;
  invalid: number;
  errors: ImportRowError[];
  truncated: boolean;
  message: string;
}

const shortId = (id: string) => id.slice(0, 8).toUpperCase();

function guessMapping(template: readonly string[], headers: string[]): Record<string, string> {
  const byNorm = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const out: Record<string, string> = {};
  for (const col of template) {
    const hit = byNorm.get(normalizeHeader(col));
    if (hit) out[col] = hit;
  }
  return out;
}

function toChunks(rows: ImportRow[]): ImportRow[][] {
  const chunks: ImportRow[][] = [];
  let current: ImportRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (current.length >= IMPORT_LIMITS.recommended_chunk_rows || (current.length > 0 && bytes + size > CHUNK_TARGET_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

interface ImportPanelProps {
  // `null`: el HIS no tiene `target` en el contrato todavía (IMP-10, Could).
  target: ImportTarget | null;
  note?: string;
}

export function ImportPanel({ target, note }: ImportPanelProps) {
  const { can } = useSession();

  if (target === null) {
    return can('import:his_tables') ? (
      <Notice>La importación incremental de las tablas del HIS aún no está habilitada en el servidor. {note}</Notice>
    ) : (
      <div className="rounded-2xl border border-line bg-white px-6 py-10 text-center text-[17px] font-medium text-muted">Solo lectura para su rol</div>
    );
  }
  if (!can(importPermissionFor(target))) {
    return <div className="rounded-2xl border border-line bg-white px-6 py-10 text-center text-[17px] font-medium text-muted">Solo lectura para su rol</div>;
  }
  return <ImportWizard target={target} note={note} />;
}

// El aviso de cargas con problemas de la pestaña de la vista se calcula con el mismo listado.
export function useProblemBatches(target: ImportTarget | null): number {
  const { data } = useApi<SourcesResponse>(target ? '/api/sources' : null);
  return data && target ? data.batches.filter((b) => b.target_table === target && b.status === 'rejected').length : 0;
}

function ImportWizard({ target, note }: { target: ImportTarget; note?: string }) {
  const { can } = useSession();
  const toast = useToast();
  const { reload: reloadKpis } = useKpis();
  const sources = useApi<SourcesResponse>('/api/sources');
  const template = IMPORT_COLUMNS[target];

  const [tab, setTab] = useState<Tab>('corregir');
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<{ phase: Phase; progress: Progress; failure: Failure | null; batchId: string | null }>({
    phase: 'idle',
    progress: { done: 0, total: 0 },
    failure: null,
    batchId: null,
  });
  const [apply, setApply] = useState<{ phase: Phase; result: ApplyBatchResponse | null; error: string }>({ phase: 'idle', result: null, error: '' });
  const [correcting, setCorrecting] = useState<SourceBatch | null>(null);
  const [confirmRevert, setConfirmRevert] = useState<SourceBatch | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const batches = useMemo(() => (sources.data?.batches ?? []).filter((b) => b.target_table === target), [sources.data, target]);
  const problems = batches.filter((b) => b.status === 'rejected');

  const reset = () => {
    setStep(1);
    setFile(null);
    setFileError('');
    setMapping({});
    setValidation({ phase: 'idle', progress: { done: 0, total: 0 }, failure: null, batchId: null });
    setApply({ phase: 'idle', result: null, error: '' });
    setCorrecting(null);
  };

  const acceptFile = async (candidate: File) => {
    setFileError('');
    if (/\.xlsx$/i.test(candidate.name)) {
      setFile(null);
      setFileError('Por ahora solo se admite CSV. Guarde la hoja como CSV (UTF-8) e inténtelo de nuevo.');
      return;
    }
    if (!/\.csv$/i.test(candidate.name)) {
      setFile(null);
      setFileError('Formato no admitido. Use un archivo CSV.');
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      setFile(null);
      setFileError('El archivo supera el máximo de 4 MB.');
      return;
    }
    const table = parseCsv(await readFileText(candidate));
    if (table.length < 2) {
      setFile(null);
      setFileError('El archivo no tiene filas de datos.');
      return;
    }
    if (table.length - 1 > IMPORT_LIMITS.max_rows_per_batch) {
      setFile(null);
      setFileError(`El archivo supera el máximo de ${fmtInt(IMPORT_LIMITS.max_rows_per_batch)} filas por lote.`);
      return;
    }
    const [headers, ...rows] = table;
    setFile({ fileName: candidate.name, size: candidate.size, headers, rows });
    setMapping(guessMapping(template, headers));
    setValidation({ phase: 'idle', progress: { done: 0, total: 0 }, failure: null, batchId: null });
    setApply({ phase: 'idle', result: null, error: '' });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) void acceptFile(dropped);
  };

  const mapped = template.every((c) => mapping[c]);
  const importRows = (): ImportRow[] =>
    (file?.rows ?? []).map((cells, i) => {
      const values: Record<string, string | null> = {};
      for (const col of template) {
        const header = mapping[col];
        const index = header && header !== EMPTY && file ? file.headers.indexOf(header) : -1;
        const cell = index >= 0 ? (cells[index] ?? '').trim() : '';
        values[col] = cell === '' ? null : cell;
      }
      return { row_number: i + 2, values };
    });

  const validate = async () => {
    if (!file) return;
    const rows = importRows();
    const chunks = toChunks(rows);
    setValidation({ phase: 'running', progress: { done: 0, total: chunks.length }, failure: null, batchId: null });
    let batchId: string | null = null;
    try {
      const created = await apiPost<CreateBatchResponse>('/api/import/batches', {
        target,
        file_name: file.fileName,
        source_system: SOURCE_SYSTEM[target],
        total_rows: rows.length,
      });
      batchId = created.batch_id;
      const errors: ImportRowError[] = [];
      let invalid = 0;
      let truncated = false;
      for (const [i, chunk] of chunks.entries()) {
        const sent = await apiPost<SendRowsResponse>(`/api/import/batches/${created.batch_id}/rows`, { rows: chunk });
        invalid = sent.invalid_rows;
        errors.push(...sent.row_errors);
        truncated ||= sent.errors_truncated;
        setValidation((v) => ({ ...v, progress: { done: i + 1, total: chunks.length } }));
      }
      if (invalid > 0) {
        // Todo o nada: se cierra el lote para que quede registrado como rechazado (IMP-05).
        try {
          await apiPost<ApplyBatchResponse>(`/api/import/batches/${created.batch_id}/apply`);
        } catch {
          // BATCH_REJECTED es lo esperado: el lote queda `rejected` y no se toca `core`.
        }
        setValidation({
          phase: 'fail',
          progress: { done: chunks.length, total: chunks.length },
          batchId,
          failure: { batchId, invalid, errors, truncated, message: '' },
        });
        sources.reload();
      } else {
        setValidation({ phase: 'ok', progress: { done: chunks.length, total: chunks.length }, failure: null, batchId });
      }
    } catch (e) {
      setValidation({
        phase: 'fail',
        progress: { done: 0, total: chunks.length },
        batchId,
        failure: { batchId, invalid: 0, errors: [], truncated: false, message: errorMessage(e) },
      });
    }
  };

  const applyBatch = async () => {
    if (!validation.batchId) return;
    setApply({ phase: 'running', result: null, error: '' });
    try {
      const result = await apiPost<ApplyBatchResponse>(`/api/import/batches/${validation.batchId}/apply`);
      setApply({ phase: 'ok', result, error: '' });
      toast('KPIs y alertas recalculados');
      sources.reload();
      reloadKpis();
    } catch (e) {
      setApply({ phase: 'fail', result: null, error: errorMessage(e) });
      sources.reload();
    }
  };

  const revert = async (batch: SourceBatch) => {
    setConfirmRevert(null);
    try {
      await apiPost<RevertBatchResponse>(`/api/import/batches/${batch.batch_id}/revert`);
      toast(`Lote ${shortId(batch.batch_id)} revertido. KPIs y alertas recalculados`);
      sources.reload();
      reloadKpis();
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const downloadReport = (failure: Failure) =>
    downloadCsv(`reporte_${failure.batchId ? shortId(failure.batchId) : 'validacion'}.csv`, [
      ['fila', 'columna', 'motivo'],
      ...failure.errors.map((e) => [e.row_number, e.column_name ?? '', e.message]),
    ]);

  const preview = importRows().slice(0, 20);

  return (
    <div className="flex flex-col gap-5">
      <Tabs
        size="md"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'problemas', label: `Cargas con problemas (${problems.length})` },
          { key: 'corregir', label: 'Corregir y actualizar' },
          { key: 'historial', label: `Historial de lotes (${batches.length})` },
        ]}
      />

      {tab !== 'corregir' && sources.error && !sources.data && <ErrorState label="el historial de lotes" message={sources.error} onRetry={sources.reload} />}

      {tab === 'problemas' && (sources.data || !sources.error) && (
        <>
          {problems.length === 0 ? (
            <EmptyState title="No hay cargas con problemas">Todos los lotes de esta entidad se aplicaron o se revirtieron.</EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              {problems.map((b) => (
                <div
                  key={b.batch_id}
                  className="grid grid-cols-[minmax(0,1.4fr)_repeat(auto-fit,minmax(110px,1fr))] items-center gap-4 rounded-xl border border-line bg-white px-5 py-[18px]"
                >
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono text-[15px] font-medium">{b.file_name ?? 'Sin archivo'}</span>
                      <StatusBadge status={b.status} />
                    </div>
                    <span className="text-sm text-muted">
                      {shortId(b.batch_id)} · {b.source_system} · {b.imported_by?.full_name ?? 'Sistema'} · {fmtDateTime(b.imported_at)}
                    </span>
                  </div>
                  <Figure label="Leídas" value={b.rows_read} />
                  <Figure label="Cargadas" value={b.rows_loaded} />
                  <Figure label="Rechazadas" value={b.rows_rejected} danger />
                  <button
                    type="button"
                    onClick={() => {
                      reset();
                      setCorrecting(b);
                      setTab('corregir');
                    }}
                    className="cursor-pointer justify-self-end whitespace-nowrap border-0 bg-transparent text-[15px] font-bold text-navy"
                  >
                    Corregir este lote →
                  </button>
                </div>
              ))}
              <div className="text-sm text-muted">El detalle fila por fila se muestra al validar el archivo; descargue el reporte en ese momento.</div>
            </div>
          )}
        </>
      )}

      {tab === 'historial' && (sources.data || !sources.error) && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-[15px]">
            <thead>
              <tr className="bg-canvas text-left">
                {['Lote', 'Archivo', 'Usuario · fecha', 'Leídas / cargadas / rech.', 'Estado', ''].map((h, i) => (
                  <th key={i} className={cn('px-4 py-3 text-[13px] font-bold uppercase tracking-[0.05em] text-muted', i === 3 && 'text-right')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.batch_id} className="border-t border-line">
                  <td className="whitespace-nowrap px-4 py-3 font-bold">{shortId(b.batch_id)}</td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-sm">{b.file_name ?? 'Sin archivo'}</div>
                    <div className="text-[13px] text-muted">{b.source_system}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{b.imported_by?.full_name ?? 'Sistema'}</div>
                    <div className="text-[13px] text-muted">{fmtDateTime(b.imported_at)}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {fmtInt(b.rows_read)} / {fmtInt(b.rows_loaded)} / {fmtInt(b.rows_rejected)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} simulated={b.is_simulated} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {can('import:revert') && b.status === 'applied' && !b.is_simulated && (
                      <button
                        type="button"
                        onClick={() => setConfirmRevert(b)}
                        className="h-[38px] cursor-pointer whitespace-nowrap rounded-lg border-[1.5px] border-navy bg-white px-3.5 text-sm font-bold"
                      >
                        Revertir lote
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {batches.length === 0 && <div className="px-6 py-10 text-center text-base text-muted">{sources.loading ? 'Cargando lotes…' : 'Aún no hay lotes para esta entidad.'}</div>}
        </Card>
      )}

      {tab === 'corregir' && (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-3 border-b border-line md:grid-cols-6">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const done = n < step || (n === 6 && apply.phase === 'ok');
              const current = n === step && !done;
              return (
                <div key={label} className={cn('flex flex-col items-center gap-2 border-b-[3px] px-1.5 py-[18px] text-center', current ? 'border-navy' : 'border-transparent')}>
                  <span
                    className={cn(
                      'flex size-9 items-center justify-center rounded-full border-2 text-[15px] font-extrabold',
                      done ? 'border-navy bg-navy text-white' : current ? 'border-navy bg-white text-navy' : 'border-line bg-white text-slate-500',
                    )}
                  >
                    {done ? '✓' : n}
                  </span>
                  <span className={cn('text-sm leading-snug', current ? 'font-extrabold text-navy' : 'font-semibold text-muted', done && 'text-navy')}>{label}</span>
                </div>
              );
            })}
          </div>

          {correcting && (
            <div className="border-b border-line bg-canvas px-6 py-3 text-[15px]">
              Corrigiendo el lote <strong>{shortId(correcting.batch_id)}</strong> ({correcting.file_name ?? 'Sin archivo'})
            </div>
          )}

          <div className="flex flex-col gap-5 px-6 py-7">
            {step === 1 && (
              <div className="flex max-w-[860px] flex-col gap-[18px]">
                <h4 className="m-0 text-[22px] font-extrabold">1. Descargar plantilla</h4>
                <div className="text-base leading-relaxed text-slate-700">
                  Plantilla <strong>{TARGET_LABEL[target]}</strong> con las columnas:
                </div>
                <div className="flex flex-wrap gap-2">
                  {template.map((c) => (
                    <span key={c} className="rounded-lg border border-line bg-canvas px-3 py-1.5 font-mono text-sm">
                      {c}
                    </span>
                  ))}
                </div>
                <ul className="m-0 list-disc pl-5 text-base leading-[1.7] text-slate-700">
                  <li>Formato CSV, máximo 4 MB y {fmtInt(IMPORT_LIMITS.max_rows_per_batch)} filas por lote.</li>
                  <li>La carga es todo o nada: si hay una fila inválida no se aplica ninguna.</li>
                  <li>Los datos existentes nunca se sobrescriben; cada carga crea un lote nuevo.</li>
                  {note && <li>{note}</li>}
                </ul>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => downloadCsv(`plantilla_${target}.csv`, [[...template]])}
                    className="flex h-12 cursor-pointer items-center gap-2 rounded-lg border-[1.5px] border-navy bg-white px-5 text-base font-bold"
                  >
                    <Icon name="download" />
                    Descargar plantilla (CSV)
                  </button>
                  <button type="button" onClick={() => setStep(2)} className={PRIMARY}>
                    Ya tengo el archivo · Siguiente
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-[18px]">
                <h4 className="m-0 text-[22px] font-extrabold">2. Subir archivo corregido</h4>
                <div
                  role="button"
                  tabIndex={0}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => picker.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') picker.current?.click();
                  }}
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-2.5 rounded-2xl border-2 border-dashed px-6 py-10 text-center',
                    dragging ? 'border-navy bg-slate-100' : 'border-slate-300 bg-canvas',
                  )}
                >
                  <Icon name="upload" size={36} strokeWidth={1.6} className="text-navy" />
                  <div className="text-lg font-bold">Arrastre y suelte el archivo aquí</div>
                  <div className="text-[15px] text-muted">o haga clic para elegirlo · CSV · máximo 4 MB</div>
                  <input
                    ref={picker}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => {
                      const chosen = e.target.files?.[0];
                      if (chosen) void acceptFile(chosen);
                      e.target.value = '';
                    }}
                  />
                </div>
                {fileError && (
                  <div role="alert" className="rounded-lg border border-danger-line bg-danger-bg px-4 py-3 text-[15px] font-semibold text-danger">
                    {fileError}
                  </div>
                )}
                {file && (
                  <div className="flex items-center gap-3.5 rounded-xl border-[1.5px] border-navy px-[18px] py-3.5">
                    <Icon name="file" size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[15px] font-medium">{file.fileName}</div>
                      <div className="text-sm text-muted">
                        {file.size > 1048576 ? `${(file.size / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`} · {fmtInt(file.rows.length)} filas
                      </div>
                    </div>
                    <button type="button" onClick={() => setFile(null)} className="h-[38px] cursor-pointer rounded-lg border border-line bg-white px-3 text-sm font-semibold">
                      Quitar
                    </button>
                  </div>
                )}
                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(1)} className={SECONDARY}>
                    Atrás
                  </button>
                  <button type="button" disabled={!file} onClick={() => setStep(3)} className={cn(PRIMARY, 'disabled:opacity-40')}>
                    Siguiente
                  </button>
                </div>
              </div>
            )}

            {step === 3 && file && (
              <div className="flex max-w-[860px] flex-col gap-[18px]">
                <h4 className="m-0 text-[22px] font-extrabold">3. Mapear columnas</h4>
                <p className="m-0 text-base leading-relaxed text-slate-700">Asigne cada columna de la plantilla a una columna del archivo. Las que no existan pueden dejarse vacías; el servidor indicará si son obligatorias.</p>
                <div className="overflow-hidden rounded-xl border border-line">
                  <div className="grid grid-cols-[1fr_1fr_150px] gap-3 bg-canvas px-[18px] py-3 text-[13px] font-bold uppercase tracking-[0.05em] text-muted">
                    <span>Columna de la plantilla</span>
                    <span>Columna del archivo</span>
                    <span>Estado</span>
                  </div>
                  {template.map((col) => {
                    const value = mapping[col] ?? '';
                    return (
                      <div key={col} className="grid grid-cols-[1fr_1fr_150px] items-center gap-3 border-t border-line px-[18px] py-2.5">
                        <span className="font-mono text-[15px]">{col}</span>
                        <select
                          value={value}
                          onChange={(e) => setMapping((m) => ({ ...m, [col]: e.target.value }))}
                          className={cn('h-[42px] rounded-lg border-[1.5px] bg-white px-2.5 font-mono text-[15px]', value ? 'border-slate-300' : 'border-warn')}
                        >
                          <option value="">Seleccione…</option>
                          <option value={EMPTY}>— Dejar vacía —</option>
                          {file.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                        <span className={cn('text-sm font-bold', value ? 'text-navy' : 'text-warn')}>{!value ? 'Sin asignar' : value === col ? 'Coincide' : value === EMPTY ? 'Vacía' : 'Asignada'}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => setStep(2)} className={SECONDARY}>
                    Atrás
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapping(guessMapping(template, file.headers))}
                    className="h-12 cursor-pointer rounded-lg border-[1.5px] border-navy bg-white px-5 text-base font-bold"
                  >
                    Usar sugerencias
                  </button>
                  <button type="button" disabled={!mapped} onClick={() => setStep(4)} className={cn(PRIMARY, 'disabled:opacity-40')}>
                    Siguiente
                  </button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="flex flex-col gap-4">
                <h4 className="m-0 text-[22px] font-extrabold">4. Vista previa · primeras 20 filas</h4>
                <div className="text-[15px] text-muted">El servidor valida cada fila otra vez al validar: aquí se ve cómo quedarán los datos.</div>
                <div className="max-h-[520px] overflow-auto rounded-xl border border-line">
                  <table className="w-full border-collapse font-mono text-sm">
                    <thead>
                      <tr>
                        <th className="sticky top-0 border-b border-line bg-slate-100 px-3 py-2.5 text-right text-xs text-muted">Fila</th>
                        {template.map((c) => (
                          <th key={c} className="sticky top-0 whitespace-nowrap border-b border-line bg-slate-100 px-3 py-2.5 text-left text-xs font-bold text-muted">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row) => (
                        <tr key={row.row_number} className="border-t border-mist">
                          <td className="px-3 py-2 text-right text-muted">{row.row_number}</td>
                          {template.map((c) => (
                            <td key={c} className="whitespace-nowrap px-3 py-2 text-navy">
                              {row.values[c] ?? <span className="text-slate-400">(vacío)</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(3)} className={SECONDARY}>
                    Atrás
                  </button>
                  <button type="button" onClick={() => setStep(5)} className={PRIMARY}>
                    Siguiente: validar
                  </button>
                </div>
              </div>
            )}

            {step === 5 && file && (
              <div className="flex max-w-[900px] flex-col gap-[18px]">
                <h4 className="m-0 text-[22px] font-extrabold">5. Validación</h4>
                <div className="rounded-xl border border-line bg-canvas px-[18px] py-3.5 text-base leading-relaxed">
                  La carga es todo o nada: si una sola fila es inválida no se aplica ninguna. Los datos existentes nunca se sobrescriben.
                </div>

                {validation.phase === 'idle' && (
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setStep(4)} className={SECONDARY}>
                      Atrás
                    </button>
                    <button type="button" onClick={() => void validate()} className={PRIMARY}>
                      Validar {fmtInt(file.rows.length)} filas
                    </button>
                  </div>
                )}

                {validation.phase === 'running' && (
                  <Progress
                    label={`Enviando trozo ${Math.min(validation.progress.total, validation.progress.done + 1)} de ${validation.progress.total}`}
                    pct={validation.progress.total ? (validation.progress.done / validation.progress.total) * 100 : 0}
                  />
                )}

                {validation.phase === 'ok' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3 rounded-xl border-[1.5px] border-navy px-[18px] py-4 text-[17px] font-bold">
                      <Icon name="check" size={22} strokeWidth={2.2} />
                      {fmtInt(file.rows.length)} filas válidas. Listo para aplicar.
                    </div>
                    <div>
                      <button type="button" onClick={() => setStep(6)} className={PRIMARY}>
                        Siguiente: aplicar
                      </button>
                    </div>
                  </div>
                )}

                {validation.phase === 'fail' && validation.failure && (
                  <div className="flex flex-col gap-4">
                    <div role="alert" className="flex items-center gap-3 rounded-xl border border-danger-line bg-danger-bg px-[18px] py-4 text-[17px] font-extrabold text-danger">
                      <Icon name="close" size={22} strokeWidth={2.2} />
                      {validation.failure.message ? 'No se pudo validar el archivo' : 'Rechazado: revise el reporte'}
                    </div>
                    {validation.failure.message ? (
                      <div className="text-base text-slate-700">{validation.failure.message}</div>
                    ) : (
                      <>
                        <div className="text-base text-slate-700">
                          {fmtInt(validation.failure.invalid)} filas inválidas de {fmtInt(file.rows.length)}. No se aplicó ninguna fila
                          {validation.failure.batchId ? `. Se registró el lote ${shortId(validation.failure.batchId)}` : ''}.
                        </div>
                        <div className="max-h-[360px] overflow-y-auto rounded-xl border border-line">
                          {validation.failure.errors.map((e, i) => (
                            <div key={i} className="grid grid-cols-[80px_minmax(0,1fr)_minmax(0,2fr)] gap-3 border-t border-mist px-4 py-2.5 text-[15px] first:border-t-0">
                              <strong>Fila {e.row_number}</strong>
                              <span className="font-mono">{e.column_name ?? '(fila completa)'}</span>
                              <span>{e.message}</span>
                            </div>
                          ))}
                        </div>
                        {validation.failure.truncated && <div className="text-sm text-muted">Se muestran los primeros errores de cada trozo; corrija y vuelva a validar para ver el resto.</div>}
                      </>
                    )}
                    <div className="flex flex-wrap gap-3">
                      {!validation.failure.message && (
                        <button
                          type="button"
                          onClick={() => downloadReport(validation.failure!)}
                          className="h-12 cursor-pointer rounded-lg border-[1.5px] border-navy bg-white px-5 text-base font-bold"
                        >
                          Descargar reporte
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setFile(null);
                          setValidation({ phase: 'idle', progress: { done: 0, total: 0 }, failure: null, batchId: null });
                          setStep(2);
                        }}
                        className={PRIMARY}
                      >
                        Subir otro archivo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 6 && file && (
              <div className="flex max-w-[900px] flex-col gap-[18px]">
                <h4 className="m-0 text-[22px] font-extrabold">6. Aplicar</h4>

                {apply.phase === 'idle' && (
                  <div className="flex flex-col gap-4">
                    <div className="text-base leading-relaxed">
                      Se creará un lote nuevo en <span className="font-mono">{target}</span> con <strong>{fmtInt(file.rows.length)} filas</strong> desde{' '}
                      <span className="font-mono">{file.fileName}</span>.
                    </div>
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setStep(5)} className={SECONDARY}>
                        Atrás
                      </button>
                      <button type="button" onClick={() => void applyBatch()} className={cn(PRIMARY, 'px-7')}>
                        Aplicar carga
                      </button>
                    </div>
                  </div>
                )}

                {apply.phase === 'running' && <Progress label="Aplicando el lote y recalculando indicadores" pct={60} />}

                {apply.phase === 'fail' && (
                  <div className="flex flex-col gap-4">
                    <div role="alert" className="rounded-xl border border-danger-line bg-danger-bg px-[18px] py-4 text-base font-semibold text-danger">
                      {apply.error}
                    </div>
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setStep(2)} className={SECONDARY}>
                        Subir otro archivo
                      </button>
                    </div>
                  </div>
                )}

                {apply.phase === 'ok' && apply.result && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3.5 rounded-xl border-2 border-navy p-5">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-leaf text-white">
                        <Icon name="check" size={22} strokeWidth={2.6} />
                      </span>
                      <div>
                        <div className="text-[22px] font-extrabold">Aplicado: {fmtInt(apply.result.rows_loaded)} filas cargadas</div>
                        <div className="mt-0.5 text-[15px] text-muted">Lote {shortId(apply.result.batch_id)} · KPIs y alertas recalculados</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={() => setTab('historial')} className="h-12 cursor-pointer rounded-lg border-[1.5px] border-navy bg-white px-5 text-base font-bold">
                        Ver historial de lotes
                      </button>
                      <button type="button" onClick={reset} className={SECONDARY}>
                        Nueva corrección
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {confirmRevert && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-ink/55 p-6">
          <div role="dialog" aria-modal="true" className="flex w-full max-w-[520px] flex-col gap-4 rounded-2xl bg-white p-7 shadow-float">
            <h3 className="m-0 text-2xl font-extrabold">¿Revertir el lote {shortId(confirmRevert.batch_id)}?</h3>
            <p className="m-0 text-base leading-relaxed text-slate-700">
              Se retirarán las {fmtInt(confirmRevert.rows_loaded)} filas cargadas desde <span className="font-mono">{confirmRevert.file_name ?? 'el archivo'}</span> y se recalcularán KPIs y alertas.
              {target === 'drug_stock' ? ' Se restaurará la foto de inventario anterior.' : ''}
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmRevert(null)} className="h-[46px] cursor-pointer rounded-lg border border-line bg-white px-5 text-[15px] font-semibold">
                Cancelar
              </button>
              <button type="button" onClick={() => void revert(confirmRevert)} className="h-[46px] cursor-pointer rounded-lg border-0 bg-leaf px-5 text-[15px] font-bold text-white">
                Revertir lote
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PRIMARY = 'h-12 cursor-pointer rounded-lg border-0 bg-leaf px-6 text-base font-bold text-white hover:bg-forest';
const SECONDARY = 'h-12 cursor-pointer rounded-lg border border-line bg-white px-5 text-base font-semibold';

function Figure({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-muted">{label}</div>
      <div className={cn('text-xl font-extrabold', danger && 'text-danger')}>{fmtInt(value)}</div>
    </div>
  );
}

function Progress({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="flex flex-col gap-2.5" role="status">
      <div className="flex justify-between text-[15px] font-semibold">
        <span>{label}</span>
        <span>{Math.round(pct)} %</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-navy transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
