// Hallazgos (AGE-06): "¿qué encontraste de novedoso?", "¿cómo vamos?", "resumen general".
// Sin LLM: se consultan varios indicadores fijos (vistas agent, agent.reference_date()), se comparan
// con su periodo anterior o con un umbral y se ordenan por qué tan llamativos son.
// Este módulo solo define la detección, el SQL y los textos; run.ts valida y ejecuta cada consulta.
// Sin imports del servidor: se prueba con vitest.

import type { AgentView } from '../types/api';
import { PLAN_B } from './plan-b';
import { formatNumber, normalizeText } from './text';

type Row = Record<string, unknown>;

// ------------------------------------------------------------------ Detección

// Piden novedades o un panorama general aunque nombren un tema.
const STRONG =
  /\b(novedos\w*|novedad\w*|hallazgos?|insights?|anomal\w*|inusual\w*|que (?:encontraste|has encontrado|descubriste|viste|miraste|notaste|observaste|hay de nuevo)|como vamos|como va el hospital|como esta el hospital|panorama|resumen general|estado general|que debo saber|que deberia saber|que esta pasando|que me recomiendas revisar)\b/;
// Solo cuentan si la pregunta no nombra un tema concreto ("diagnósticos más relevantes" no es un hallazgo).
const WEAK = /\b(interesante\w*|llamativ\w*|curios\w*|sorprend\w*|destacad\w*|relevante\w*|importante\w*)\b/;
const TOPIC =
  /\b(uci|camas?|urgencias?|medicament\w*|diagnostic\w*|cirugi\w*|servicios?|especialidad\w*|triage|inventario|ingresos?|espera)\b/;

export function isInsightsQuestion(question: string): boolean {
  const text = normalizeText(question);
  if (text === '') return false;
  return STRONG.test(text) || (WEAK.test(text) && !TOPIC.test(text));
}

// ------------------------------------------------------------------ Indicadores

export interface Finding {
  topic: string;
  text: string;
  score: number; // qué tan llamativo es: mayor primero
  followUp?: string; // pregunta del plan B para profundizar
}

export interface InsightCheck {
  id: string;
  topic: string;
  sql: string;
  views: AgentView[];
  followUp: string; // id de PLAN_B
  build: (row: Row) => Omit<Finding, 'topic' | 'followUp'> | null;
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};
const f = (v: number, d = 1) => formatNumber(v, d);
const pctChange = (now: number, before: number) => (before === 0 ? 0 : ((now - before) / before) * 100);
const direction = (change: number) => (change >= 0 ? 'más' : 'menos');
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const RD = 'agent.reference_date()';

