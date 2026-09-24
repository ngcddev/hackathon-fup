// Plan B del agente (AGE-05): preguntas predefinidas con SQL fijo. Funciona sin IA.
// - Las 4 primeras (demo, levante §12) usan el SQL de supabase/tests/demo_reference.sql sin modificarlo.
// - Las otras 10 cubren los 5 grupos de KPIs; solo usan vistas de agent y agent.reference_date().
// - El emparejamiento es determinista: normaliza la pregunta, reconoce sinónimos y puntúa por
//   palabras clave con un umbral. Por debajo del umbral no hay coincidencia.
// Sin imports del servidor: se prueba con vitest.

import type { AgentView } from '../types/api';
import { formatNumber, normalizeText } from './text';

export type Row = Record<string, unknown>;

// Un grupo de términos alternativos (prefijos sobre palabras ya canonizadas).
interface KeywordGroup {
  any: string[];
  weight: number;
  required?: boolean;
}

export interface PlanBEntry {
  id: string;
  question: string; // pregunta canónica
  variants: string[]; // otras formas de preguntar lo mismo
  keywords: KeywordGroup[];
  exclude?: string[]; // si aparece alguno, la entrada no aplica
  sql: string;
  views_used: AgentView[];
  buildAnswer: (rows: Row[]) => string;
}

export const NO_DATA_ANSWER = 'No hay datos para ese periodo.';

// ------------------------------------------------------------------ Sinónimos

// Se aplican sobre el texto ya normalizado (sin tildes ni signos). Orden: de lo largo a lo corto.
const SYNONYMS: [RegExp, string][] = [
  [/\b(unidades? de cuidados? intensivos?|cuidados? intensivos?|uci|ucis)\b/g, 'uci'],
  [/\b(hoy|actualmente|ahora|en este momento|dia de hoy)\b/g, 'hoy'],
  [/\b(ultimos? (7|siete) dias|ultima semana|esta semana|semana pasada|semana)\b/g, 'semana'],
  [/\b(ultimos? (30|treinta) dias|ultimo mes|30 dias)\b/g, 'treintadias'],
  [/\b(este mes|mes actual|del mes|en el mes|mes)\b/g, 'mes'],
  [/\b(medicinas?|farmacos?|medicamentos?)\b/g, 'medicamento'],
  [/\b(se demoran|demoran|demora|demorar|tardan|tarda|esperan|espera|esperas|tiempos? de espera)\b/g, 'espera'],
  [/\b(urgencias?|emergencias?)\b/g, 'urgencias'],
  [/\b(camas?)\b/g, 'cama'],
  [/\b(ocupadas?|ocupados?|ocupacion|ocupan|ocupada)\b/g, 'ocupacion'],
  [/\b(existencias?|stock|inventarios?)\b/g, 'inventario'],
  [/\b(promedio|media)\b/g, 'promedio'],
  [/\b(cirugias?|quirurgic[oa]s?|quirofanos?|cirugia)\b/g, 'cirugia'],
  [/\b(diagnosticos?)\b/g, 'diagnostico'],
  [/\b(ingresos?|ingresan|ingresados?|ingresaron|admisiones|hospitalizaciones)\b/g, 'ingreso'],
  [/\b(pacientes?)\b/g, 'paciente'],
  [/\b(grupos? de edad|grupos? etarios?|edades|edad)\b/g, 'edad'],
  [/\b(horas?|horarios?)\b/g, 'hora'],
  [/\b(especialidades|especialidad)\b/g, 'especialidad'],
  [/\b(servicios?)\b/g, 'servicio'],
  [/\b(triage|triaje)\b/g, 'triage'],
  [/\b(dias|dia)\b/g, 'dia'],
  [/\b(cinco)\b/g, '5'],
  [/\b(diez)\b/g, '10'],
  [/\b(frecuentes?|comunes?|comun)\b/g, 'frecuente'],
  [/\b(dispensad[oa]s?|dispensan|dispensacion(es)?|vendid[oa]s?|consumid[oa]s?|consumo)\b/g, 'dispensado'],
  [/\b(criticos?|criticas?|desabastecimiento|agotarse|agotan|por agotarse)\b/g, 'critico'],
  [/\b(cumplimiento|cumplen|cumplidas?|realizadas?)\b/g, 'cumplimiento'],
  [/\b(llegadas?|llegan|llegaron)\b/g, 'llegada'],
];

