// Datos de contexto para la sugerencia de una alerta: cifras reales y agregadas del hospital que
// ayudan a proponer pasos realistas (subservicios con camas libres, tendencia, altas estimadas,
// consumo por área, espera por turno). Nunca filas de pacientes (RNF-03).
// Aquí solo el SQL (vistas agent, agent.reference_date()) y el texto de cada dato; el servicio lo
// valida con validateSql y lo ejecuta con agent_ro. Sin imports del servidor: se prueba con vitest.

import type { KpiAlert } from '../types/api';
import { formatNumber } from './text';

type Row = Record<string, unknown>;

export interface ContextQuery {
  id: string;
  sql: string;
  facts: (rows: Row[]) => string[];
}

const RD = 'agent.reference_date()';
// Los valores salen del id de la alerta (armado en el servidor con datos del HIS); igual se escapan.
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const f = (v: unknown, d = 1) => formatNumber(Number(v), d);

// id de alerta → qué consultar. Formatos de buildAlerts: "occupancy:SERVICIO:SUBSERVICIO",
// "stockout:CODIGO" (o "stockout:warning-group") y "emergency_wait:triage-N".
export function contextQueriesFor(alert: KpiAlert): ContextQuery[] {
  const [type, ...rest] = alert.id.split(':');
  if (type === 'occupancy' && rest.length >= 2) return occupancyQueries(rest[0], rest.slice(1).join(':'));
  if (type === 'stockout' && rest[0] && rest[0] !== 'warning-group') return stockoutQueries(rest.join(':'));
  const triage = /^triage-(\d)$/.exec(rest[0] ?? '');
  if (type === 'emergency_wait' && triage) return waitQueries(Number(triage[1]));
  return [];
}

function occupancyQueries(service: string, subservice: string): ContextQuery[] {
  return [
    {
      id: 'siblings',
      sql: `SELECT subservice AS subservicio, occupied_beds AS ocupadas, capacity AS capacidad
FROM agent.v_bed_occupancy
WHERE day = ${RD} AND service = ${lit(service)} AND subservice <> ${lit(subservice)}
ORDER BY occupied_beds::numeric / NULLIF(capacity, 0) ASC
LIMIT 5`,
      facts: (rows) =>
        rows
          .filter((r) => n(r.capacidad))
          .map((r) => {
            const free = n(r.capacidad)! - n(r.ocupadas)!;
            const pct = (100 * n(r.ocupadas)!) / n(r.capacidad)!;
            return `${String(r.subservicio)} (mismo servicio): ${f(r.ocupadas, 0)} de ${f(r.capacidad, 0)} camas ocupadas (${f(pct)} %), ${f(Math.max(free, 0), 0)} libres.`;
          }),
    },
    {
      id: 'trend',
      sql: `SELECT MAX(occupied_beds) FILTER (WHERE day = ${RD} - 6) AS hace_7_dias,
       MAX(occupied_beds) FILTER (WHERE day = ${RD}) AS hoy
FROM agent.v_bed_occupancy
WHERE subservice = ${lit(subservice)} AND day BETWEEN ${RD} - 6 AND ${RD}
LIMIT 1`,
      facts: ([r]) =>
        r && n(r.hace_7_dias) !== null && n(r.hoy) !== null
          ? [`Tendencia de ${subservice}: ${f(r.hace_7_dias, 0)} camas ocupadas hace 7 días y ${f(r.hoy, 0)} hoy.`]
          : [],
    },
    {
      id: 'flow',
      sql: `SELECT COUNT(*) FILTER (WHERE estimated_discharge_at >= ${RD} AND estimated_discharge_at < ${RD} + 1) AS altas_estimadas_hoy,
       COUNT(*) FILTER (WHERE admitted_at >= ${RD} - 6) AS ingresos_7d,
       COUNT(*) FILTER (WHERE admitted_at >= ${RD} - 6 AND admission_route = 'Urgencias') AS ingresos_7d_urgencias,
       COUNT(*) FILTER (WHERE admitted_at < ${RD} - 6) AS ingresos_7d_anteriores
FROM agent.v_admissions
WHERE subservice = ${lit(subservice)} AND admitted_at >= ${RD} - 29 AND admitted_at < ${RD} + 1
LIMIT 1`,
      facts: ([r]) => {
        if (!r) return [];
        const out: string[] = [];
        if (n(r.altas_estimadas_hoy)) {
          out.push(
            `Pacientes de ${subservice} con alta estimada para hoy según el HIS: ${f(r.altas_estimadas_hoy, 0)}.`,
          );
        }
        out.push(
          `Ingresos a ${subservice} en los últimos 7 días: ${f(r.ingresos_7d, 0)} (${f(r.ingresos_7d_urgencias, 0)} desde urgencias).`,
        );
        return out;
      },
    },
  ];
}