export const INSIGHT_CHECKS: readonly InsightCheck[] = [
  {
    id: 'uci_trend',
    topic: 'Ocupación de UCI',
    views: ['v_bed_occupancy'],
    followUp: 'uci_beds_today',
    sql: `WITH d AS (
  SELECT day, SUM(occupied_beds) AS ocupadas, SUM(capacity) AS capacidad
  FROM agent.v_bed_occupancy
  WHERE service = 'UNIDAD DE CUIDADO INTENSIVO' AND day BETWEEN ${RD} - 29 AND ${RD}
  GROUP BY day
)
SELECT MAX(ocupadas) FILTER (WHERE day = ${RD})::int AS hoy,
       MAX(capacidad) FILTER (WHERE day = ${RD})::int AS capacidad,
       MAX(ocupadas) FILTER (WHERE day = ${RD} - 7)::int AS hace_7_dias,
       ROUND(AVG(100.0 * ocupadas / NULLIF(capacidad, 0)), 1) AS promedio_30d_pct
FROM d
LIMIT 1`,
    build: (r) => {
      const today = n(r.hoy);
      const cap = n(r.capacidad);
      const weekAgo = n(r.hace_7_dias);
      const avg = n(r.promedio_30d_pct);
      if (today === null || !cap || avg === null) return null;
      const pct = (100 * today) / cap;
      const vsWeek = weekAgo !== null ? `, frente a ${f(weekAgo, 0)} hace una semana` : '';
      return {
        text: `La UCI tiene ${f(today, 0)} de ${f(cap, 0)} camas ocupadas (${f(pct)} %)${vsWeek}; su promedio de los últimos 30 días es ${f(avg)} %.`,
        score: Math.abs(pct - avg) / 10 + (pct >= 85 ? 3 : 0),
      };
    },
  },
  {
    id: 'top_occupancy_service',
    topic: 'Servicio más ocupado',
    views: ['v_bed_occupancy'],
    followUp: 'occupancy_by_service_today',
    sql: `SELECT service AS servicio,
       ROUND(100.0 * SUM(occupied_beds) / NULLIF(SUM(capacity), 0), 1) AS pct
FROM agent.v_bed_occupancy
WHERE day = ${RD}
GROUP BY service
ORDER BY pct DESC NULLS LAST
LIMIT 1`,
    build: (r) => {
      const pct = n(r.pct);
      if (pct === null) return null;
      const alert =
        pct >= 90
          ? ', por encima del umbral de alerta de 90 %'
          : pct >= 85
            ? ', cerca del umbral de alerta de 90 %'
            : '';
      return {
        text: `${sentence(String(r.servicio))} es el servicio más ocupado hoy, al ${f(pct)} %${alert}.`,
        score: pct >= 90 ? 4 : pct >= 85 ? 2.5 : 1,
      };
    },
  },
  {
    id: 'critical_drugs',
    topic: 'Medicamentos críticos',
    views: ['v_drug_inventory'],
    followUp: 'drugs_below_5_days',
    sql: `SELECT item_name AS nombre, days_of_inventory AS dias, COUNT(*) OVER () AS criticos
FROM agent.v_drug_inventory
WHERE item_type = 'medicamento' AND days_of_inventory < 5
ORDER BY days_of_inventory ASC
LIMIT 1`,
    build: (r) => {
      const count = n(r.criticos);
      const days = n(r.dias);
      if (!count || days === null) return null;
      return {
        text: `Hay ${f(count, 0)} medicamentos con menos de 5 días de inventario; el más urgente es ${String(r.nombre)}, con ${f(days)} días.`,
        score: 3 + Math.min(count, 10) / 10,
      };
    },
  },
  {
    id: 'untriaged_wait',
    topic: 'Espera sin triage',
    views: ['v_emergency_wait_times'],
    followUp: 'emergency_wait_by_triage_month',
    sql: `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE triage_level IS NULL) / NULLIF(COUNT(*), 0), 1) AS pct_sin_triage,
       ROUND(AVG(wait_minutes) FILTER (WHERE triage_level IS NULL), 1) AS espera_sin_triage,
       ROUND(AVG(wait_minutes) FILTER (WHERE triage_level IS NOT NULL), 1) AS espera_con_triage
FROM agent.v_emergency_wait_times
WHERE admitted_at >= ${RD} - 29 AND admitted_at < ${RD} + 1
LIMIT 1`,
    build: (r) => {
      const share = n(r.pct_sin_triage);
      const without = n(r.espera_sin_triage);
      const withT = n(r.espera_con_triage);
      if (share === null || without === null || !withT) return null;
      const ratio = without / withT;
      return {
        text: `En urgencias, el ${f(share)} % de los pacientes no tiene triage registrado y espera ${f(without)} min en promedio, ${f(ratio)} veces más que quienes sí lo tienen (${f(withT)} min).`,
        score: ratio >= 1.5 ? 1 + ratio : 0.5,
      };
    },
  },
  {
    id: 'emergency_wait_trend',
    topic: 'Espera en urgencias',
    views: ['v_emergency_wait_times'],
    followUp: 'emergency_wait_week',
    sql: `SELECT ROUND(AVG(wait_minutes) FILTER (WHERE admitted_at >= ${RD} - 6), 1) AS semana,
       ROUND(AVG(wait_minutes) FILTER (WHERE admitted_at < ${RD} - 6), 1) AS semana_anterior
FROM agent.v_emergency_wait_times
WHERE admitted_at >= ${RD} - 13 AND admitted_at < ${RD} + 1
LIMIT 1`,
    build: (r) => {
      const now = n(r.semana);
      const before = n(r.semana_anterior);
      if (now === null || before === null) return null;
      const change = pctChange(now, before);
      const trend =
        Math.abs(change) < 3
          ? 'casi igual que la semana anterior'
          : `un ${f(Math.abs(change))} % ${direction(change)} que la semana anterior`;
      return {
        text: `La espera promedio en urgencias fue de ${f(now)} min en la última semana, ${trend} (${f(before)} min).`,
        score: Math.abs(change) / 10 + (now > 60 ? 0.5 : 0),
      };
    },
  },
  {
    id: 'admissions_trend',
    topic: 'Ingresos',
    views: ['v_admissions'],
    followUp: 'admissions_per_day_week',
    sql: `SELECT COUNT(*) FILTER (WHERE admitted_at >= ${RD} - 6) AS semana,
       COUNT(*) FILTER (WHERE admitted_at < ${RD} - 6) AS semana_anterior
FROM agent.v_admissions
WHERE admitted_at >= ${RD} - 13 AND admitted_at < ${RD} + 1
LIMIT 1`,
    build: (r) => {
      const now = n(r.semana);
      const before = n(r.semana_anterior);
      if (now === null || !before) return null;
      const change = pctChange(now, before);
      return {
        text: `Hubo ${f(now, 0)} ingresos en la última semana, un ${f(Math.abs(change))} % ${direction(change)} que la semana anterior (${f(before, 0)}).`,
        score: Math.abs(change) / 10,
      };
    },
  },
  {
    id: 'surgery_compliance',
    topic: 'Cumplimiento quirúrgico',
    views: ['v_surgeries'],
    followUp: 'surgery_compliance_by_month',
    sql: `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE is_performed) / NULLIF(COUNT(*), 0), 1) AS pct,
       COUNT(*) AS programadas
FROM agent.v_surgeries
LIMIT 1`,
    build: (r) => {
      const pct = n(r.pct);
      const total = n(r.programadas);
      if (pct === null || !total) return null;
      return {
        text: `El cumplimiento quirúrgico es del ${f(pct)} %: ${f(Math.round((pct * total) / 100), 0)} de ${f(total, 0)} programaciones se realizaron.`,
        score: pct < 80 ? 3 : pct < 90 ? 1.2 : 0.5,
      };
    },
  },
  {
    id: 'top_diagnosis',
    topic: 'Diagnóstico del mes',
    views: ['v_diagnosis_monthly'],
    followUp: 'top_diagnoses_month',
    sql: `SELECT diagnosis_name AS diagnostico,
       SUM(admissions_count)::int AS ingresos,
       ROUND(100.0 * SUM(admissions_count) / SUM(SUM(admissions_count)) OVER (), 1) AS pct
FROM agent.v_diagnosis_monthly
WHERE month = date_trunc('month', ${RD})::date
GROUP BY diagnosis_name
ORDER BY ingresos DESC
LIMIT 1`,
    build: (r) => {
      const count = n(r.ingresos);
      const pct = n(r.pct);
      if (!count || pct === null) return null;
      return {
        text: `El diagnóstico más frecuente del mes es ${sentence(String(r.diagnostico))}, con ${f(count, 0)} ingresos (${f(pct)} % de los registrados).`,
        score: 1,
      };
    },
  },
  {
    id: 'peak_arrival_hour',
    topic: 'Hora pico en urgencias',
    views: ['v_emergency_wait_times'],
    followUp: 'emergency_arrivals_by_hour',
    sql: `SELECT hour AS hora,
       COUNT(*) AS llegadas,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM agent.v_emergency_wait_times
WHERE admitted_at >= ${RD} - 29 AND admitted_at < ${RD} + 1
GROUP BY hour
ORDER BY llegadas DESC
LIMIT 1`,
    build: (r) => {
      const hour = n(r.hora);
      const pct = n(r.pct);
      if (hour === null || pct === null) return null;
      return {
        text: `La hora pico de llegadas a urgencias es las ${f(hour, 0)}:00, con el ${f(pct)} % de las llegadas de los últimos 30 días.`,
        score: 0.8,
      };
    },
  },
];

