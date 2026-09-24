import { queryAsAppBackend } from '@/lib/db';
import type { IsoDate, WaitOverall, WaitRootCauseResponse, WaitRootCauseSegment } from '@/lib/types/api';
import { weekdayName, SHIFT_LABEL, type ShiftKey } from './labels';

// D7, causa raíz de los tiempos de espera.
// Compara la última semana (reference_date − 6 a reference_date) con las 4 semanas anteriores
// (28 días, reference_date − 34 a reference_date − 7), por admitted_at como DAS-02. Segmenta por
// turno × día de la semana × triage_level (los ingresos sin triage son su propio nivel).
//   cambio          = espera promedio actual − espera promedio de la línea base
//   aporte          = cambio × ingresos del segmento en la última semana
//   aporte al total = aporte ÷ (cambio global × ingresos globales de la última semana)
// Los segmentos con menos de MIN_SEGMENT_VOLUME ingresos en la última semana o en la línea base
// no se reportan. Se devuelven los 3 que más aportan en la dirección del cambio global.
// La frase se arma con plantilla, sin LLM.

export const MIN_SEGMENT_VOLUME = 10;
const TOP = 3;
const FLAT_PCT = 5; // un cambio de hasta 5 % se considera sin cambio

export interface WaitGroupRow {
  period: 'current' | 'baseline';
  shift: ShiftKey;
  weekday: number;
  triage_level: number | null;
  n: number;
  total_minutes: number;
}

