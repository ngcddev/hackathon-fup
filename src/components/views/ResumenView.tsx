'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { KpiGate } from '@/components/app/KpiGate';
import { useSession } from '@/components/app/SessionProvider';
import { useApi } from '@/components/app/useApi';
import { SeverityBadge, OriginBadge, type Origin } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { fmtDate, fmtInt, fmtLongDate, fmtNum, fmtPct, fmtTime } from '@/components/ui/format';
import type { KpiAlert, KpisResponse, SourcesResponse } from '@/lib/types/api';
import { ALERT_ROUTE, ALERT_TYPE_LABEL } from './alerts-meta';

// Las 4 preguntas de la demo (mismas del plan B del agente) que se escriben solas en el buscador.
export const SUGGESTED_QUESTIONS = [
  '¿Cuál es el tiempo de espera promedio en urgencias en la última semana?',
];

function greeting(hour: number) {
  return hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
}

function shift(hour: number) {
  if (hour >= 6 && hour < 14) return 'Turno mañana · 06:00 – 14:00';
  if (hour >= 14 && hour < 22) return 'Turno tarde · 14:00 – 22:00';
  return 'Turno noche · 22:00 – 06:00';
}

// Escribe y borra las preguntas sugeridas en el placeholder del buscador.
function useTypewriter(lines: string[]) {
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    const full = lines[index];
    let wait = 38;
    let next: () => void;
    if (!erasing && count < full.length) next = () => setCount(count + 1);
    else if (!erasing) {
      wait = 2200;
      next = () => setErasing(true);
    } else if (count > 0) {
      wait = 14;
      next = () => setCount(count - 1);
    } else {
      wait = 300;
      next = () => {
        setErasing(false);
        setIndex((index + 1) % lines.length);
      };
    }
    const timer = setTimeout(next, wait);
    return () => clearTimeout(timer);
  }, [lines, index, count, erasing]);

  return { current: lines[index], typed: lines[index].slice(0, count) };
}

interface KpiTile {
  label: string;
  value: string;
  sub: string;
  href: string;
  link: string;
  origin?: Origin;
}

function tiles(data: KpisResponse): KpiTile[] {
  const occ = data.occupancy.total;
  const admissions = data.demand.admissions_by_service.reduce((sum, s) => sum + s.admissions_count, 0);
  const capacitySimulated = data.occupancy.by_subservice.some((s) => s.is_capacity_simulated);
  return [
    {
      label: 'Ocupación de camas',
      value: fmtPct(occ.occupancy_pct),
      sub: `${fmtInt(occ.occupied_beds)} ocupadas / ${fmtInt(occ.capacity)} camas`,
      href: '/camas',
      link: 'camas',
      origin: capacitySimulated ? 'Simulado' : 'Derivado',
    },
    {
      label: 'Espera en urgencias',
      value: `${fmtNum(data.emergency_wait.avg_wait_minutes)} min`,
      sub: 'promedio, última semana',
      href: '/pacientes',
      link: 'pacientes',
      origin: 'Derivado',
    },
    {
      label: 'Medicamentos críticos',
      value: fmtInt(data.critical_drugs.count),
      sub: `con menos de ${data.critical_drugs.threshold_days} días de inventario`,
      href: '/medicamentos',
      link: 'medicamentos',
      origin: data.critical_drugs.includes_simulated_data ? 'Simulado' : undefined,
    },
    {
      label: 'Cumplimiento quirúrgico',
      value: `${fmtNum(data.surgeries.compliance_pct)} %`,
      sub: `sobre ${fmtInt(data.surgeries.universe_total)} programaciones`,
      href: '/cirugias',
      link: 'cirugías',
      origin: 'Derivado',
    },
    {
      label: 'Ingresos del periodo',
      value: fmtInt(admissions),
      sub: `${fmtDate(data.demand.period_start)} – ${fmtDate(data.demand.period_end)}`,
      href: '/pacientes',
      link: 'ingresos',
    },
  ];
}