export function buildFinding(check: InsightCheck, rows: Row[]): Finding | null {
  if (rows.length === 0) return null;
  const built = check.build(rows[0]);
  if (!built) return null;
  return { ...built, topic: check.topic, followUp: PLAN_B.find((e) => e.id === check.followUp)?.question };
}

// ------------------------------------------------------------------ Respuesta

export const INSIGHTS_COLUMNS = ['tema', 'hallazgo'];
const MAX_HIGHLIGHTS = 3;

export interface InsightsSummary {
  answer: string;
  highlights: string[];
  rows: Record<string, string>[];
  followUps: string[];
}

// referenceDate en ISO (AAAA-MM-DD). findings en cualquier orden: se ordenan por puntaje.
export function summarizeInsights(findings: Finding[], referenceDate: string): InsightsSummary | null {
  if (findings.length === 0) return null;
  const ranked = [...findings].sort((a, b) => b.score - a.score);
  const date = referenceDate ? ` con corte al ${referenceDate.split('-').reverse().join('/')}` : '';
  return {
    answer: `Revisé ${ranked.length} indicadores del hospital${date}. Lo más llamativo: ${ranked[0].text}`,
    highlights: ranked.slice(1, 1 + MAX_HIGHLIGHTS).map((x) => x.text),
    rows: ranked.map((x) => ({ tema: x.topic, hallazgo: x.text })),
    followUps: ranked.map((x) => x.followUp).filter((q): q is string => Boolean(q)),
  };
}