const STOPWORDS = new Set([
  'que',
  'cual',
  'cuales',
  'cuanto',
  'cuantos',
  'cuantas',
  'como',
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'en',
  'un',
  'una',
  'por',
  'con',
  'para',
  'hay',
  'estan',
  'esta',
  'son',
  'es',
  'se',
  'a',
  'y',
  'o',
  'al',
  'tiene',
  'tienen',
  'me',
  'dime',
  'muestrame',
  'cuales',
  'lo',
  'le',
  'ultimo',
  'ultima',
  'ultimos',
  'ultimas',
  'este',
  'esta',
  'estos',
  'estas',
]);

export function canonicalize(question: string): string[] {
  let text = normalizeText(question);
  for (const [pattern, replacement] of SYNONYMS) text = text.replace(pattern, replacement);
  return text.split(' ').filter((t) => t !== '' && !STOPWORDS.has(t));
}

// ------------------------------------------------------------------ Respuestas

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const fmt = (v: unknown, d = 1): string => formatNumber(num(v), d);
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

function subserviceLabel(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes('NEONAT')) return 'neonatal';
  if (upper.includes('PEDIATR')) return 'pediátrica';
  if (upper.includes('ADULTO')) return 'adultos';
  return name.toLowerCase();
}

function answerUciOccupancy(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const total = rows.find((r) => r.subservicio === 'TOTAL UCI');
  const parts = rows.filter((r) => r !== total);
  const detail = parts
    .map((r) => `${subserviceLabel(String(r.subservicio))}: ${fmt(r.ocupadas, 0)} de ${fmt(r.capacidad, 0)}`)
    .join('; ');
  if (!total) return `Hay camas de UCI registradas. ${detail}.`;
  return (
    `Hay ${fmt(total.ocupadas, 0)} de ${fmt(total.capacidad, 0)} camas UCI ocupadas (${fmt(total.porcentaje_ocupacion)} %).` +
    (detail ? ` Por subgrupo, ${detail}.` : '')
  );
}

function answerCriticalDrugs(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const first = rows[0];
  return (
    `Hay ${rows.length} ${plural(rows.length, 'medicamento', 'medicamentos')} con menos de 5 días de inventario; ` +
    `el más crítico es ${String(first.nombre)}, con ${fmt(first.dias_restantes)} días. ${SIMULATED_NOTE}`
  );
}

const SIMULATED_NOTE = 'Los datos de inventario son simulados.';

// Q3 y pregunta 6 comparten forma: filas por nivel de triage más una fila TOTAL.
function buildWaitAnswer(period: string) {
  return (rows: Row[]): string => {
    const total = rows.find((r) => r.triage_level === 'TOTAL');
    if (!total || num(total.ingresos) === 0) return NO_DATA_ANSWER;
    const levels = rows
      .filter((r) => r !== total)
      .map((r) => {
        const label = r.triage_level === 'Sin triage' ? 'sin triage' : `nivel ${String(r.triage_level)}`;
        return `${label}: ${fmt(r.espera_promedio_min)} min (${fmt(r.ingresos, 0)} ingresos)`;
      })
      .join('; ');
    return (
      `El tiempo promedio fue de ${fmt(total.espera_promedio_min)} minutos ${period}, sobre ${fmt(total.ingresos, 0)} ingresos por urgencias.` +
      (levels ? ` Por nivel de triage, ${levels}.` : '')
    );
  };
}

function answerTopService(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const top = rows[0];
  return `El servicio con más pacientes es ${cap(String(top.servicio))}, con ${fmt(top.pacientes, 0)} pacientes. Ver el top ${rows.length} en la tabla.`;
}

function answerOccupancyByService(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const top = rows[0];
  const total = rows.reduce((acc, r) => acc + num(r.ocupadas), 0);
  const cap_ = rows.reduce((acc, r) => acc + num(r.capacidad), 0);
  const pct = cap_ > 0 ? (100 * total) / cap_ : 0;
  return (
    `Hay ${fmt(total, 0)} de ${fmt(cap_, 0)} camas ocupadas en el hospital hoy (${fmt(pct)} %). ` +
    `La ocupación más alta es ${cap(String(top.servicio))}, con ${fmt(top.porcentaje_ocupacion)} % (${fmt(top.ocupadas, 0)} de ${fmt(top.capacidad, 0)}).`
  );
}