function TrendMini({ days }: { days: { day: string; occupancy_pct: number }[] }) {
  if (days.length < 2) return null;
  const values = days.map((d) => d.occupancy_pct);
  const lo = Math.floor(Math.min(...values, 80) / 10) * 10 - 10;
  const hi = Math.ceil(Math.max(...values, 90) / 10) * 10;
  const y = (v: number) => 120 - ((v - lo) / (hi - lo)) * 120;
  const x = (i: number) => (i * 600) / (values.length - 1);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = days[days.length - 1];
  return (
    <>
      <svg viewBox="0 0 600 120" preserveAspectRatio="none" width="100%" height="120" className="block" role="img" aria-label="Ocupación de los últimos 30 días">
        <line x1="0" x2="600" y1={y(85)} y2={y(85)} stroke="#64748B" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
        <path d={`${line} L600,120 L0,120 Z`} fill="rgba(76,140,35,0.12)" />
        <path d={line} fill="none" stroke="#4C8C23" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-sm text-muted">
        <span>{fmtDate(days[0].day).slice(0, 5)}</span>
        <span>Umbral 85 % (línea punteada)</span>
        <span className="font-extrabold text-ink">Hoy {fmtPct(last.occupancy_pct)}</span>
      </div>
    </>
  );
}

function AlertCard({ alert }: { alert: KpiAlert }) {
  const route = ALERT_ROUTE[alert.type];
  const critical = alert.severity === 'critical';
  return (
    <Link
      href={route.href}
      className={`flex flex-col gap-2 rounded-xl border px-[18px] py-4 text-ink no-underline hover:border-leaf hover:text-ink ${critical ? 'border-danger-line' : 'border-warn-line'}`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <SeverityBadge severity={alert.severity} />
        <span className="text-sm font-semibold text-muted">{ALERT_TYPE_LABEL[alert.type]}</span>
        {alert.is_simulated && <OriginBadge origin="Simulado" />}
      </div>
      <div className="text-[17px] font-bold">{alert.title}</div>
      <div className="text-[15px] text-muted">{alert.message}</div>
      <div className="text-[15px] text-slate-700">{alert.recommendation}</div>
    </Link>
  );
}

function DataStatus() {
  const { data, error, loading } = useApi<SourcesResponse>('/api/sources');
  const problems = data?.batches.filter((b) => b.status === 'rejected').length;
  const value = (v: string | undefined) => (loading ? '…' : (v ?? '—'));
  return (
    <Card className="flex flex-1 flex-col gap-3.5 p-4 sm:p-6">
      <h3 className="m-0 text-[21px] font-bold">Estado de los datos</h3>
      <div className="grid grid-cols-3 gap-3.5">
        <div>
          <div className="text-sm font-semibold text-muted">Última carga aplicada</div>
          <div className="mt-1 text-xl font-extrabold">{value(data?.last_load_at ? fmtDate(data.last_load_at) : undefined)}</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-muted">Datos simulados</div>
          <div className="mt-1 text-xl font-extrabold">{value(data ? fmtPct(data.simulated_pct) : undefined)}</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-muted">Cargas con problemas</div>
          <div className="mt-1 text-xl font-extrabold">{value(problems === undefined ? undefined : fmtInt(problems))}</div>
        </div>
      </div>
      {error && <div className="text-sm text-muted">El estado de las fuentes no está disponible por ahora.</div>}
      <Link href="/fuentes" className="text-[15px] font-bold">
        Revisar fuentes de datos →
      </Link>
    </Card>
  );
}

export function ResumenView() {
  const router = useRouter();
  const { me, roleLabel, can } = useSession();
  const [query, setQuery] = useState('');
  const [now, setNow] = useState<Date | null>(null);
  const { current, typed } = useTypewriter(SUGGESTED_QUESTIONS);

  useEffect(() => {
    // La hora del navegador solo se lee ya montado para no romper la hidratación.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
  }, []);

  const ask = (question: string) => {
    if (question.trim()) router.push(`/agente?q=${encodeURIComponent(question.trim())}&send=1&n=${Date.now()}`);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(query || current);
  };

  return (
    <KpiGate label="el resumen">
      {(data) => {
        const trend = data.occupancy_trend?.days ?? [];
        const delta = trend.length >= 2 ? trend[trend.length - 1].occupancy_pct - trend[trend.length - 2].occupancy_pct : null;
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <h2 className="m-0 text-[22px] font-extrabold tracking-tight text-navy sm:text-[28px]">
                  {now ? greeting(now.getHours()) : 'Hola'}, {me.full_name}
                </h2>
                <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[15px] text-muted">
                  <span className="font-semibold text-ink">{fmtLongDate(data.reference_date)}</span>
                  {now && <span>{shift(now.getHours())}</span>}
                  <span>Datos actualizados a las {fmtTime(data.generated_at)}</span>
                  <span>{roleLabel}</span>
                </div>
              </div>
              {delta !== null && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-muted">Frente a ayer</span>
                  <span
                    title={`${fmtPct(trend[trend.length - 1].occupancy_pct)} hoy, ${fmtPct(trend[trend.length - 2].occupancy_pct)} ayer`}
                    className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full border border-line bg-white px-3 py-1 text-[13px]"
                  >
                    <span className="font-medium text-muted">Ocupación</span>
                    <span className="font-extrabold text-navy">
                      {delta >= 0 ? '▲' : '▼'} {fmtNum(Math.abs(delta))} pp
                    </span>
                  </span>
                </div>
              )}
            </div>

            {can('agent:query') && (
              <Card className="flex flex-col gap-3 px-5 py-4">
                <form onSubmit={submit} className="flex flex-wrap items-center gap-2.5">
                  <span className="flex items-center gap-2 whitespace-nowrap text-[15px] font-bold text-navy">Pregúntale a Healthy</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Tab' && !query) {
                        e.preventDefault();
                        setQuery(current);
                      }
                    }}
                    placeholder={typed + (query ? '' : '▏')}
                    aria-label="Pregunta para la IA"
                    className="h-11 min-w-0 flex-1 basis-full rounded-full sm:min-w-[240px] sm:basis-0 border border-line bg-canvas px-[18px] text-[15px] outline-none focus:border-leaf focus:bg-white focus:shadow-[0_0_0_3px_rgba(76,140,35,0.2)]"
                  />
                  <button
                    type="submit"
                    className="h-11 cursor-pointer rounded-lg border-[1.5px] border-navy bg-white px-[18px] text-[15px] font-bold text-navy hover:bg-navy hover:text-white"
                  >
                    Preguntar
                  </button>
                </form>
              </Card>
            )}

            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
              {tiles(data).map((k) => (
                <Link
                  key={k.label}
                  href={k.href}
                  className="flex flex-col gap-1.5 rounded-2xl border border-line bg-white px-[22px] py-5 text-ink no-underline shadow-card hover:border-leaf hover:text-ink"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold text-muted">{k.label}</span>
                    {k.origin && <OriginBadge origin={k.origin} />}
                  </div>
                  <div className="text-[32px] font-extrabold sm:text-[40px] leading-[1.1] tracking-tight">{k.value}</div>
                  <span className="text-sm text-muted">{k.sub}</span>
                  <span className="mt-1.5 text-sm font-bold">Ver {k.link} →</span>
                </Link>
              ))}
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,480px),1fr))] gap-5">
              <Card className="flex flex-col gap-3.5 p-4 sm:p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="m-0 text-[21px] font-bold">Alertas prioritarias</h3>
                  <Link href="/alertas" className="text-[15px] font-bold">
                    Ver todas
                  </Link>
                </div>
                {data.alerts.length === 0 && <div className="text-[15px] text-muted">No hay alertas activas.</div>}
                {data.alerts.slice(0, 2).map((a) => (
                  <AlertCard key={a.id} alert={a} />
                ))}
              </Card>

              <div className="flex flex-col gap-5">
                {trend.length > 1 && (
                  <Card className="flex flex-col gap-3 p-4 sm:p-6">
                    <CardTitle origin="Derivado">Ocupación · últimos 30 días</CardTitle>
                    <TrendMini days={trend} />
                  </Card>
                )}
                <DataStatus />
              </div>
            </div>
          </div>
        );
      }}
    </KpiGate>
  );
}
