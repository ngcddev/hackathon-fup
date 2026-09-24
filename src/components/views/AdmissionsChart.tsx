'use client';

import { useState } from 'react';
import { useApi } from '@/components/app/useApi';
import { ALL_HOSPITAL, useKpis } from '@/components/app/KpisProvider';
import { Card, CardTitle } from '@/components/ui/Card';
import { MONTH_SHORT, cn, fmtDate, fmtInt, prettyName } from '@/components/ui/format';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import type { AdmissionsGranularity, AdmissionsSeriesPoint, AdmissionsSeriesResponse } from '@/lib/types/api';

const GRANULARITY_TABS: TabItem<AdmissionsGranularity>[] = [
  { key: 'year', label: 'Año' },
  { key: 'month', label: 'Mes' },
  { key: 'day', label: 'Día' },
];

const CHART_HEIGHT = 280;
const CHART_WIDTH = 800;
const TICK_COUNT = 4;
const STEP_MULTIPLIERS = [1, 2, 2.5, 3, 4, 5, 6, 8, 10];
const MAX_BAR_WIDTH = 56;
const MAX_LABELLED_BARS = 12; // hasta aquí cada barra muestra su cifra; con más solo el título al pasar el cursor
const SELECT_CLASS =
  'h-10 cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 text-[15px] font-bold text-navy outline-none focus-visible:border-navy';

// Tope del eje: TICK_COUNT tramos iguales, cada uno con un valor redondo (1, 2, 2,5, 3, 4, 5, 6 u 8 por una potencia de diez).
function niceMax(value: number): number {
  const rawStep = Math.max(value, 1) / TICK_COUNT;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = STEP_MULTIPLIERS.map((m) => m * magnitude).find((candidate) => candidate >= rawStep) ?? 10 * magnitude;
  return step * TICK_COUNT;
}

function pointLabel(granularity: AdmissionsGranularity, period: string): string {
  if (granularity === 'year') return period;
  if (granularity === 'month') return MONTH_SHORT[Number(period.slice(5, 7)) - 1] ?? period;
  return String(Number(period.slice(8, 10)));
}

// En día hay hasta 31 barras: solo se rotula el 1 y cada 5 días.
function showsAxisLabel(granularity: AdmissionsGranularity, period: string): boolean {
  if (granularity !== 'day') return true;
  const day = Number(period.slice(8, 10));
  return day === 1 || day % 5 === 0;
}

function pointTitle(granularity: AdmissionsGranularity, point: AdmissionsSeriesPoint): string {
  const when =
    granularity === 'day'
      ? fmtDate(point.period)
      : granularity === 'month'
        ? `${MONTH_SHORT[Number(point.period.slice(5, 7)) - 1]} ${point.period.slice(0, 4)}`
        : point.period;
  return `${when}: ${fmtInt(point.admissions_count)} ingresos`;
}