export interface WaitPeriods {
  current: { start: IsoDate; end: IsoDate };
  baseline: { start: IsoDate; end: IsoDate };
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;
const fmtPct = (value: number) => String(value).replace('.', ',');

function overallOf(rows: WaitGroupRow[]): WaitOverall {
  const sum = (period: WaitGroupRow['period']) => {
    const own = rows.filter((r) => r.period === period);
    return { n: own.reduce((a, r) => a + r.n, 0), minutes: own.reduce((a, r) => a + r.total_minutes, 0) };
  };
  const cur = sum('current');
  const base = sum('baseline');
  const curAvg = cur.n > 0 ? cur.minutes / cur.n : 0;
  const baseAvg = base.n > 0 ? base.minutes / base.n : 0;
  return {
    current_avg_wait_minutes: round(curAvg, 1),
    baseline_avg_wait_minutes: round(baseAvg, 1),
    change_pct: baseAvg > 0 ? round((100 * (curAvg - baseAvg)) / baseAvg, 1) : null,
    current_volume: cur.n,
    baseline_volume: base.n,
  };
}

function triageLabel(level: number | null): string {
  return level === null ? 'ingresos sin triage' : `triage ${level}`;
}

export function buildSummary(overall: WaitOverall, top: WaitRootCauseSegment | undefined): string {
  const cur = Math.round(overall.current_avg_wait_minutes);
  const base = Math.round(overall.baseline_avg_wait_minutes);
  const pct = overall.change_pct;
  if (pct === null || overall.current_volume === 0) {
    return 'No hay datos suficientes para comparar la espera de la última semana con las 4 semanas anteriores.';
  }
  if (Math.abs(pct) <= FLAT_PCT) {
    return (
      `La espera promedio no cambió de forma relevante: ${cur} min frente a ${base} min ` +
      `en las 4 semanas anteriores (${pct > 0 ? '+' : ''}${fmtPct(pct)} %).`
    );
  }
  const where = top
    ? `${triageLabel(top.triage_level)} del turno ${SHIFT_LABEL[top.shift]} de los ${weekdayName(top.weekday).toLowerCase()}`
    : null;
  const detail = top
    ? `: ${Math.round(top.current_avg_wait_minutes)} min frente a ${Math.round(top.baseline_avg_wait_minutes)} min en las 4 semanas anteriores`
    : '';
  if (pct < 0) {
    return top
      ? `La espera bajó ${fmtPct(Math.abs(pct))} % (${cur} min frente a ${base} min). La mayor mejora está en ${where}${detail}.`
      : `La espera bajó ${fmtPct(Math.abs(pct))} % (${cur} min frente a ${base} min en las 4 semanas anteriores).`;
  }
  return top
    ? `El aumento de la espera se concentra en ${where}${detail}.`
    : `La espera subió ${fmtPct(pct)} % (${cur} min frente a ${base} min), sin un segmento con suficientes ingresos que lo explique.`;
}

export function buildWaitRootCause(
  rows: WaitGroupRow[],
  periods: WaitPeriods,
  reference_date: IsoDate,
): WaitRootCauseResponse {
  const overall = overallOf(rows);
  const totalChange =
    overall.baseline_volume > 0
      ? (overall.current_avg_wait_minutes - overall.baseline_avg_wait_minutes) * overall.current_volume
      : 0;

  const bySegment = new Map<string, { cur?: WaitGroupRow; base?: WaitGroupRow }>();
  for (const r of rows) {
    const key = `${r.shift}:${r.weekday}:${r.triage_level}`;
    const entry = bySegment.get(key) ?? {};
    if (r.period === 'current') entry.cur = r;
    else entry.base = r;
    bySegment.set(key, entry);
  }

  const segments: WaitRootCauseSegment[] = [];
  for (const { cur, base } of bySegment.values()) {
    if (!cur || !base || cur.n < MIN_SEGMENT_VOLUME || base.n < MIN_SEGMENT_VOLUME) continue;
    const curAvg = cur.total_minutes / cur.n;
    const baseAvg = base.total_minutes / base.n;
    const change = curAvg - baseAvg;
    const contribution = change * cur.n;
    segments.push({
      shift: cur.shift,
      weekday: cur.weekday,
      weekday_name: weekdayName(cur.weekday),
      triage_level: cur.triage_level,
      current_avg_wait_minutes: round(curAvg, 1),
      baseline_avg_wait_minutes: round(baseAvg, 1),
      change_minutes: round(change, 1),
      change_pct: baseAvg > 0 ? round((100 * change) / baseAvg, 1) : null,
      current_volume: cur.n,
      baseline_volume: base.n,
      contribution_minutes: round(contribution, 1),
      contribution_share_pct: totalChange !== 0 ? round((100 * contribution) / totalChange, 1) : null,
    });
  }

  // En la dirección del cambio global: si la espera subió, los que más suben; si bajó, los que más bajan.
  const direction = totalChange < 0 ? -1 : 1;
  const top_segments = segments
    .sort((a, b) => direction * (b.contribution_minutes - a.contribution_minutes))
    .slice(0, TOP);

  return {
    scope: 'hospital',
    current_period: periods.current,
    baseline_period: periods.baseline,
    min_segment_volume: MIN_SEGMENT_VOLUME,
    overall,
    top_segments,
    summary: buildSummary(overall, top_segments[0]),
    reference_date,
    generated_at: new Date().toISOString(),
  };
}

export async function getWaitRootCause(): Promise<WaitRootCauseResponse> {
  const [rows, periods] = await Promise.all([
    queryAsAppBackend<WaitGroupRow>(
      `SELECT CASE WHEN w.admitted_at >= (SELECT agent.reference_date()) - 6 THEN 'current' ELSE 'baseline' END AS period,
              w.shift, w.weekday, w.triage_level,
              COUNT(*)::int AS n,
              SUM(w.wait_minutes)::float8 AS total_minutes
         FROM agent.v_emergency_wait_times w
        WHERE w.admitted_at >= (SELECT agent.reference_date()) - 34
          AND w.admitted_at <  (SELECT agent.reference_date()) + 1
        GROUP BY 1, 2, 3, 4`,
    ),
    queryAsAppBackend<{ ref: IsoDate; current_start: IsoDate; baseline_start: IsoDate; baseline_end: IsoDate }>(
      `SELECT agent.reference_date() AS ref,
              agent.reference_date() - 6 AS current_start,
              agent.reference_date() - 34 AS baseline_start,
              agent.reference_date() - 7 AS baseline_end`,
    ),
  ]);
  const p = periods[0];
  return buildWaitRootCause(
    rows,
    {
      current: { start: p.current_start, end: p.ref },
      baseline: { start: p.baseline_start, end: p.baseline_end },
    },
    p.ref,
  );
}
