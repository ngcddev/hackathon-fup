'use client';

import { KpiGate } from '@/components/app/KpiGate';
import { useApi } from '@/components/app/useApi';
import { OriginBadge } from '@/components/ui/Badge';
import { Card, CardTitle, MiniBar, Stat } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { fmtDate, fmtInt, fmtNum, prettyName } from '@/components/ui/format';
import type { ArrivalsInsightResponse, KpisResponse, WaitRootCauseResponse } from '@/lib/types/api';
import { EntityView } from './EntityView';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const triageLabel = (level: number | null) => (level === null ? 'Sin triage' : `Triage ${level}`);

function ArrivalsHeatmap() {
  const { data, loading, error, reload } = useApi<ArrivalsInsightResponse>('/api/insights/arrivals');
  if (loading && !data) return <div className="sgh-pulse h-[260px] rounded-2xl bg-mist" />;
  if (!data) {
    return (
      <Card className="flex flex-col items-start gap-3 p-4 sm:p-6">
        <CardTitle>Llegadas a urgencias por día y hora</CardTitle>
        <div className="text-[15px] text-muted">{error}</div>
        <button
          type="button"
          onClick={reload}
          className="h-10 cursor-pointer rounded-lg border-[1.5px] border-navy bg-white px-4 text-sm font-bold"
        >
          Reintentar
        </button>
      </Card>
    );
  }

  const max = Math.max(0.0001, ...data.cells.map((c) => c.avg_arrivals));
  const cell = (weekday: number, hour: number) =>
    data.cells.find((c) => c.weekday === weekday && c.hour === hour)?.avg_arrivals ?? 0;

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <CardTitle origin="Derivado">Llegadas a urgencias por día y hora</CardTitle>
      <div className="text-[15px] text-muted">
        Promedio de llegadas del {fmtDate(data.period_start)} al {fmtDate(data.period_end)} ({fmtInt(data.days_count)}{' '}
        días, {fmtInt(data.arrivals_total)} llegadas). Más oscuro, más llegadas.
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[44px_repeat(24,minmax(0,1fr))] gap-[2px] text-[11px] text-muted">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center">
                {h % 3 === 0 ? h : ''}
              </span>
            ))}
            {WEEKDAYS.map((name, i) => (
              <div key={name} className="contents">
                <span className="self-center pr-1 text-right text-[13px] font-semibold text-slate-700">{name}</span>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = cell(i + 1, h);
                  return (
                    <span
                      key={h}
                      title={`${name} ${String(h).padStart(2, '0')}:00 · ${fmtNum(v)} llegadas en promedio`}
                      className="h-[26px] rounded-[3px] border border-line"
                      style={{ background: `rgba(27,39,84,${(v / max).toFixed(2)})` }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {data.top_slots.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3.5">
          {data.top_slots.map((slot) => (
            <div
              key={`${slot.weekday}-${slot.hour_start}`}
              className="flex flex-col gap-1.5 rounded-xl border border-line p-4"
            >
              <div className="text-[15px] font-extrabold text-navy">
                {slot.weekday_name} {String(slot.hour_start).padStart(2, '0')}:00 –{' '}
                {String(slot.hour_end % 24).padStart(2, '0')}:00
              </div>
              <div className="text-sm text-muted">
                {fmtNum(slot.avg_arrivals)} llegadas · {fmtNum(slot.pct_above_average)} % sobre el promedio · turno{' '}
                {slot.shift}
              </div>
              <div className="text-[15px] text-slate-700">{slot.recommendation}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function WaitRootCause() {
  const { data, loading, error, reload } = useApi<WaitRootCauseResponse>('/api/insights/wait-root-cause');
  if (loading && !data) return <div className="sgh-pulse h-[200px] rounded-2xl bg-mist" />;
  if (!data) {
    return (
      <Card className="flex flex-col items-start gap-3 p-4 sm:p-6">
        <CardTitle>¿Por qué cambió la espera en urgencias?</CardTitle>
        <div className="text-[15px] text-muted">{error}</div>
        <button
          type="button"
          onClick={reload}
          className="h-10 cursor-pointer rounded-lg border-[1.5px] border-navy bg-white px-4 text-sm font-bold"
        >
          Reintentar
        </button>
      </Card>
    );
  }
  const { overall } = data;
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <CardTitle origin="Derivado">¿Por qué cambió la espera en urgencias?</CardTitle>
      <p className="m-0 text-base leading-relaxed text-slate-700">{data.summary}</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3.5">
        <div className="rounded-xl border border-line p-4">
          <div className="text-[13px] font-semibold text-muted">
            Última semana ({fmtDate(data.current_period.start)} – {fmtDate(data.current_period.end)})
          </div>
          <div className="text-[28px] font-extrabold">{fmtNum(overall.current_avg_wait_minutes)} min</div>
          <div className="text-sm text-muted">{fmtInt(overall.current_volume)} ingresos</div>
        </div>
        <div className="rounded-xl border border-line p-4">
          <div className="text-[13px] font-semibold text-muted">
            4 semanas anteriores ({fmtDate(data.baseline_period.start)} – {fmtDate(data.baseline_period.end)})
          </div>
          <div className="text-[28px] font-extrabold">{fmtNum(overall.baseline_avg_wait_minutes)} min</div>
          <div className="text-sm text-muted">{fmtInt(overall.baseline_volume)} ingresos</div>
        </div>
        <div className="rounded-xl border border-line p-4">
          <div className="text-[13px] font-semibold text-muted">Cambio</div>
          <div className="text-[28px] font-extrabold">
            {overall.change_pct === null
              ? '—'
              : `${overall.change_pct >= 0 ? '▲' : '▼'} ${fmtNum(Math.abs(overall.change_pct))} %`}
          </div>
        </div>
      </div>
      {data.top_segments.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line">
          {data.top_segments.map((s, i) => (
            <div
              key={i}
              className="grid grid-cols-1 items-center gap-1 border-t sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(90px,1fr))] sm:gap-3 border-line px-4 py-3 text-[15px] first:border-t-0"
            >
              <span className="font-bold text-navy">
                {s.weekday_name} · {s.shift === 'dia' ? 'día' : 'noche'} · {triageLabel(s.triage_level)}
              </span>
              <span>
                {fmtNum(s.baseline_avg_wait_minutes)} → <strong>{fmtNum(s.current_avg_wait_minutes)} min</strong>
              </span>
              <span className="text-muted">{fmtInt(s.current_volume)} ingresos</span>
              <span className="font-semibold">
                {s.contribution_share_pct === null ? '—' : `${fmtNum(s.contribution_share_pct)} % del cambio`}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PatientsStatus({ data }: { data: KpisResponse }) {
  const admissions = data.demand.admissions_by_service;
  const total = admissions.reduce((sum, s) => sum + s.admissions_count, 0);
  const maxAdm = Math.max(1, ...admissions.map((s) => s.admissions_count));
  const specialties = data.demand.services_by_specialty.slice(0, 8);
  const maxSpec = Math.max(1, ...specialties.map((s) => s.lines_count));
  const stay = data.avg_stay?.by_service ?? [];
  const stayCount = stay.reduce((sum, s) => sum + s.admissions_count, 0);
  const avgStay = stayCount ? stay.reduce((sum, s) => sum + s.avg_stay_days * s.admissions_count, 0) / stayCount : null;
  const wait = data.emergency_wait;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-white px-4 py-3 text-[15px] text-slate-700">
        <Icon name="shield" />
        Datos agregados y anonimizados. No se muestran nombres, documentos, motivos de consulta ni identificadores de
        paciente.
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-5">
        <Stat
          label="Ingresos del periodo"
          value={fmtInt(total)}
          sub={`${fmtDate(data.demand.period_start)} – ${fmtDate(data.demand.period_end)}`}
        />
        <Stat
          label="Estancia promedio"
          value={
            avgStay === null ? (
              '—'
            ) : (
              <>
                {fmtNum(avgStay)} <span className="text-[22px] font-bold">días</span>
              </>
            )
          }
          sub="promedio ponderado por ingresos"
          origin="Derivado"
        />
        <div className="col-span-full flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-white px-6 py-[22px] shadow-card">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[15px] font-semibold text-muted">
              Espera promedio por nivel de triage · {fmtNum(wait.avg_wait_minutes)} min general (
              {fmtDate(wait.period_start)} – {fmtDate(wait.period_end)})
            </span>
            <OriginBadge origin="Derivado" />
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,130px),1fr))] gap-2.5">
            {wait.by_triage_level.map((t) => (
              <div
                key={String(t.triage_level)}
                className="flex flex-col gap-0.5 rounded-[10px] border border-line px-3 py-2.5"
              >
                <span className="text-[13px] font-bold text-muted">{triageLabel(t.triage_level)}</span>
                <span className="text-2xl font-extrabold">{fmtNum(t.avg_wait_minutes)}</span>
                <span className="text-[13px] text-muted">min · {fmtInt(t.admissions_count)} ingresos</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,500px),1fr))] gap-5">
        <Card className="flex flex-col gap-4 p-4 sm:p-6">
          <h3 className="m-0 text-[21px] font-bold">Ingresos por servicio</h3>
          {admissions.length === 0 && <div className="text-[15px] text-muted">Sin ingresos en el periodo.</div>}
          {admissions.map((s) => (
            <div
              key={s.service}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_64px] items-center gap-3 sm:grid-cols-[minmax(140px,1fr)_minmax(0,2fr)_64px]"
            >
              <span className="text-[15px] font-semibold">{prettyName(s.service)}</span>
              <MiniBar pct={(s.admissions_count / maxAdm) * 100} />
              <span className="text-right text-[15px] font-extrabold">{fmtInt(s.admissions_count)}</span>
            </div>
          ))}
        </Card>
        <Card className="flex flex-col gap-3 p-4 sm:p-6">
          <h3 className="m-0 mb-1 text-[21px] font-bold">Servicios prestados por especialidad</h3>
          {specialties.map((s) => (
            <div
              key={s.specialty}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_64px] items-center gap-3 sm:grid-cols-[minmax(140px,1fr)_minmax(0,2fr)_64px]"
            >
              <span className="text-[15px] font-semibold">{prettyName(s.specialty)}</span>
              <MiniBar pct={(s.lines_count / maxSpec) * 100} />
              <span className="text-right text-[15px] font-extrabold">{fmtInt(s.lines_count)}</span>
            </div>
          ))}
          <div className="text-sm text-muted">Siempre de todo el hospital.</div>
        </Card>
      </div>

      <ArrivalsHeatmap />
      <WaitRootCause />
    </div>
  );
}

export function PatientsView() {
  return (
    <EntityView target={null} note="La importación incremental del HIS es solo para el rol Administrador.">
      <KpiGate label="pacientes">{(data) => <PatientsStatus data={data} />}</KpiGate>
    </EntityView>
  );
}
