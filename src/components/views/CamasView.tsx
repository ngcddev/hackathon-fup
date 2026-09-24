'use client';

import { KpiGate } from '@/components/app/KpiGate';
import { OriginBadge, SeverityBadge, type Severity } from '@/components/ui/Badge';
import { Card, CardTitle, MiniBar, ProgressBar, Stat } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/States';
import { fmtDate, fmtDayMonth, fmtInt, fmtNum, fmtPct, prettyName } from '@/components/ui/format';
import { OCCUPANCY_THRESHOLDS } from '@/lib/alerts/thresholds';
import type { KpisResponse, OccupancyBySubservice, OccupancyTrendPoint } from '@/lib/types/api';
import { EntityView } from './EntityView';

const severityOf = (pct: number): Severity | null =>
  pct >= OCCUPANCY_THRESHOLDS.critical_pct ? 'critical' : pct >= OCCUPANCY_THRESHOLDS.warning_pct ? 'warning' : null;

function TrendChart({ days }: { days: OccupancyTrendPoint[] }) {
  const values = days.map((d) => d.occupancy_pct);
  const lo = Math.max(0, Math.floor((Math.min(...values, OCCUPANCY_THRESHOLDS.warning_pct) - 5) / 10) * 10);
  const hi = 100;
  const H = 220;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const x = (i: number) => (i * 600) / Math.max(1, values.length - 1);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = [0, 1, 2, 3, 4].map((i) => hi - ((hi - lo) / 4) * i);
  const labelAt = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => days[Math.round(f * (days.length - 1))].day);

  return (
    <>
      <div className="flex gap-2.5">
        <div className="flex h-[220px] w-10 flex-col justify-between text-right text-[13px] text-muted">
          {ticks.map((t) => (
            <span key={t}>{Math.round(t)} %</span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <svg viewBox={`0 0 600 ${H}`} preserveAspectRatio="none" width="100%" height={H} className="block overflow-visible" role="img" aria-label="Ocupación diaria de los últimos 30 días">
            {ticks.map((t) => (
              <line key={t} x1="0" x2="600" y1={y(t)} y2={y(t)} stroke="#EEF2F6" vectorEffect="non-scaling-stroke" />
            ))}
            <line x1="0" x2="600" y1={y(OCCUPANCY_THRESHOLDS.warning_pct)} y2={y(OCCUPANCY_THRESHOLDS.warning_pct)} stroke="#64748B" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
            <path d={`${line} L600,${H} L0,${H} Z`} fill="rgba(76,140,35,0.12)" />
            <path d={line} fill="none" stroke="#4C8C23" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          <div className="mt-2 flex justify-between text-[13px] text-muted">
            {labelAt.map((d) => (
              <span key={d}>{fmtDayMonth(d)}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-5 text-sm text-muted">
        <span className="flex items-center gap-2">
          <span className="h-[3px] w-[18px] bg-navy" />
          Ocupación diaria
        </span>
        <span className="flex items-center gap-2">
          <span className="w-[18px] border-t-2 border-dashed border-slate-500" />
          Umbral de advertencia {OCCUPANCY_THRESHOLDS.warning_pct} %
        </span>
      </div>
    </>
  );
}

function groupBySubservice(data: KpisResponse) {
  const groups = new Map<string, OccupancyBySubservice[]>();
  for (const sub of data.occupancy.by_subservice) groups.set(sub.service, [...(groups.get(sub.service) ?? []), sub]);
  return data.occupancy.by_service.map((service) => ({ service, subs: groups.get(service.service) ?? [] }));
}

function EstadoCamas({ data }: { data: KpisResponse }) {
  const subs = data.occupancy.by_subservice;
  if (subs.length === 0) {
    return (
      <EmptyState title={`${data.service_filter ? prettyName(data.service_filter) : 'Este servicio'} no tiene camas registradas`}>
        Elija otro servicio en el filtro del encabezado.
      </EmptyState>
    );
  }
  const total = data.occupancy.total;
  const warnings = subs.filter((s) => severityOf(s.occupancy_pct) === 'warning').length;
  const criticals = subs.filter((s) => severityOf(s.occupancy_pct) === 'critical').length;
  const trend = data.occupancy_trend?.days ?? [];
  const stay = data.avg_stay?.by_service ?? [];
  const maxStay = Math.max(7, ...stay.map((s) => s.avg_stay_days));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-5">
        <Stat label="Ocupación total" value={fmtPct(total.occupancy_pct)} origin="Derivado">
          <ProgressBar pct={total.occupancy_pct} className="mt-1.5" />
        </Stat>
        <Stat
          label="Camas ocupadas / capacidad"
          value={
            <>
              {fmtInt(total.occupied_beds)}
              <span className="font-bold text-slate-500"> / {fmtInt(total.capacity)}</span>
            </>
          }
          sub={`${fmtInt(total.capacity - total.occupied_beds)} camas disponibles`}
        />
        <Stat label={`Advertencia (≥ ${OCCUPANCY_THRESHOLDS.warning_pct} %)`} value={warnings} sub="subservicios" tone="warn" />
        <Stat label={`Crítico (≥ ${OCCUPANCY_THRESHOLDS.critical_pct} %)`} value={criticals} sub="subservicios" tone="danger" />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] items-start gap-5">
        <Card className="flex flex-col gap-5 p-6">
          <CardTitle origin="Derivado">Ocupación por servicio y subservicio</CardTitle>
          {groupBySubservice(data).map(({ service, subs: list }) => (
            <div key={service.service} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between border-b border-line pb-1.5">
                <span className="text-base font-extrabold">{prettyName(service.service)}</span>
                <span className="whitespace-nowrap text-[15px] font-bold">
                  {fmtPct(service.occupancy_pct)}{' '}
                  <span className="font-medium text-muted">
                    · {fmtInt(service.occupied_beds)}/{fmtInt(service.capacity)}
                  </span>
                </span>
              </div>
              {list.map((s) => {
                const sev = severityOf(s.occupancy_pct);
                return (
                  <div key={s.subservice} className="grid grid-cols-[minmax(140px,1.1fr)_minmax(0,2fr)_minmax(190px,auto)] items-center gap-3.5">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-[15px] font-semibold">{prettyName(s.subservice)}</span>
                      {s.is_capacity_simulated && (
                        <span className="self-start rounded-full border border-dashed border-slate-500 px-2 py-px text-[11px] font-bold text-muted">Capacidad simulada</span>
                      )}
                    </div>
                    <div className="relative h-3.5 overflow-hidden rounded-full bg-mist">
                      <div className="h-full rounded-full bg-navy" style={{ width: `${Math.min(100, s.occupancy_pct)}%` }} />
                      <span className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${OCCUPANCY_THRESHOLDS.warning_pct}%` }} />
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="whitespace-nowrap text-[15px] font-extrabold">
                        {fmtPct(s.occupancy_pct)}{' '}
                        <span className="font-medium text-muted">
                          {fmtInt(s.occupied_beds)}/{fmtInt(s.capacity)}
                        </span>
                      </span>
                      {sev && <SeverityBadge severity={sev} small />}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </Card>

        <div className="flex flex-col gap-5">
          {trend.length > 1 && (
            <Card className="flex flex-col gap-4 p-6">
              <CardTitle origin="Derivado">Ocupación diaria · últimos 30 días</CardTitle>
              <TrendChart days={trend} />
              <div className="text-sm text-muted">
                {fmtDate(trend[0].day)} – {fmtDate(trend[trend.length - 1].day)}
              </div>
            </Card>
          )}
          {stay.length > 0 && (
            <Card className="flex flex-col gap-3.5 p-6">
              <h3 className="m-0 text-[21px] font-bold">Estancia promedio por servicio</h3>
              {stay.map((e) => (
                <div key={e.service} className="grid grid-cols-[minmax(150px,1fr)_minmax(0,2fr)_80px] items-center gap-3.5">
                  <span className="text-[15px] font-semibold">{prettyName(e.service)}</span>
                  <MiniBar pct={(e.avg_stay_days / maxStay) * 100} color="bg-slate-600" />
                  <span className="text-right text-[15px] font-extrabold">{fmtNum(e.avg_stay_days)} días</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted">
        <OriginBadge origin="Derivado" />
        Ocupación calculada con el corte del {fmtDate(data.occupancy.day)}.
      </div>
    </div>
  );
}

export function CamasView() {
  return (
    <EntityView target="bed_inventory">
      <KpiGate label="camas">{(data) => <EstadoCamas data={data} />}</KpiGate>
    </EntityView>
  );
}
