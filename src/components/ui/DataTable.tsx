'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cn, fmtInt } from './format';

export interface Column<Row> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  mono?: boolean;
  bold?: boolean;
  // Valor con el que se ordena y se busca. Si falta, se usa `render` convertido a texto vacío.
  value?: (row: Row) => string | number | null;
  render?: (row: Row) => ReactNode;
}

export interface TableFilter<Row> {
  label: string; // "Todos los estados"
  get: (row: Row) => string | null;
  format?: (value: string) => string;
}

interface DataTableProps<Row> {
  title?: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  searchPlaceholder?: string;
  filters?: TableFilter<Row>[];
  initialSort?: { key: string; dir: 1 | -1 };
  onRowClick?: (row: Row) => void;
  pageSize?: number;
  unit?: string;
  emptyText?: string;
}

export function DataTable<Row>({
  title,
  columns,
  rows,
  rowKey,
  searchPlaceholder = 'Buscar…',
  filters = [],
  initialSort,
  onRowClick,
  pageSize = 10,
  unit = 'registros',
  emptyText = 'No hay registros que coincidan con la búsqueda.',
}: DataTableProps<Row>) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  const options = useMemo(
    () =>
      filters.map((f) => [...new Set(rows.map((r) => f.get(r)).filter((v): v is string => v != null && v !== ''))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))),
    [filters, rows],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((row) => {
      for (const [i, value] of Object.entries(picked)) {
        if (value && filters[Number(i)].get(row) !== value) return false;
      }
      if (!q) return true;
      return columns.some((c) => String(c.value?.(row) ?? '').toLowerCase().includes(q));
    });
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.value) {
        const get = col.value;
        out = [...out].sort((a, b) => {
          const x = get(a);
          const y = get(b);
          if (x == null) return 1;
          if (y == null) return -1;
          const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true });
          return cmp * sort.dir;
        });
      }
    }
    return out;
  }, [rows, query, picked, sort, columns, filters]);

  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = visible.slice(current * pageSize, current * pageSize + pageSize);
  const from = Math.max(0, current - 2);
  const to = Math.min(pages, from + 5);

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
    setPage(0);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        {title && <h3 className="m-0 mr-3 text-xl font-bold">{title}</h3>}
        <div className="relative min-w-[220px] max-w-[380px] flex-1">
          <Icon name="search" size={18} className="absolute left-3.5 top-3 text-muted" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder={searchPlaceholder}
            aria-label="Buscar"
            className="h-11 w-full rounded-full border-[1.5px] border-slate-300 bg-white pl-[42px] pr-3.5 text-[15px] outline-none focus:border-leaf"
          />
        </div>
        {filters.map((f, i) => (
          <select
            key={f.label}
            value={picked[i] ?? ''}
            onChange={(e) => {
              setPicked((p) => ({ ...p, [i]: e.target.value }));
              setPage(0);
            }}
            aria-label={f.label}
            className="h-11 cursor-pointer rounded-lg border-[1.5px] border-slate-300 bg-white px-3 text-[15px] font-semibold"
          >
            <option value="">{f.label}</option>
            {options[i].map((v) => (
              <option key={v} value={v}>
                {f.format ? f.format(v) : v}
              </option>
            ))}
          </select>
        ))}
        <span className="ml-auto text-sm font-medium text-muted">
          {fmtInt(visible.length)} {unit}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr className="bg-canvas">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} className="border-b border-line p-0" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn(
                        'inline-flex w-full cursor-pointer items-center gap-1.5 whitespace-nowrap border-0 bg-transparent px-4 py-3 text-[13px] font-bold uppercase tracking-[0.05em] text-muted',
                        c.align === 'right' ? 'justify-end' : 'justify-start',
                      )}
                    >
                      {c.label}
                      <span className="min-w-2.5 text-xs text-ink">{active ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn('border-t border-line hover:bg-canvas', onRowClick && 'cursor-pointer')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-top text-navy', c.align === 'right' && 'text-right')}>
                    <span className={cn('whitespace-nowrap', c.mono && 'font-mono', c.bold ? 'font-bold' : 'font-medium')}>
                      {c.render ? c.render(row) : (c.value?.(row) ?? '—')}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <div className="px-6 py-12 text-center text-base text-muted">{emptyText}</div>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5">
        <span className="text-sm text-muted">
          {visible.length ? `Mostrando ${current * pageSize + 1}–${Math.min(visible.length, current * pageSize + pageSize)} de ${fmtInt(visible.length)}` : 'Sin resultados'}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPage(Math.max(0, current - 1))}
            disabled={current === 0}
            className="h-10 cursor-pointer rounded-lg border border-line bg-white px-3.5 text-sm font-semibold disabled:cursor-default disabled:opacity-40"
          >
            Anterior
          </button>
          {Array.from({ length: to - from }, (_, i) => from + i).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setPage(n)}
              aria-current={n === current ? 'page' : undefined}
              className={cn(
                'size-10 cursor-pointer rounded-lg border text-sm font-bold',
                n === current ? 'border-navy bg-navy text-white' : 'border-line bg-white text-navy',
              )}
            >
              {n + 1}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPage(Math.min(pages - 1, current + 1))}
            disabled={current >= pages - 1}
            className="h-10 cursor-pointer rounded-lg border border-line bg-white px-3.5 text-sm font-semibold disabled:cursor-default disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
