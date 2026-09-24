'use client';

import { KpiGate } from '@/components/app/KpiGate';
import { Card, Stat } from '@/components/ui/Card';
import { fmtInt, fmtMonthShort, fmtNum } from '@/components/ui/format';
import type { KpisResponse } from '@/lib/types/api';
import { SURGERY_GOAL_PCT } from './alerts-meta';
import { EntityView } from './EntityView';

function niceMax(value: number): number {
  const step = value > 200 ? 100 : value > 80 ? 40 : 20;
  return Math.max(step, Math.ceil(value / step) * step);
}

function MonthlyChart({ months }: { months: KpisResponse['surgeries']['by_month'] }) {
  const H = 280;
  const W = 800;
  const slot = W / months.length;
  const max = niceMax(Math.max(...months.map((m) => m.scheduled)));
  const ticks = [0, 1, 2, 3, 4].map((i) => Math.round(max - (max / 4) * i));
  const line = months
    .map(
      (m, i) => `${i ? 'L' : 'M'}${(i * slot + slot / 2).toFixed(1)},${(H - (m.compliance_pct / 100) * H).toFixed(1)}`,
    )
    .join(' ');
  const metaY = H - (SURGERY_GOAL_PCT / 100) * H;
  const bar = Math.min(30, slot / 3);

  return (
    <div className="flex gap-2.5">
      <div className="flex h-[280px] w-9 flex-col justify-between text-right text-[13px] text-muted">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          width="100%"
          height={H}
          className="block overflow-visible"
          role="img"
          aria-label="Cirugías programadas y realizadas por mes"
        >
          {[0, 70, 140, 210].map((y) => (
            <line key={y} x1="0" x2={W} y1={y} y2={y} stroke="#EEF2F6" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1="0" x2={W} y1={H} y2={H} stroke="#CBD5E1" vectorEffect="non-scaling-stroke" />
          {months.map((m, i) => {
            const x0 = i * slot + slot / 2;
            const h1 = (m.scheduled / max) * H;
            const h2 = (m.performed / max) * H;
            return (
              <g key={m.month}>
                <rect
                  x={x0 - bar - 2}
                  y={H - h1}
                  width={bar}
                  height={h1}
                  fill="#fff"
                  stroke="#1B2754"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
                <rect x={x0 + 2} y={H - h2} width={bar} height={h2} fill="#1B2754" />
              </g>
            );
          })}
          <line
            x1="0"
            x2={W}
            y1={metaY}
            y2={metaY}
            stroke="#1B2754"
            strokeWidth="2"
            strokeDasharray="8 6"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={line}
            fill="none"
            stroke="#475569"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
        <div className="mt-2.5 grid text-center" style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }}>
          {months.map((m) => (
            <div key={m.month} className="flex flex-col gap-0.5">
              <span className="text-sm font-bold">{fmtMonthShort(m.month)}</span>
              <span className="text-[13px] text-muted">{fmtNum(m.compliance_pct)} %</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex h-[280px] w-11 flex-col justify-between text-[13px] text-muted">
        {['100 %', '75 %', '50 %', '25 %', '0 %'].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function SurgeriesStatus({ data }: { data: KpisResponse }) {
  const s = data.surgeries;
  const months = s.by_month;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-5">
        <Stat
          label="Cumplimiento quirúrgico"
          value={`${fmtNum(s.compliance_pct)} %`}
          origin="Derivado"
          sub={`sobre ${fmtInt(s.universe_total)} programaciones con ingreso en el extracto · meta ${SURGERY_GOAL_PCT} %`}
        />
        <Stat
          label="Programadas"
          value={fmtInt(s.universe_total)}
          sub={
            months.length
              ? `${fmtMonthShort(months[0].month)} – ${fmtMonthShort(months[months.length - 1].month)}`
              : undefined
          }
        />
        <Stat
          label="Realizadas"
          value={fmtInt(s.performed_total)}
          sub={`${fmtInt(s.universe_total - s.performed_total)} no realizadas`}
        />
      </div>

      {months.length > 0 && (
        <Card className="flex flex-col gap-[18px] p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="m-0 text-[21px] font-bold">Programadas vs. realizadas por mes</h3>
            <div className="flex flex-wrap gap-[18px] text-sm text-slate-700">
              <span className="flex items-center gap-2">
                <span className="size-3.5 border-[1.5px] border-navy bg-white" />
                Programadas
              </span>
              <span className="flex items-center gap-2">
                <span className="size-3.5 bg-navy" />
                Realizadas
              </span>
              <span className="flex items-center gap-2">
                <span className="h-[3px] w-5 bg-slate-600" />
                Cumplimiento
              </span>
              <span className="flex items-center gap-2">
                <span className="w-5 border-t-2 border-dashed border-navy" />
                Meta {SURGERY_GOAL_PCT} %
              </span>
            </div>
          </div>
          <MonthlyChart months={months} />
        </Card>
      )}
    </div>
  );
}

export function SurgeriesView() {
  return (
    <EntityView target="surgery_schedules">
      <KpiGate label="cirugías">{(data) => <SurgeriesStatus data={data} />}</KpiGate>
    </EntityView>
  );
}