function answerAdmissionsPerDay(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const total = rows.reduce((acc, r) => acc + num(r.ingresos), 0);
  const peak = rows.reduce((best, r) => (num(r.ingresos) > num(best.ingresos) ? r : best), rows[0]);
  return `Hubo ${fmt(total, 0)} ingresos en los últimos 7 días (${fmt(total / rows.length)} por día en promedio). El día con más ingresos fue ${String(peak.dia)}, con ${fmt(peak.ingresos, 0)}.`;
}

function answerSpecialties(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const top = rows[0];
  return `La especialidad con más servicios prestados este mes es ${cap(String(top.especialidad))}, con ${fmt(top.servicios, 0)}. Ver el top ${rows.length} en la tabla.`;
}

function answerTopDispensed(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const top = rows[0];
  return `El medicamento más dispensado en los últimos 30 días es ${String(top.nombre)}, con ${fmt(top.cantidad_dispensada, 0)} unidades. Ver el top ${rows.length} en la tabla.`;
}

function answerMidInventory(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const first = rows[0];
  return (
    `Hay ${rows.length} ${plural(rows.length, 'medicamento', 'medicamentos')} entre 5 y 10 días de inventario; ` +
    `el más cercano al umbral crítico es ${String(first.nombre)}, con ${fmt(first.dias_restantes)} días. ${SIMULATED_NOTE}`
  );
}

function answerSurgeries(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const scheduled = rows.reduce((acc, r) => acc + num(r.programadas), 0);
  const done = rows.reduce((acc, r) => acc + num(r.realizadas), 0);
  const pct = scheduled > 0 ? (100 * done) / scheduled : 0;
  return (
    `El cumplimiento quirúrgico es de ${fmt(pct)} %: ${fmt(done, 0)} de ${fmt(scheduled, 0)} programaciones con ingreso en el extracto se realizaron. ` +
    `Ver el detalle por mes en la tabla.`
  );
}

function answerAgeGroups(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const total = rows.reduce((acc, r) => acc + num(r.ingresos), 0);
  const top = rows[0];
  return `Hubo ${fmt(total, 0)} ingresos este mes; el grupo de edad con más ingresos es ${String(top.grupo_edad)}, con ${fmt(top.ingresos, 0)}.`;
}

function answerDiagnoses(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const top = rows[0];
  return (
    `El diagnóstico más frecuente este mes es ${cap(String(top.diagnostico))}, con ${fmt(top.ingresos, 0)} ingresos. ` +
    `Solo se cuentan diagnósticos con 5 o más ingresos por servicio.`
  );
}

function answerArrivalsByHour(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const peak = rows.reduce((best, r) => (num(r.llegadas) > num(best.llegadas) ? r : best), rows[0]);
  const total = rows.reduce((acc, r) => acc + num(r.llegadas), 0);
  return `La hora con más llegadas a urgencias es las ${fmt(peak.hora, 0)}:00, con ${fmt(peak.llegadas, 0)} de ${fmt(total, 0)} llegadas en los últimos 30 días.`;
}

// ------------------------------------------------------------------ Consultas

// Ventana "este mes": del día 1 del mes de reference_date hasta reference_date (igual que la demo, Q4).
const MONTH_START = `agent.reference_date() - (EXTRACT(DAY FROM agent.reference_date())::int - 1)`;