function BarChart({ granularity, points }: { granularity: AdmissionsGranularity; points: AdmissionsSeriesPoint[] }) {
  const max = niceMax(Math.max(...points.map((p) => p.admissions_count)));
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => Math.round(max - (max / TICK_COUNT) * i));
  const slot = CHART_WIDTH / points.length;
  const barWidth = Math.min(MAX_BAR_WIDTH, slot * 0.7);
  const labelled = points.length <= MAX_LABELLED_BARS;

  return (
    <div className="flex gap-2.5">
      <div
        className="flex w-11 flex-col justify-between text-right text-[13px] text-muted"
        style={{ height: CHART_HEIGHT }}
      >
        {ticks.map((t) => (
          <span key={t}>{fmtInt(t)}</span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          width="100%"
          height={CHART_HEIGHT}
          className="block overflow-visible"
          role="img"
          aria-label="Ingresos de pacientes hospitalizados"
        >
          {ticks.slice(0, -1).map((t, i) => {
            const y = (CHART_HEIGHT / TICK_COUNT) * i;
            return (
              <line key={t} x1="0" x2={CHART_WIDTH} y1={y} y2={y} stroke="#EEF2F6" vectorEffect="non-scaling-stroke" />
            );
          })}
          <line
            x1="0"
            x2={CHART_WIDTH}
            y1={CHART_HEIGHT}
            y2={CHART_HEIGHT}
            stroke="#CBD5E1"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p, i) => {
            const height = (p.admissions_count / max) * CHART_HEIGHT;
            return (
              <rect
                key={p.period}
                x={i * slot + (slot - barWidth) / 2}
                y={CHART_HEIGHT - height}
                width={barWidth}
                height={height}
                fill="#1B2754"
              >
                <title>{pointTitle(granularity, p)}</title>
              </rect>
            );
          })}
        </svg>
        <div className="mt-2.5 grid text-center" style={{ gridTemplateColumns: `repeat(${points.length}, 1fr)` }}>
          {points.map((p) => (
            <div key={p.period} className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-bold">
                {showsAxisLabel(granularity, p.period) ? pointLabel(granularity, p.period) : ''}
              </span>
              {labelled && <span className="hidden text-[13px] text-muted sm:block">{fmtInt(p.admissions_count)}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function periodDescription(data: AdmissionsSeriesResponse): string {
  if (data.granularity === 'year') return 'por año';
  if (data.granularity === 'month') return `por mes en ${data.year}`;
  return `por día en ${MONTH_SHORT[(data.month ?? 1) - 1]} de ${data.year}`;
}

// Ingresos por año, mes o día. Año muestra todos los años; Mes, los meses de un año; Día, los días de un mes.
export function AdmissionsChart() {
  const { service } = useKpis();
  const [granularity, setGranularity] = useState<AdmissionsGranularity>('month');
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);

  const query = new URLSearchParams({ granularity });
  if (granularity !== 'year' && year !== null) query.set('year', String(year));
  if (granularity === 'day' && month !== null) query.set('month', String(month));
  if (service !== ALL_HOSPITAL) query.set('service', service);
  const { data, loading, error, reload } = useApi<AdmissionsSeriesResponse>(
    `/api/insights/admissions-series?${query.toString()}`,
  );

  const peak = data?.points.reduce<AdmissionsSeriesPoint | null>(
    (best, p) => (best === null || p.admissions_count > best.admissions_count ? p : best),
    null,
  );
  const hasData = data !== null && data.total > 0;

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <CardTitle>Ingresos de pacientes {data ? periodDescription(data) : ''}</CardTitle>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-full overflow-x-auto">
          <Tabs tabs={GRANULARITY_TABS} active={granularity} onChange={setGranularity} size="md" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {data?.year != null && (
            <label className="flex items-center gap-2 text-sm font-semibold text-muted">
              Año
              <select
                value={data.year ?? ''}
                onChange={(e) => setYear(Number(e.target.value))}
                className={SELECT_CLASS}
              >
                {(data.available_years.includes(data.year ?? 0)
                  ? data.available_years
                  : [...data.available_years, data.year ?? 0].sort((a, b) => a - b)
                ).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          )}
          {data?.month != null && (
            <label className="flex items-center gap-2 text-sm font-semibold text-muted">
              Mes
              <select
                value={data.month ?? ''}
                onChange={(e) => setMonth(Number(e.target.value))}
                className={SELECT_CLASS}
              >
                {MONTH_SHORT.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {loading && !data && <div className="sgh-pulse h-[320px] rounded-xl bg-mist" />}

      {!data && !loading && (
        <div className="flex flex-col items-start gap-3">
          <div className="text-[15px] text-muted">{error}</div>
          <button
            type="button"
            onClick={reload}
            className="h-10 cursor-pointer rounded-lg border-[1.5px] border-navy bg-white px-4 text-sm font-bold"
          >
            Reintentar
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="text-[15px] text-muted">
            {service === ALL_HOSPITAL ? 'Todo el hospital' : prettyName(service)}. Pacientes hospitalizados distintos
            por periodo.
            {hasData && peak && (
              <>
                {' '}
                Total mostrado: <strong className="text-slate-700">{fmtInt(data.total)}</strong>. Máximo:{' '}
                <strong className="text-slate-700">{fmtInt(peak.admissions_count)}</strong> (
                {data.granularity === 'day' ? 'día ' : ''}
                {pointLabel(data.granularity, peak.period)}).
              </>
            )}
          </div>
          <div className={cn('transition-opacity', loading && 'opacity-60')}>
            {hasData ? (
              <BarChart granularity={data.granularity} points={data.points} />
            ) : (
              <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[15px] text-muted">
                Sin ingresos en este periodo.
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
