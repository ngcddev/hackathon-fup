// Contexto de una respuesta del agente (AGE-06): lo calcula el servidor a partir de las filas, así
// que el LLM sigue sin ver datos (RNF-03). Tres piezas:
//   highlights           frases con cifras del resultado: total, participación, rango, pico, tendencia
//   notes                advertencias según las vistas usadas (datos simulados, umbrales de privacidad…)
//   follow_up_questions  preguntas relacionadas para seguir explorando
// Sin imports del servidor: se prueba con vitest.

import type { AgentView } from '../types/api';
import { PLAN_B } from './plan-b';
import { formatNumber, normalizeText } from './text';

type Row = Record<string, unknown>;

const MAX_HIGHLIGHTS = 3;
const MAX_FOLLOW_UPS = 3;
const MAX_FOLLOW_UP_CHARS = 120;

// ------------------------------------------------------------------ Utilidades

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const TIME_COLUMN = /^(dia|day|fecha|date|mes|month|hora|hour|semana|week|scheduled_month)$/;
// Medidas que no se pueden sumar (promedios, porcentajes, días de inventario…).
const NON_ADDITIVE = /(pct|porcentaje|promedio|prom|avg|media|tasa|ratio|indice|dias|min|minutos|horas|consumo_diario|stock)/;
const TOTAL_LABEL = /^total\b/i;

const fmt = (n: number, decimals = 1) => formatNumber(n, decimals);

function formatLabel(value: unknown): string {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (ISO_DATE.test(text)) return text.slice(0, 10).split('-').reverse().join('/');
  // Nombres del HIS en mayúsculas ("LOSARTAN 50 mg"): se pasan a tipo oración para leerlos mejor.
  const letters = text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length;
  if (letters.length > 3 && upper / letters.length >= 0.7) {
    return text.charAt(0) + text.slice(1).toLowerCase();
  }
  return text;
}

const columnLabel = (name: string) => name.replace(/_/g, ' ');

function isMonotonic(values: number[]): boolean {
  if (values.length < 3) return false;
  const up = values.every((v, i) => i === 0 || v >= values[i - 1]);
  const down = values.every((v, i) => i === 0 || v <= values[i - 1]);
  return (up || down) && values[0] !== values[values.length - 1];
}