export const PLAN_B: readonly PlanBEntry[] = [
  // ---- Las 4 de la demo (levante §12). SQL idéntico a supabase/tests/demo_reference.sql.
  {
    id: 'uci_beds_today',
    question: '¿Cuántas camas de UCI están ocupadas hoy?',
    variants: ['camas uci ocupadas', 'ocupación de la UCI', 'cuántas camas de cuidados intensivos hay ocupadas'],
    keywords: [
      { any: ['uci'], weight: 3, required: true },
      { any: ['ocupacion', 'cama'], weight: 3, required: true },
      { any: ['hoy'], weight: 1 },
    ],
    sql: `SELECT CASE WHEN GROUPING(subservice) = 1 THEN 'TOTAL UCI' ELSE subservice END AS subservicio,
       SUM(occupied_beds)::int AS ocupadas,
       SUM(capacity)::int AS capacidad,
       ROUND(100.0 * SUM(occupied_beds) / NULLIF(SUM(capacity), 0), 1) AS porcentaje_ocupacion
FROM agent.v_bed_occupancy
WHERE service = 'UNIDAD DE CUIDADO INTENSIVO'
  AND day = agent.reference_date()
GROUP BY GROUPING SETS ((subservice), ())
ORDER BY GROUPING(subservice), subservice
LIMIT 10`,
    views_used: ['v_bed_occupancy'],
    buildAnswer: answerUciOccupancy,
  },
  {
    id: 'drugs_below_5_days',
    question: '¿Cuáles son los medicamentos con menos de 5 días de inventario?',
    variants: ['medicamentos críticos', 'medicamentos por agotarse', 'medicamentos con poco inventario'],
    keywords: [
      { any: ['medicamento'], weight: 3, required: true },
      { any: ['5', 'critico', 'menos', 'poco', 'bajo'], weight: 3, required: true },
      { any: ['inventario', 'dia'], weight: 1 },
    ],
    exclude: ['10', 'entre', 'dispensado', 'mas'],
    sql: `SELECT item_name AS nombre,
       current_stock AS stock,
       avg_daily_consumption AS consumo_diario,
       days_of_inventory AS dias_restantes,
       is_simulated
FROM agent.v_drug_inventory
WHERE item_type = 'medicamento'
  AND days_of_inventory < 5
ORDER BY days_of_inventory ASC, item_name ASC
LIMIT 100`,
    views_used: ['v_drug_inventory'],
    buildAnswer: answerCriticalDrugs,
  },
  {
    id: 'emergency_wait_week',
    question: '¿Cuál es el tiempo de espera promedio en urgencias en la última semana?',
    variants: [
      '¿cuánto se demoran en urgencias esta semana?',
      'espera en urgencias esta semana',
      'tiempo de atención en urgencias',
    ],
    keywords: [
      { any: ['espera'], weight: 3, required: true },
      { any: ['urgencias'], weight: 3, required: true },
      { any: ['semana'], weight: 1 },
      { any: ['promedio'], weight: 1 },
    ],
    exclude: ['mes', 'hora', 'treintadias'],
    sql: `SELECT CASE WHEN GROUPING(triage_level) = 1 THEN 'TOTAL'
            WHEN triage_level IS NULL THEN 'Sin triage'
            ELSE triage_level::text END AS triage_level,
       COUNT(*) AS ingresos,
       ROUND(AVG(wait_minutes), 1) AS espera_promedio_min
FROM agent.v_emergency_wait_times
WHERE admitted_at >= agent.reference_date() - 6
  AND admitted_at < agent.reference_date() + 1
GROUP BY GROUPING SETS ((triage_level), ())
ORDER BY GROUPING(triage_level), triage_level
LIMIT 10`,
    views_used: ['v_emergency_wait_times'],
    buildAnswer: buildWaitAnswer('en la última semana'),
  },
  {
    id: 'top_service_admissions_month',
    question: '¿Qué servicio tiene más pacientes ingresados este mes?',
    variants: [
      'servicio con más ingresos este mes',
      'qué servicio recibe más pacientes',
      'servicio con más pacientes hospitalizados',
    ],
    keywords: [
      { any: ['servicio'], weight: 3, required: true },
      { any: ['paciente', 'ingreso'], weight: 3, required: true },
      { any: ['mas', 'top', 'mayor'], weight: 1 },
      { any: ['mes'], weight: 1 },
    ],
    exclude: ['ocupacion', 'cama', 'especialidad', 'edad', 'diagnostico', 'uci', 'medicamento', 'cirugia', 'hora'],
    sql: `SELECT service AS servicio,
       COUNT(DISTINCT patient_key) AS pacientes
FROM agent.v_admissions
WHERE admission_class = 'Hospitalario'
  AND admitted_at >= agent.reference_date() - (EXTRACT(DAY FROM agent.reference_date())::int - 1)
  AND admitted_at < agent.reference_date() + 1
GROUP BY service
ORDER BY pacientes DESC, service ASC
LIMIT 5`,
    views_used: ['v_admissions'],
    buildAnswer: answerTopService,
  },

  // ---- 10 adicionales (revisa Camilo antes de dar la ola por cerrada).
  {
    id: 'occupancy_by_service_today',
    question: '¿Cuál es la ocupación de camas por servicio hoy?',
    variants: ['ocupación por servicio', 'porcentaje de ocupación de cada servicio', 'camas ocupadas por servicio hoy'],
    keywords: [
      { any: ['ocupacion', 'cama'], weight: 3, required: true },
      { any: ['servicio'], weight: 1 },
      { any: ['hoy'], weight: 1 },
    ],
    exclude: ['uci'],
    sql: `SELECT service AS servicio,
       SUM(occupied_beds)::int AS ocupadas,
       SUM(capacity)::int AS capacidad,
       ROUND(100.0 * SUM(occupied_beds) / NULLIF(SUM(capacity), 0), 1) AS porcentaje_ocupacion
FROM agent.v_bed_occupancy
WHERE day = agent.reference_date()
GROUP BY service
ORDER BY porcentaje_ocupacion DESC NULLS LAST, service ASC
LIMIT 20`,
    views_used: ['v_bed_occupancy'],
    buildAnswer: answerOccupancyByService,
  },
  {
    id: 'emergency_wait_by_triage_month',
    question: '¿Cuál es la espera promedio en urgencias por nivel de triage este mes?',
    variants: ['espera por triage este mes', 'tiempo de espera por nivel de triage del mes'],
    keywords: [
      { any: ['espera'], weight: 3, required: true },
      { any: ['triage'], weight: 2, required: true },
      { any: ['mes'], weight: 2, required: true },
      { any: ['urgencias'], weight: 1 },
    ],
    exclude: ['semana', 'hora'],
    sql: `SELECT CASE WHEN GROUPING(triage_level) = 1 THEN 'TOTAL'
            WHEN triage_level IS NULL THEN 'Sin triage'
            ELSE triage_level::text END AS triage_level,
       COUNT(*) AS ingresos,
       ROUND(AVG(wait_minutes), 1) AS espera_promedio_min
FROM agent.v_emergency_wait_times
WHERE admitted_at >= ${MONTH_START}
  AND admitted_at < agent.reference_date() + 1
GROUP BY GROUPING SETS ((triage_level), ())
ORDER BY GROUPING(triage_level), triage_level
LIMIT 10`,
    views_used: ['v_emergency_wait_times'],
    buildAnswer: buildWaitAnswer('este mes'),
  },
  {
    id: 'admissions_per_day_week',
    question: '¿Cuántos ingresos hubo por día en la última semana?',
    variants: ['ingresos por día esta semana', 'ingresos diarios de la semana'],
    keywords: [
      { any: ['ingreso'], weight: 3, required: true },
      { any: ['dia'], weight: 2, required: true },
      { any: ['semana'], weight: 2, required: true },
    ],
    exclude: ['servicio', 'edad', 'hora', 'espera', 'especialidad'],
    sql: `SELECT admitted_at::date AS dia,
       COUNT(*) AS ingresos
FROM agent.v_admissions
WHERE admitted_at >= agent.reference_date() - 6
  AND admitted_at < agent.reference_date() + 1
GROUP BY admitted_at::date
ORDER BY dia ASC
LIMIT 7`,
    views_used: ['v_admissions'],
    buildAnswer: answerAdmissionsPerDay,
  },
  {
    id: 'top_specialties_services_month',
    question: '¿Qué especialidades tienen más servicios este mes?',
    variants: ['especialidades con más servicios prestados', 'servicios por especialidad este mes'],
    keywords: [
      { any: ['especialidad'], weight: 4, required: true },
      { any: ['servicio'], weight: 2 },
      { any: ['mas', 'top', 'mayor'], weight: 1 },
      { any: ['mes'], weight: 1 },
    ],
    exclude: ['edad', 'diagnostico'],
    sql: `SELECT specialty AS especialidad,
       SUM(lines_count)::int AS servicios
FROM agent.v_service_demand_daily
WHERE day >= date_trunc('month', (SELECT agent.reference_date()))::date
  AND day <= (SELECT agent.reference_date())
  AND specialty IS NOT NULL
GROUP BY specialty
ORDER BY servicios DESC, specialty ASC
LIMIT 10`,
    views_used: ['v_service_demand_daily'],
    buildAnswer: answerSpecialties,
  },
  {
    id: 'top_dispensed_drugs_30d',
    question: '¿Cuáles son los 10 medicamentos más dispensados en los últimos 30 días?',
    variants: ['medicamentos más dispensados', 'top 10 de medicamentos con más consumo'],
    keywords: [
      { any: ['medicamento'], weight: 3, required: true },
      { any: ['dispensado', 'top', 'mas', 'rotacion'], weight: 3, required: true },
      { any: ['treintadias', 'mes'], weight: 1 },
    ],
    exclude: ['inventario', 'critico', 'menos', 'entre', '5', 'dia'],
    sql: `SELECT item_name AS nombre,
       SUM(total_quantity) AS cantidad_dispensada
FROM agent.v_drug_consumption_daily
WHERE item_type = 'medicamento'
  AND day >= (SELECT agent.reference_date()) - 29
  AND day <= (SELECT agent.reference_date())
GROUP BY item_name
ORDER BY cantidad_dispensada DESC, item_name ASC
LIMIT 10`,
    views_used: ['v_drug_consumption_daily'],
    buildAnswer: answerTopDispensed,
  },
  {
    id: 'drugs_5_to_10_days',
    question: '¿Qué medicamentos tienen entre 5 y 10 días de inventario?',
    variants: ['medicamentos con inventario entre 5 y 10 días', 'medicamentos en advertencia de inventario'],
    keywords: [
      { any: ['medicamento'], weight: 3, required: true },
      { any: ['10'], weight: 3, required: true },
      { any: ['5', 'entre'], weight: 2, required: true },
      { any: ['inventario', 'dia'], weight: 1 },
    ],
    sql: `SELECT item_name AS nombre,
       current_stock AS stock,
       avg_daily_consumption AS consumo_diario,
       days_of_inventory AS dias_restantes,
       is_simulated
FROM agent.v_drug_inventory
WHERE item_type = 'medicamento'
  AND days_of_inventory >= 5
  AND days_of_inventory < 10
ORDER BY days_of_inventory ASC, item_name ASC
LIMIT 100`,
    views_used: ['v_drug_inventory'],
    buildAnswer: answerMidInventory,
  },
  {
    id: 'surgery_compliance_by_month',
    question: '¿Cuál es el cumplimiento quirúrgico por mes?',
    variants: ['cirugías realizadas por mes', 'cumplimiento de la programación quirúrgica'],
    keywords: [
      { any: ['cirugia'], weight: 4, required: true },
      { any: ['cumplimiento'], weight: 2 },
      { any: ['mes'], weight: 1 },
    ],
    sql: `SELECT scheduled_month AS mes,
       COUNT(*) AS programadas,
       COUNT(*) FILTER (WHERE is_performed) AS realizadas,
       ROUND(100.0 * COUNT(*) FILTER (WHERE is_performed) / COUNT(*), 1) AS cumplimiento_pct
FROM agent.v_surgeries
GROUP BY scheduled_month
ORDER BY scheduled_month ASC
LIMIT 200`,
    views_used: ['v_surgeries'],
    buildAnswer: answerSurgeries,
  },
  {
    id: 'admissions_by_age_group_month',
    question: '¿Cuántos ingresos hubo por grupo de edad este mes?',
    variants: ['ingresos por edad este mes', 'distribución de ingresos por grupo etario'],
    keywords: [
      { any: ['edad'], weight: 4, required: true },
      { any: ['ingreso', 'paciente'], weight: 2 },
      { any: ['mes'], weight: 1 },
    ],
    sql: `SELECT age_group AS grupo_edad,
       COUNT(*) AS ingresos
FROM agent.v_admissions
WHERE admitted_at >= ${MONTH_START}
  AND admitted_at < agent.reference_date() + 1
GROUP BY age_group
ORDER BY ingresos DESC, age_group ASC
LIMIT 20`,
    views_used: ['v_admissions'],
    buildAnswer: answerAgeGroups,
  },
  {
    id: 'top_diagnoses_month',
    question: '¿Cuáles son los diagnósticos más frecuentes este mes?',
    variants: ['diagnósticos más comunes del mes', 'top de diagnósticos este mes'],
    keywords: [
      { any: ['diagnostico'], weight: 4, required: true },
      { any: ['frecuente', 'mas', 'top'], weight: 2 },
      { any: ['mes'], weight: 1 },
    ],
    sql: `SELECT diagnosis_name AS diagnostico,
       SUM(admissions_count)::int AS ingresos
FROM agent.v_diagnosis_monthly
WHERE month = date_trunc('month', agent.reference_date())::date
GROUP BY diagnosis_name
ORDER BY ingresos DESC, diagnosis_name ASC
LIMIT 10`,
    views_used: ['v_diagnosis_monthly'],
    buildAnswer: answerDiagnoses,
  },
  {
    id: 'emergency_arrivals_by_hour',
    question: '¿A qué hora llegan más pacientes a urgencias?',
    variants: ['llegadas a urgencias por hora del día', 'horas pico de urgencias'],
    keywords: [
      { any: ['urgencias'], weight: 3, required: true },
      { any: ['hora'], weight: 3, required: true },
      { any: ['llegada', 'ingreso', 'paciente'], weight: 1 },
    ],
    exclude: ['espera'],
    sql: `SELECT hour AS hora,
       COUNT(*) AS llegadas
FROM agent.v_emergency_wait_times
WHERE admitted_at >= agent.reference_date() - 29
  AND admitted_at < agent.reference_date() + 1
GROUP BY hour
ORDER BY hour ASC
LIMIT 24`,
    views_used: ['v_emergency_wait_times'],
    buildAnswer: answerArrivalsByHour,
  },
];

