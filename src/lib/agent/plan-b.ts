// Plan B del agente (AGE-05): preguntas predefinidas con SQL fijo. Funciona sin IA.
// - Las 4 primeras (demo, levante §12) usan el SQL de supabase/tests/demo_reference.sql sin modificarlo.
// - Las demás cubren los 5 grupos de KPIs y las preguntas de la línea base que más fallaban (espera por
//   turno, segmentos de ingreso, medicamentos agotados, urgencias de ayer); solo usan vistas de agent y
//   agent.reference_date().
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
  // Sus palabras clave son tan específicas que, con todas presentes, se responde sin LLM aunque la
  // pregunta no sea idéntica (el LLM contestaba peor estas preguntas en la línea base).
  direct?: boolean;
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
  [/\b(libres?|vacias?|vacios?|disponibles?|desocupad[oa]s?)\b/g, 'libre'],
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
  [/\b(turnos?|noches?|nocturno|nocturna)\b/g, 'turno'],
  [/\b(regimen(?:es)?)\b/g, 'regimen'],
  [/\b(agotad[oa]s?|sin existencias|sin stock)\b/g, 'agotado'],
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

function answerFreeBeds(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const free = rows.reduce((acc, r) => acc + num(r.libres), 0);
  const capacity = rows.reduce((acc, r) => acc + num(r.capacidad), 0);
  const top = rows[0];
  const full = rows.filter((r) => num(r.libres) === 0).map((r) => cap(String(r.servicio)));
  return (
    `Hoy hay ${fmt(free, 0)} camas libres de ${fmt(capacity, 0)} en el hospital. ` +
    `${cap(String(top.servicio))} tiene más disponibilidad, con ${fmt(top.libres, 0)} libres.` +
    (full.length > 0 ? ` Sin camas libres: ${full.join(', ')}.` : '')
  );
}

function answerArrivalsByHour(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const peak = rows.reduce((best, r) => (num(r.llegadas) > num(best.llegadas) ? r : best), rows[0]);
  const total = rows.reduce((acc, r) => acc + num(r.llegadas), 0);
  return `La hora con más llegadas a urgencias es las ${fmt(peak.hora, 0)}:00, con ${fmt(peak.llegadas, 0)} de ${fmt(total, 0)} llegadas en los últimos 30 días.`;
}

function answerWaitByShiftTriage(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const over = rows.filter((r) => num(r.espera_promedio_min) > 60);
  const top = rows[0];
  const shift = String(top.turno) === 'noche' ? 'turno noche' : 'turno día';
  const triage = top.triage_level === 'Sin triage' ? 'sin triage' : `triage ${String(top.triage_level)}`;
  const worst = `${shift}, ${triage}: ${fmt(top.espera_promedio_min)} min (${fmt(top.ingresos, 0)} ingresos)`;
  return over.length === 0
    ? `En los últimos 30 días ninguna combinación de turno y triage supera los 60 minutos de espera; la más alta es ${worst}.`
    : `En los últimos 30 días ${over.length} de ${rows.length} combinaciones de turno y triage superan los 60 minutos de espera; la más alta es ${worst}. El detalle está en la tabla.`;
}

function answerTopSegments(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const top = rows[0];
  return `En todo el histórico, la combinación con más ingresos hospitalarios es ${String(top.grupo_edad)} años, régimen ${String(top.regimen).toLowerCase()}, zona ${String(top.zona).toLowerCase()}, con ${fmt(top.ingresos, 0)} ingresos. Ver el top ${rows.length} en la tabla.`;
}

