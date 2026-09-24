import { queryAsAppBackend } from '@/lib/db';
import type { ArrivalsCell, ArrivalsInsightResponse, ArrivalsPeak, IsoDate } from '@/lib/types/api';
import { SHIFT_LABEL, shiftOfHour, weekdayName, type ShiftKey } from './labels';

// D6, mapa de calor de llegadas a urgencias.
// Llegadas = ingresos con admission_route = 'Urgencias' de agent.v_admissions, por admitted_at
// (todas, tengan o no atención registrada). Periodo: del primer día con llegadas a reference_date.
// Promedio por día de la semana y hora = llegadas ÷ número de veces que ese día de la semana
// aparece en el periodo. Franjas de 2 horas (0-2, 2-4, ... 22-24); el promedio de referencia es
// el de las 84 franjas de la semana.

const SLOT_HOURS = 2;
const TOP_SLOTS = 3;

export interface ArrivalsRow {
  weekday: number;
  hour: number;
  arrivals: number;
}

export interface ArrivalsPeriod {
  period_start: IsoDate;
  period_end: IsoDate;
  days_count: number;
  occurrences: Record<number, number>; // veces que aparece cada día de la semana (1 a 7)
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

export function buildArrivals(
  rows: ArrivalsRow[],
  period: ArrivalsPeriod,
  reference_date: IsoDate,
): ArrivalsInsightResponse {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(`${r.weekday}:${r.hour}`, r.arrivals);
  const count = (weekday: number, hour: number) => counts.get(`${weekday}:${hour}`) ?? 0;
  const avg = (weekday: number, hour: number) => {
    const occurrences = period.occurrences[weekday] ?? 0;
    return occurrences > 0 ? count(weekday, hour) / occurrences : 0;
  };

  const cells: ArrivalsCell[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      cells.push({ weekday, hour, avg_arrivals: round(avg(weekday, hour), 2) });
    }
  }

  const slots: { weekday: number; hour_start: number; avg: number; shift: ShiftKey }[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let hour_start = 0; hour_start < 24; hour_start += SLOT_HOURS) {
      let total = 0;
      const byShift: Record<ShiftKey, number> = { dia: 0, noche: 0 };
      for (let h = hour_start; h < hour_start + SLOT_HOURS; h++) {
        total += avg(weekday, h);
        byShift[shiftOfHour(h)] += avg(weekday, h);
      }
      // Turno donde cae la mayoría de las llegadas de la franja; en empate, el de su primera hora.
      const shift: ShiftKey =
        byShift.dia === byShift.noche ? shiftOfHour(hour_start) : byShift.dia > byShift.noche ? 'dia' : 'noche';
      slots.push({ weekday, hour_start, avg: total, shift });
    }
  }
  const baseline = slots.reduce((sum, s) => sum + s.avg, 0) / slots.length;

  const top_slots: ArrivalsPeak[] = [...slots]
    .sort((a, b) => b.avg - a.avg || a.weekday - b.weekday || a.hour_start - b.hour_start)
    .slice(0, TOP_SLOTS)
    .map((s) => {
      const pct_above_average = baseline > 0 ? Math.round((100 * (s.avg - baseline)) / baseline) : 0;
      const hour_end = s.hour_start + SLOT_HOURS;
      return {
        weekday: s.weekday,
        weekday_name: weekdayName(s.weekday),
        hour_start: s.hour_start,
        hour_end,
        avg_arrivals: round(s.avg, 1),
        pct_above_average,
        shift: s.shift,
        recommendation:
          `${weekdayName(s.weekday)} de ${s.hour_start} a ${hour_end}: ${pct_above_average} % por encima del promedio; ` +
          `reforzar el turno ${SHIFT_LABEL[s.shift]}.`,
      };
    });

  return {
    scope: 'hospital',
    period_start: period.period_start,
    period_end: period.period_end,
    days_count: period.days_count,
    arrivals_total: rows.reduce((sum, r) => sum + r.arrivals, 0),
    avg_arrivals_per_slot: round(baseline, 2),
    cells,
    top_slots,
    reference_date,
    generated_at: new Date().toISOString(),
  };
}

export async function getArrivalsInsight(): Promise<ArrivalsInsightResponse> {
  const [rows, periodRows] = await Promise.all([
    queryAsAppBackend<ArrivalsRow>(
      `SELECT EXTRACT(ISODOW FROM a.admitted_at)::int AS weekday,
              EXTRACT(HOUR FROM a.admitted_at)::int AS hour,
              COUNT(*)::int AS arrivals
         FROM agent.v_admissions a
        WHERE a.admission_route = 'Urgencias'
          AND a.admitted_at < (SELECT agent.reference_date()) + 1
        GROUP BY 1, 2`,
    ),
    queryAsAppBackend<{ period_start: IsoDate; period_end: IsoDate; weekday: number; occurrences: number }>(
      `WITH bounds AS (
         SELECT MIN(a.admitted_at)::date AS d0, agent.reference_date() AS d1
           FROM agent.v_admissions a
          WHERE a.admission_route = 'Urgencias'
            AND a.admitted_at < (SELECT agent.reference_date()) + 1
       )
       SELECT b.d0 AS period_start, b.d1 AS period_end,
              EXTRACT(ISODOW FROM g.day)::int AS weekday, COUNT(*)::int AS occurrences
         FROM bounds b
         CROSS JOIN LATERAL generate_series(b.d0, b.d1, interval '1 day') AS g(day)
        GROUP BY 1, 2, 3`,
    ),
  ]);
  const occurrences: Record<number, number> = {};
  for (const r of periodRows) occurrences[r.weekday] = r.occurrences;
  const days_count = Object.values(occurrences).reduce((sum, n) => sum + n, 0);
  const period: ArrivalsPeriod = {
    period_start: periodRows[0]?.period_start ?? '',
    period_end: periodRows[0]?.period_end ?? '',
    days_count,
    occurrences,
  };
  return buildArrivals(rows, period, period.period_end);
}