// ------------------------------------------------------------------ Búsqueda de diagnóstico
// "¿cuántos pacientes ingresaron con apendicitis?": sin LLM se extrae la palabra de la enfermedad
// y se busca con ILIKE en v_diagnosis_monthly. El término solo tiene letras (no hay inyección posible)
// y se recorta a la raíz para tolerar plurales y errores al final ("apendiciti" → '%APENDICITI%').

const DIAGNOSIS_CUE =
  /\b(?:diagnostic\w*|dx|enfermedad\w*|casos?|pacientes?|ingres\w*|atendid\w*|hospitalizad\w*|consultas?)\b.*?\b(?:con|por|de)\s+(?:(?:un|una|el|la|los|las)\s+)?(?:(?:diagnostico|dx|enfermedad)\s+(?:de\s+)?)?([a-zñ]{5,})/;

// Palabras que siguen a "con/por/de" pero no son enfermedades.
const NOT_A_DIAGNOSIS = new Set([
  'urgencias',
  'emergencia',
  'emergencias',
  'hospitalizacion',
  'pediatria',
  'triage',
  'triaje',
  'medicamento',
  'medicamentos',
  'servicio',
  'servicios',
  'zona',
  'rural',
  'urbana',
  'sexo',
  'edad',
  'edades',
  'genero',
  'regimen',
  'subsidiado',
  'contributivo',
  'particular',
  'vinculado',
  'cirugia',
  'cirugias',
  'partos',
  'cuidado',
  'cuidados',
  'intensivo',
  'intensivos',
  'intermedio',
  'recuperacion',
  'gineco',
  'ginecologia',
  'obstetricia',
  'semana',
  'semanas',
  'mes',
  'meses',
  'hora',
  'horas',
  'noche',
  'manana',
  'tarde',
  'camas',
  'ocupacion',
  'espera',
  'tiempo',
  'promedio',
  'total',
  'ayer',
  'mujeres',
  'hombres',
  'ninos',
  'niños',
  'adultos',
  'mayores',
  'menores',
  'femenino',
  'masculino',
  'especialidad',
  'dias',
  'ultimo',
  'ultima',
  'ultimos',
  'ultimas',
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
  'grupo',
  'grupos',
  'nivel',
  'niveles',
  'tipo',
  'tipos',
  'turno',
  'turnos',
  'area',
  'areas',
  'sala',
  'salas',
  'ruta',
  'clase',
  'origen',
  'subservicio',
  'subservicios',
  'semana',
  'hospital',
  'paciente',
  'pacientes',
  'ingreso',
  'ingresos',
]);