function stockoutQueries(itemCode: string): ContextQuery[] {
  return [
    {
      id: 'areas',
      sql: `SELECT area_name AS area, SUM(total_quantity)::int AS unidades
FROM agent.v_drug_consumption_daily
WHERE item_code = ${lit(itemCode)} AND day >= (SELECT ${RD}) - 29 AND day <= (SELECT ${RD})
GROUP BY area_name
ORDER BY unidades DESC
LIMIT 3`,
      facts: (rows) =>
        rows.length === 0
          ? []
          : [
              `Áreas que más lo consumieron en 30 días: ${rows.map((r) => `${String(r.area)} (${f(r.unidades, 0)} unidades)`).join('; ')}.`,
            ],
    },
    {
      id: 'consumption_trend',
      sql: `SELECT SUM(total_quantity) FILTER (WHERE day > (SELECT ${RD}) - 7)::int AS ultimos_7,
       SUM(total_quantity) FILTER (WHERE day <= (SELECT ${RD}) - 7)::int AS anteriores_7
FROM agent.v_drug_consumption_daily
WHERE item_code = ${lit(itemCode)} AND day > (SELECT ${RD}) - 14 AND day <= (SELECT ${RD})
LIMIT 1`,
      facts: ([r]) =>
        r && n(r.ultimos_7) !== null && n(r.anteriores_7) !== null
          ? [
              `Consumo de los últimos 7 días: ${f(r.ultimos_7, 0)} unidades; 7 días anteriores: ${f(r.anteriores_7, 0)}.`,
            ]
          : [],
    },
  ];
}

const SHIFT: Record<string, string> = { dia: 'día (7:00 a 18:59)', noche: 'noche' };

function waitQueries(triage: number): ContextQuery[] {
  return [
    {
      id: 'by_shift',
      sql: `SELECT shift AS turno, COUNT(*) AS ingresos, ROUND(AVG(wait_minutes), 1) AS espera
FROM agent.v_emergency_wait_times
WHERE triage_level = ${triage} AND admitted_at >= ${RD} - 6 AND admitted_at < ${RD} + 1
GROUP BY shift
ORDER BY shift
LIMIT 2`,
      facts: (rows) =>
        rows.map(
          (r) =>
            `Triage ${triage}, turno ${SHIFT[String(r.turno)] ?? String(r.turno)}, última semana: ${f(r.ingresos, 0)} ingresos con ${f(r.espera)} min de espera promedio.`,
        ),
    },
    {
      id: 'peak_hours',
      sql: `SELECT hour AS hora, COUNT(*) AS llegadas
FROM agent.v_emergency_wait_times
WHERE triage_level = ${triage} AND admitted_at >= ${RD} - 29 AND admitted_at < ${RD} + 1
GROUP BY hour
ORDER BY llegadas DESC, hour
LIMIT 3`,
      facts: (rows) =>
        rows.length === 0
          ? []
          : [
              `Horas con más llegadas de triage ${triage} en 30 días: ${rows.map((r) => `${f(r.hora, 0)}:00 (${f(r.llegadas, 0)})`).join(', ')}.`,
            ],
    },
  ];
}