// Algunos ítems tienen descripciones de varias líneas: en la frase basta el principio.
function shortName(name: unknown, max = 60): string {
  const text = String(name);
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function answerOutOfStock(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  const soldOut = rows.filter((r) => num(r.stock) <= 0);
  const low = rows.filter((r) => num(r.stock) > 0);
  if (soldOut.length === 0) {
    return (
      `Ningún medicamento está agotado (stock en 0). Sí hay ${low.length} ${plural(low.length, 'medicamento', 'medicamentos')} con 3 días o menos de inventario; ` +
      `el más crítico es ${shortName(low[0].nombre)}, con ${fmt(low[0].dias_restantes)} días. ${SIMULATED_NOTE}`
    );
  }
  return `Hay ${soldOut.length} ${plural(soldOut.length, 'medicamento agotado', 'medicamentos agotados')} (stock en 0), por ejemplo ${shortName(soldOut[0].nombre)}. ${SIMULATED_NOTE}`;
}

function answerEmergencyYesterday(rows: Row[]): string {
  if (rows.length === 0) return NO_DATA_ANSWER;
  return `Ayer (${String(rows[0].dia)}) hubo ${fmt(rows[0].ingresos, 0)} ingresos por urgencias.`;
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
    exclude: ['libre'],
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
    exclude: ['uci', 'libre'],
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
    exclude: ['regimen', 'zona'],
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
  {
    id: 'free_beds_today',
    question: '¿Cuántas camas libres hay hoy por servicio?',
    variants: ['camas vacías', 'camas disponibles hoy', 'cuántas camas tengo libres'],
    keywords: [
      { any: ['cama'], weight: 3, required: true },
      { any: ['libre'], weight: 3, required: true },
      { any: ['hoy', 'servicio'], weight: 1 },
    ],
    sql: `SELECT service AS servicio,
       GREATEST(SUM(capacity) - SUM(occupied_beds), 0)::int AS libres,
       SUM(occupied_beds)::int AS ocupadas,
       SUM(capacity)::int AS capacidad
FROM agent.v_bed_occupancy
WHERE day = agent.reference_date()
GROUP BY service
ORDER BY libres DESC, service ASC
LIMIT 20`,
    views_used: ['v_bed_occupancy'],
    buildAnswer: answerFreeBeds,
  },
  {
    id: 'emergency_wait_by_shift_triage',
    question: '¿Cuál es la espera promedio en urgencias por turno y nivel de triage?',
    variants: ['espera de urgencias entre turno día y noche', 'comparar la espera de urgencias por turno'],
    keywords: [
      { any: ['espera'], weight: 3, required: true },
      { any: ['turno'], weight: 3, required: true },
      { any: ['urgencias'], weight: 1 },
      { any: ['triage'], weight: 1 },
    ],
    exclude: ['hora'],
    direct: true,
    sql: `SELECT shift AS turno,
       CASE WHEN triage_level IS NULL THEN 'Sin triage' ELSE triage_level::text END AS triage_level,
       COUNT(*) AS ingresos,
       ROUND(AVG(wait_minutes), 1) AS espera_promedio_min
FROM agent.v_emergency_wait_times
WHERE admitted_at >= agent.reference_date() - 29
  AND admitted_at < agent.reference_date() + 1
GROUP BY shift, triage_level
ORDER BY espera_promedio_min DESC, shift ASC, triage_level ASC
LIMIT 20`,
    views_used: ['v_emergency_wait_times'],
    buildAnswer: answerWaitByShiftTriage,
  },
  {
    id: 'admissions_top_segments',
    question: '¿Qué grupo de edad, régimen y zona tienen más ingresos hospitalarios?',
    variants: ['top de ingresos hospitalarios por edad, régimen y zona'],
    direct: true,
    keywords: [
      { any: ['edad'], weight: 3, required: true },
      { any: ['regimen'], weight: 3, required: true },
      { any: ['zona'], weight: 2 },
      { any: ['ingreso', 'paciente'], weight: 2 },
    ],
    sql: `SELECT age_group AS grupo_edad,
       regime AS regimen,
       zone AS zona,
       COUNT(*) AS ingresos
FROM agent.v_admissions
WHERE admission_class = 'Hospitalario'
GROUP BY age_group, regime, zone
ORDER BY ingresos DESC, age_group ASC, regime ASC, zone ASC
LIMIT 3`,
    views_used: ['v_admissions'],
    buildAnswer: answerTopSegments,
  },
  {
    id: 'drugs_out_of_stock',
    question: '¿Qué medicamentos están agotados?',
    variants: ['medicamentos sin stock', 'medicamentos agotados o casi agotados'],
    direct: true,
    keywords: [
      { any: ['medicamento'], weight: 3, required: true },
      { any: ['agotado'], weight: 4, required: true },
    ],
    sql: `SELECT item_name AS nombre,
       current_stock AS stock,
       days_of_inventory AS dias_restantes,
       is_simulated
FROM agent.v_drug_inventory
WHERE item_type = 'medicamento'
  AND (current_stock <= 0 OR days_of_inventory <= 3)
ORDER BY (current_stock <= 0) DESC, days_of_inventory ASC NULLS LAST, item_name ASC
LIMIT 50`,
    views_used: ['v_drug_inventory'],
    buildAnswer: answerOutOfStock,
  },
  {
    id: 'emergency_admissions_yesterday',
    question: '¿Cuántos ingresos hubo en urgencias ayer?',
    variants: ['ingresos a urgencias de ayer', 'cuántos pacientes ingresaron a urgencias ayer'],
    keywords: [
      { any: ['ingreso'], weight: 3, required: true },
      { any: ['urgencias'], weight: 3, required: true },
      { any: ['ayer'], weight: 3, required: true },
    ],
    direct: true,
    // S-04: por urgencias es admission_route = 'Urgencias', no el servicio de la cama.
    sql: `SELECT (agent.reference_date() - 1)::text AS dia,
       COUNT(*) AS ingresos
FROM agent.v_admissions
WHERE admission_route = 'Urgencias'
  AND admitted_at >= agent.reference_date() - 1
  AND admitted_at < agent.reference_date()
LIMIT 1`,
    views_used: ['v_admissions'],
    buildAnswer: answerEmergencyYesterday,
  },
];

// ------------------------------------------------------------------ Pacientes por población
// "¿cuántos niños enfermos tengo?", "mujeres ingresadas esta semana": sin LLM se reconoce la
// población (grupos de edad o sexo del esquema) y el periodo, y se cuentan pacientes distintos.
// "Enfermos" = pacientes con ingreso en el periodo; se separan los hospitalizados.

interface Population {
  label: string; // cómo se nombra en la respuesta
  them: 'ellos' | 'ellas'; // concordancia: "65 de ellas quedaron hospitalizadas"
  column: 'age_group' | 'sex' | null; // null: todos los pacientes
  note?: string; // aclaración cuando el dato no coincide exacto con lo pedido
  values: string[]; // valores exactos del esquema
}

const POPULATIONS: [RegExp, Population][] = [
  [
    /\b(bebes?|recien nacidos?|lactantes?)\b/,
    { label: 'niños de 0 a 4 años', them: 'ellos', column: 'age_group', values: ['0-4'] },
  ],
  [
    /\b(adolescentes?)\b/,
    { label: 'niños y adolescentes de 5 a 17 años', them: 'ellos', column: 'age_group', values: ['5-17'] },
  ],
  [
    /\b(ninos?|ninas?|infantes?|infantil|menores de edad|menores|pediatric\w*|hijos?)\b/,
    { label: 'niños y adolescentes (0 a 17 años)', them: 'ellos', column: 'age_group', values: ['0-4', '5-17'] },
  ],
  [
    /\b(adultos? mayores?|ancianos?|tercera edad|mayores de (60|sesenta)|abuel\w*)\b/,
    { label: 'adultos mayores (60 años o más)', them: 'ellos', column: 'age_group', values: ['60-74', '75+'] },
  ],
  [/\b(mujeres|femenin\w*|senoras)\b/, { label: 'mujeres', them: 'ellas', column: 'sex', values: ['Femenino'] }],
  [
    /\b(hombres|masculin\w*|varones|senores)\b/,
    { label: 'hombres', them: 'ellos', column: 'sex', values: ['Masculino'] },
  ],
];

// La población solo aplica a preguntas de conteo de pacientes, no a otros indicadores.
const PATIENT_CUE =
  /\b(pacientes?|cuantos?|cuantas?|enfermos?|enfermas?|ingres\w*|atendid\w*|hospitalizad\w*|tengo|hay)\b/;
const OTHER_TOPIC = /\b(espera\w*|triage|camas?|medicament\w*|cirugi\w*|diagnostic\w*|consumo|inventario)\b/;

// Grupos de edad del esquema (v_admissions.age_group) con sus límites.
const AGE_GROUPS: [number, number, string][] = [
  [0, 4, '0-4'],
  [5, 17, '5-17'],
  [18, 29, '18-29'],
  [30, 44, '30-44'],
  [45, 59, '45-59'],
  [60, 74, '60-74'],
  [75, 150, '75+'],
];

// "mayores de 70 años", "pacientes mayores tengo de 70", "70 años o más", "menores de 12".
// Los datos vienen por grupos de edad: se toman los grupos que cubren esa edad y, si el corte no es
// exacto, la respuesta lo aclara.
function ageThreshold(normalized: string): Population | null {
  // "mayores de 70" y "más de 70 años" = 71 en adelante; "70 años o más" = 70 en adelante.
  const strict =
    /\bmayores?(?:\s+[a-z]+){0,2}\s+de\s+(\d{1,3})\b/.exec(normalized) ?? /\bmas de (\d{1,3}) anos\b/.exec(normalized);
  const inclusive = /\b(\d{1,3}) anos o mas\b/.exec(normalized);
  const younger = /\bmenores?(?:\s+[a-z]+){0,2}\s+de\s+(\d{1,3})\b/.exec(normalized);
  if (strict || inclusive) {
    const age = Number((strict ?? inclusive)![1]);
    const minAge = strict ? age + 1 : age;
    const groups = AGE_GROUPS.filter(([, hi]) => hi >= minAge);
    if (groups.length === 0) return null;
    const from = groups[0][0];
    const exact = from === minAge;
    return {
      label: `pacientes de ${from} años o más`,
      them: 'ellos',
      column: 'age_group',
      values: groups.map(([, , g]) => g),
      note: exact
        ? undefined
        : `Los datos vienen por grupos de edad, sin corte exacto en ${age} años: se incluye el grupo ${groups[0][2]}.`,
    };
  }
  if (younger) {
    const age = Number(younger[1]);
    const groups = AGE_GROUPS.filter(([lo]) => lo < age);
    if (groups.length === 0) return null;
    const to = groups[groups.length - 1][1];
    const exact = to === age - 1;
    return {
      label: `pacientes de 0 a ${to} años`,
      them: 'ellos',
      column: 'age_group',
      values: groups.map(([, , g]) => g),
      note: exact
        ? undefined
        : `Los datos vienen por grupos de edad, sin corte exacto en ${age} años: se incluye el grupo ${groups[groups.length - 1][2]}.`,
    };
  }
  return null;
}

// "¿Cuántos pacientes tengo?": solo palabras genéricas de conteo y periodo, sin otro filtro.
const GENERIC_WORDS = new Set(
  (
    'cuantos cuantas pacientes paciente tengo tenemos tiene hay atendimos atendidos atendieron enfermos enfermas ' +
    'total totales en el la los las de del que mis nuestros actualmente hospital ingresados ingresaron ingresos ' +
    'hoy semana mes este esta ultima ultimo ultimos dias 30 treinta por favor dime'
  ).split(' '),
);

function isAllPatients(normalized: string): boolean {
  const words = normalized.split(' ').filter(Boolean);
  return /\bpacientes?\b/.test(normalized) && words.every((w) => GENERIC_WORDS.has(w));
}

function findPopulation(normalized: string): Population | null {
  if (!PATIENT_CUE.test(normalized) || OTHER_TOPIC.test(normalized)) return null;
  const threshold = ageThreshold(normalized);
  if (threshold) return threshold;
  const named = POPULATIONS.find(([re]) => re.test(normalized))?.[1];
  if (named) return named;
  return isAllPatients(normalized) ? { label: 'pacientes', them: 'ellos', column: null, values: [] } : null;
}

// Periodo pedido; sin periodo, este mes (como el resto del plan B).
function periodOf(tokens: string[]): { label: string; start: string } {
  if (tokens.includes('hoy')) return { label: 'hoy', start: 'agent.reference_date()' };
  if (tokens.includes('semana')) return { label: 'en la última semana', start: 'agent.reference_date() - 6' };
  if (tokens.includes('treintadias')) return { label: 'en los últimos 30 días', start: 'agent.reference_date() - 29' };
  return { label: 'este mes', start: MONTH_START };
}

function answerPopulation(population: Population, period: string) {
  return (rows: Row[]): string => {
    if (rows.length === 0) return NO_DATA_ANSWER;
    const patients = rows.reduce((acc, r) => acc + num(r.pacientes), 0);
    const hospitalized = rows.reduce((acc, r) => acc + num(r.hospitalizados), 0);
    const total = num(rows[0].pacientes_periodo);
    const share =
      total > 0 && population.column !== null
        ? ` Son el ${fmt((100 * patients) / total)} % de los ${fmt(total, 0)} pacientes del periodo.`
        : '';
    // Grupos de edad en orden numérico ("5-17" antes que "18-29"), no alfabético.
    const byAge = [...rows].sort((a, b) => parseInt(String(a.grupo_edad), 10) - parseInt(String(b.grupo_edad), 10));
    const detail =
      rows.length > 1
        ? ` Por grupo de edad: ${byAge.map((r) => `${String(r.grupo_edad)} años, ${fmt(r.pacientes, 0)}`).join('; ')}.`
        : '';
    return (
      `${cap(period)} ingresaron ${fmt(patients, 0)} ${population.label}; ` +
      `${fmt(hospitalized, 0)} de ${population.them} ${hospitalized === 1 ? 'quedó' : 'quedaron'} ${population.them === 'ellas' ? 'hospitalizada' : 'hospitalizado'}${hospitalized === 1 ? '' : 's'}.${detail}${share}` +
      (population.note ? ` ${population.note}` : '')
    );
  };
}

export function populationEntry(question: string): PlanBEntry | null {
  const population = findPopulation(normalizeText(question));
  if (!population) return null;
  const period = periodOf(canonicalize(question));
  const inList = population.values.map((v) => `'${v}'`).join(', ');
  const range = `admitted_at >= ${period.start} AND admitted_at < agent.reference_date() + 1`;
  return {
    id: 'patients_by_population',
    question: `¿Cuántos pacientes ${population.label} ingresaron ${period.label}?`,
    variants: [],
    keywords: [],
    sql: `SELECT age_group AS grupo_edad,
       COUNT(DISTINCT patient_key) AS pacientes,
       COUNT(DISTINCT patient_key) FILTER (WHERE admission_class = 'Hospitalario') AS hospitalizados,
       (SELECT COUNT(DISTINCT patient_key) FROM agent.v_admissions WHERE ${range}) AS pacientes_periodo
FROM agent.v_admissions
WHERE ${
      population.column
        ? `${population.column} IN (${inList})
  AND `
        : ''
    }${range}
GROUP BY age_group
ORDER BY age_group
LIMIT 20`,
    views_used: ['v_admissions'],
    buildAnswer: answerPopulation(population, period.label),
  };
}

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
  // true solo si la pregunta es idéntica a la canónica o a una variante; un puntaje de 1 por
  // palabras clave NO es exacto.
  exact: boolean;
}