// "diagnóstico de", "enfermedad", "dx": la pregunta dice explícitamente que busca una enfermedad.
const EXPLICIT_DIAGNOSIS = /\b(?:diagnostic\w*|dx|enfermedad\w*)\b/;

// Raíz: quita terminaciones de plural para que "neumonias" encuentre "NEUMONIA".
function diagnosisStem(term: string): string {
  const stem = term.replace(/(?:es|s)$/, '');
  return (stem.length >= 5 ? stem : term).toUpperCase();
}

export function extractDiagnosisTerm(question: string): string | null {
  const match = DIAGNOSIS_CUE.exec(normalizeText(question));
  if (!match) return null;
  const term = match[1];
  return NOT_A_DIAGNOSIS.has(term) ? null : diagnosisStem(term);
}

function answerDiagnosisSearch(term: string) {
  return (rows: Row[]): string => {
    if (rows.length === 0) return NO_DATA_ANSWER;
    const total = rows.reduce((acc, r) => acc + num(r.ingresos), 0);
    const names = rows.length === 1 ? 'un diagnóstico' : `${rows.length} diagnósticos`;
    return (
      `Hubo ${fmt(total, 0)} ingresos con diagnósticos que contienen "${term.toLowerCase()}" (${names}; el principal es ${cap(String(rows[0].diagnostico))}). ` +
      'Solo se cuentan grupos de 5 o más ingresos por mes y servicio; el detalle está en la tabla.'
    );
  };
}