function listNames(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

// ------------------------------------------------------------------ Datos destacados

export function describeResult(columns: string[], rows: Row[]): string[] {
  if (rows.length < 2 || columns.length < 2) return [];

  const numericCols = columns.filter((c) => rows.every((r) => r[c] === null || toNumber(r[c]) !== null));
  const isDate = (v: unknown) => v instanceof Date || ISO_DATE.test(String(v ?? ''));
  const timeCol = columns.find((c) => TIME_COLUMN.test(c) || rows.every((r) => isDate(r[c])));
  const labelCol = timeCol ?? columns.find((c) => !numericCols.includes(c));
  if (!labelCol) return [];

  // Las filas TOTAL (GROUPING SETS) no entran al ranking.
  const body = rows.filter((r) => !TOTAL_LABEL.test(String(r[labelCol] ?? '')));
  const measures = numericCols.filter((c) => c !== labelCol);
  if (body.length < 2 || measures.length === 0) return [];

  const series = (col: string) => body.map((r) => toNumber(r[col]) ?? 0);
  // La medida principal es la que ordena el resultado; si ninguna lo ordena, la primera numérica.
  const measure = timeCol ? measures[0] : (measures.find((c) => isMonotonic(series(c))) ?? measures[0]);
  const values = series(measure);
  const label = columnLabel(measure);
  const additive = !NON_ADDITIVE.test(measure);
  const total = values.reduce((a, b) => a + b, 0);
  const avg = total / values.length;
  const maxIdx = values.indexOf(Math.max(...values));
  const minIdx = values.indexOf(Math.min(...values));
  const name = (i: number) => formatLabel(body[i][labelCol]);
  const out: string[] = [];

  if (timeCol) {
    out.push(
      `Pico de ${label}: ${fmt(values[maxIdx])} (${name(maxIdx)}); mínimo: ${fmt(values[minIdx])} (${name(minIdx)}); promedio: ${fmt(avg)} por ${columnLabel(timeCol)}.`,
    );
    if (values.length >= 4) {
      const half = Math.floor(values.length / 2);
      const first = values.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const second = values.slice(half).reduce((a, b) => a + b, 0) / (values.length - half);
      if (first > 0) {
        const change = ((second - first) / first) * 100;
        out.push(
          Math.abs(change) < 5
            ? `Estable: la segunda mitad del periodo queda dentro de ±5 % de la primera.`
            : `Tendencia: la segunda mitad del periodo está un ${fmt(Math.abs(change))} % ${change > 0 ? 'por encima' : 'por debajo'} de la primera.`,
        );
      }
    }
    if (additive) out.push(`Total del periodo: ${fmt(total, 0)} ${label}.`);
    return out.slice(0, MAX_HIGHLIGHTS);
  }

  const ranked = body.map((_, i) => i).sort((a, b) => values[b] - values[a]);
  if (additive && total > 0) {
    const top = ranked.slice(0, Math.min(3, ranked.length - 1));
    const share = (top.reduce((acc, i) => acc + values[i], 0) / total) * 100;
    out.push(`Entre los ${body.length} resultados suman ${fmt(total, 0)} ${label}.`);
    out.push(
      `${top.length === 1 ? 'El primero concentra' : `Los ${top.length} primeros concentran`} el ${fmt(share)} %: ` +
        `${listNames(top.map((i) => `${name(i)} (${fmt(values[i], 0)})`))}.`,
    );
    const leader = ranked[0];
    if (body.length >= 4 && avg > 0 && values[leader] >= 1.5 * avg) {
      out.push(`${name(leader)} está ${fmt(values[leader] / avg)} veces por encima del promedio (${fmt(avg)}).`);
    }
  } else {
    out.push(
      `Rango de ${label}: de ${fmt(values[minIdx])} (${name(minIdx)}) a ${fmt(values[maxIdx])} (${name(maxIdx)}); promedio: ${fmt(avg)}.`,
    );
  }
  return out.slice(0, MAX_HIGHLIGHTS);
}

// ------------------------------------------------------------------ Advertencias por vista

// [texto, fragmento que indica que la respuesta ya lo dice]
const VIEW_NOTES: Partial<Record<AgentView, [string, RegExp]>> = {
  v_drug_inventory: ['El inventario es simulado a partir del consumo real de los últimos 30 días.', /simulad/i],
  v_bed_occupancy: ['Parte de la capacidad de camas es derivada del histórico, no de un censo oficial.', /capacidad.*derivad/i],
  v_diagnosis_monthly: ['Por privacidad, los diagnósticos solo cuentan grupos de 5 o más ingresos por mes y servicio.', /5 o m[aá]s/i],
  v_surgeries: ['Solo se cuentan cirugías programadas cuyo ingreso aparece en el extracto del HIS.', /extracto/i],
  v_emergency_wait_times: ['La espera se mide desde el triage (o desde el ingreso si no hay triage), hasta un máximo de 24 horas.', /desde el triage/i],
};

export function viewNotes(views: AgentView[], answer: string, truncated: boolean): string[] {
  const notes = views
    .map((v) => VIEW_NOTES[v])
    .filter((n): n is [string, RegExp] => n !== undefined && !n[1].test(answer))
    .map(([text]) => text);
  if (truncated) notes.push('El resultado se cortó en 200 filas; haga la pregunta más específica para ver el resto.');
  return [...new Set(notes)];
}

// ------------------------------------------------------------------ Preguntas relacionadas

const RELATED: Record<AgentView, string[]> = {
  v_bed_occupancy: ['occupancy_by_service_today', 'uci_beds_today', 'top_service_admissions_month'],
  v_emergency_wait_times: ['emergency_wait_by_triage_month', 'emergency_arrivals_by_hour', 'emergency_wait_week'],
  v_admissions: ['admissions_per_day_week', 'admissions_by_age_group_month', 'top_service_admissions_month'],
  v_drug_inventory: ['drugs_5_to_10_days', 'top_dispensed_drugs_30d', 'drugs_below_5_days'],
  v_drug_consumption_daily: ['drugs_below_5_days', 'top_dispensed_drugs_30d'],
  v_service_demand_daily: ['top_specialties_services_month', 'occupancy_by_service_today'],
  v_surgeries: ['surgery_compliance_by_month', 'top_service_admissions_month'],
  v_diagnosis_monthly: ['top_diagnoses_month', 'admissions_by_age_group_month'],
};

const questionOf = (id: string) => PLAN_B.find((e) => e.id === id)?.question;

// El LLM no ve el resultado: una sugerencia que diga "ese servicio" o "dicho día" no se entiende sola.
const DEPENDS_ON_RESULT = /\b(ese|esa|esos|esas|eso|dicho|dicha|aquel|aquella|mismo|misma|anterior)\b/;

// Limpia lo que propone el LLM: texto corto, una línea, con forma de pregunta y que se entienda sola.
function cleanSuggestion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f<>{}]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 8 || text.length > MAX_FOLLOW_UP_CHARS) return null;
  if (DEPENDS_ON_RESULT.test(normalizeText(text))) return null;
  return /[?¿]/.test(text) ? text : `¿${text.replace(/[.]$/, '')}?`;
}

export function followUpQuestions(question: string, views: AgentView[], fromLlm: unknown[] = []): string[] {
  const asked = normalizeText(question);
  const seen = new Set<string>([asked]);
  const out: string[] = [];
  const push = (q: string | null | undefined) => {
    if (!q || out.length >= MAX_FOLLOW_UPS) return;
    const key = normalizeText(q);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };
  for (const s of fromLlm) push(cleanSuggestion(s));
  for (const view of views) for (const id of RELATED[view] ?? []) push(questionOf(id));
  return out;
}