// Preguntas sobre el futuro ("¿cuál será la ocupación la próxima semana?"): ninguna vista las responde
// y una pregunta fija parecida presentaría el dato de hoy como si fuera un pronóstico.
const FORWARD_LOOKING = /\b(sera|seran|proxim[oa]s?|pronostic\w*|predic\w*|predecir|futur[oa]s?|proyeccion\w*)\b/;

export function isForwardLooking(question: string): boolean {
  return FORWARD_LOOKING.test(normalizeText(question));
}

export function matchPlanB(question: string): PlanBMatch | null {
  const normalized = normalizeText(question);
  // Coincidencia exacta con la pregunta canónica o una variante: puntaje máximo.
  for (const entry of PLAN_B) {
    const forms = [entry.question, ...entry.variants].map(normalizeText);
    if (forms.includes(normalized)) return { entry, score: 1, exact: true };
  }
  // Una enfermedad concreta: ninguna pregunta fija filtra por diagnóstico. Si la pregunta lo dice
  // explícitamente ("diagnóstico de neumonía"), gana la búsqueda; si no ("casos de dengue"), solo
  // se usa cuando ninguna pregunta fija encaja.
  if (isForwardLooking(question)) return null;
  const diagnosis = diagnosisSearchEntry(question);
  if (diagnosis && isExplicitDiagnosisQuestion(question))
    return { entry: diagnosis, score: MATCH_THRESHOLD, exact: false };
  // Una población ("niños", "mujeres", "adultos mayores"): ninguna pregunta fija filtra por ella.
  const population = diagnosis ? null : populationEntry(question);
  if (population) return { entry: population, score: MATCH_THRESHOLD, exact: false };
  const tokens = canonicalize(question);
  const scored = PLAN_B.map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((m) => m.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return diagnosis ? { entry: diagnosis, score: MATCH_THRESHOLD, exact: false } : null;
  // Dos candidatos casi empatados: ambigua, no se adivina.
  if (scored.length > 1 && scored[0].score - scored[1].score < AMBIGUITY_MARGIN) return null;
  return { ...scored[0], exact: false };
}

// Preguntas que se sugieren cuando no hay coincidencia (AGE-10): las 4 de la demo.
export function suggestedQuestions(): string[] {
  return PLAN_B.slice(0, 4).map((e) => e.question);
}