export function isExplicitDiagnosisQuestion(question: string): boolean {
  return EXPLICIT_DIAGNOSIS.test(normalizeText(question));
}

export function diagnosisSearchEntry(question: string): PlanBEntry | null {
  const term = extractDiagnosisTerm(question);
  if (!term) return null;
  const thisMonth = canonicalize(question).includes('mes');
  return {
    id: 'diagnosis_search',
    question: `¿Cuántos ingresos hubo con diagnóstico de ${term.toLowerCase()}?`,
    variants: [],
    keywords: [],
    sql: `SELECT diagnosis_name AS diagnostico,
       SUM(admissions_count)::int AS ingresos
FROM agent.v_diagnosis_monthly
WHERE diagnosis_name ILIKE '%${term}%'${
      thisMonth
        ? `
  AND month = date_trunc('month', agent.reference_date())::date`
        : ''
    }
GROUP BY diagnosis_name
ORDER BY ingresos DESC, diagnosis_name ASC
LIMIT 20`,
    views_used: ['v_diagnosis_monthly'],
    buildAnswer: answerDiagnosisSearch(term),
  };
}

// ------------------------------------------------------------------ Emparejamiento

export const MATCH_THRESHOLD = 0.7;
const AMBIGUITY_MARGIN = 0.05;

function hasToken(tokens: string[], term: string): boolean {
  // Prefijo para términos de 4 letras o más ("medicament" absorbe variantes); exacto para los cortos.
  return term.length >= 4 ? tokens.some((t) => t.startsWith(term)) : tokens.includes(term);
}

export function scoreEntry(entry: PlanBEntry, tokens: string[]): number {
  if (entry.exclude?.some((term) => hasToken(tokens, term))) return 0;
  let matched = 0;
  let total = 0;
  for (const group of entry.keywords) {
    total += group.weight;
    if (group.any.some((term) => hasToken(tokens, term))) matched += group.weight;
    else if (group.required) return 0;
  }
  return total === 0 ? 0 : matched / total;
}

export interface PlanBMatch {
  entry: PlanBEntry;
  score: number;
}

export function matchPlanB(question: string): PlanBMatch | null {
  const normalized = normalizeText(question);
  // Coincidencia exacta con la pregunta canónica o una variante: puntaje máximo.
  for (const entry of PLAN_B) {
    const forms = [entry.question, ...entry.variants].map(normalizeText);
    if (forms.includes(normalized)) return { entry, score: 1 };
  }
  // Una enfermedad concreta: ninguna pregunta fija filtra por diagnóstico. Si la pregunta lo dice
  // explícitamente ("diagnóstico de neumonía"), gana la búsqueda; si no ("casos de dengue"), solo
  // se usa cuando ninguna pregunta fija encaja.
  const diagnosis = diagnosisSearchEntry(question);
  if (diagnosis && isExplicitDiagnosisQuestion(question)) return { entry: diagnosis, score: MATCH_THRESHOLD };
  const tokens = canonicalize(question);
  const scored = PLAN_B.map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((m) => m.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return diagnosis ? { entry: diagnosis, score: MATCH_THRESHOLD } : null;
  // Dos candidatos casi empatados: ambigua, no se adivina.
  if (scored.length > 1 && scored[0].score - scored[1].score < AMBIGUITY_MARGIN) return null;
  return scored[0];
}

// Preguntas que se sugieren cuando no hay coincidencia (AGE-10): las 4 de la demo.
export function suggestedQuestions(): string[] {
  return PLAN_B.slice(0, 4).map((e) => e.question);
}
