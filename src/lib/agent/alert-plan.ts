// Plan de acción para las alertas activas (ALE, AGE-06): "¿cómo soluciono las alertas?".
// Usa las mismas alertas que el módulo Alertas (buildAlerts, mismo orden y recomendaciones) y
// agrega pasos concretos según el tipo. run.ts carga los datos; aquí solo detección y textos.
// Sin imports del servidor: se prueba con vitest.

import type { AgentView, AppModule, KpiAlert } from '../types/api';
import { normalizeText } from './text';

// ------------------------------------------------------------------ Detección

const ALERTS = /\b(alertas?|plan de accion|que debo atender|que atiendo primero|que hago primero)\b/;

export function isAlertPlanQuestion(question: string): boolean {
  return ALERTS.test(normalizeText(question));
}

// ------------------------------------------------------------------ Pasos por tipo

const SEVERITY_LABEL: Record<KpiAlert['severity'], string> = { critical: 'Crítica', warning: 'Advertencia' };

// Nombre de lo afectado, sacado del título ("Ocupación crítica: UCI NEONATAL" → "UCI NEONATAL").
const subject = (alert: KpiAlert) => alert.title.split(':').slice(1).join(':').trim() || alert.title;

// Un paso del plan: qué hacer, quién lo hace (rol, nunca una persona) y cuándo.
export interface PlaybookStep {
  action: string;
  owner: string;
  timeframe: string;
}

// Responsable del primer paso (la recomendación del módulo) según el tipo de alerta.
const FIRST_OWNER: Record<KpiAlert['type'], string> = {
  occupancy: 'Gestión de camas',
  stockout: 'Farmacia',
  emergency_wait: 'Coordinación de urgencias',
  surgery_compliance: 'Coordinación de cirugía',
};

// Pasos por tipo; el primero siempre es la recomendación del módulo Alertas.
export function playbook(alert: KpiAlert): PlaybookStep[] {
  const critical = alert.severity === 'critical';
  const steps: PlaybookStep[] = [
    { action: alert.recommendation, owner: FIRST_OWNER[alert.type], timeframe: critical ? 'Ahora' : 'Hoy' },
  ];
  const add = (action: string, owner: string, timeframe: string) => steps.push({ action, owner, timeframe });
  switch (alert.type) {
    case 'occupancy':
      add(
        'Revisar con el servicio las altas previstas para hoy y agilizar las que ya estén listas.',
        'Jefe de servicio',
        'Hoy',
      );
      if (critical) {
        add(
          `Frenar los ingresos programados no urgentes a ${subject(alert)} hasta bajar del 85 %.`,
          'Coordinación de admisiones',
          'Hoy',
        );
      }
      add('Volver a medir la ocupación en cada cambio de turno.', 'Jefe de servicio', 'Cada turno');
      break;
    case 'stockout':
      if (critical) {
        if (alert.is_simulated) {
          add('Confirmar el stock físico en farmacia: el inventario del sistema es simulado.', 'Farmacia', 'Ahora');
        }
        add(
          'Si el proveedor no alcanza a entregar, acordar con el comité de farmacia un sustituto terapéutico o un préstamo con otra institución.',
          'Comité de farmacia',
          'Hoy',
        );
        add('Priorizar la dispensación a los servicios que más lo consumen.', 'Farmacia', 'Hasta reponer');
      } else {
        add(
          'Incluirlos en el próximo pedido para que no lleguen al umbral crítico de 5 días.',
          'Farmacia',
          'Esta semana',
        );
      }
      break;
    case 'emergency_wait':
      add(
        'Revisar el cuello de botella en ese turno: tiempo de triage a consulta y médicos disponibles.',
        'Coordinación de urgencias',
        'Hoy',
      );
      add(
        critical
          ? 'Activar la atención prioritaria de triage 1 y 2 que exige la Resolución 5596 de 2015.'
          : 'Evaluar una ruta rápida para pacientes de baja complejidad.',
        'Coordinación de urgencias',
        critical ? 'Ahora' : 'Esta semana',
      );
      break;
    case 'surgery_compliance':
      add(
        'Revisar las cancelaciones del mes con programación quirúrgica y confirmar a los pacientes con 48 horas de anticipación.',
        'Coordinación de cirugía',
        'Esta semana',
      );
      break;
  }
  return steps;
}

export function actionSteps(alert: KpiAlert): string[] {
  return playbook(alert).map((s) => s.action);
}

// Indicador que confirma que la alerta se resolvió.
export function monitorFor(alert: KpiAlert): string {
  switch (alert.type) {
    case 'occupancy':
      return `La ocupación de ${subject(alert)} vuelve a quedar por debajo del 85 %.`;
    case 'stockout':
      return `${subject(alert)} vuelve a tener más de 10 días de inventario.`;
    case 'emergency_wait':
      return `La espera promedio de ${subject(alert)} vuelve a quedar por debajo de su umbral.`;
    case 'surgery_compliance':
      return 'El cumplimiento quirúrgico del mes vuelve a superar la meta de 80 %.';
  }
}

// ------------------------------------------------------------------ Respuesta

export const ALERT_PLAN_COLUMNS = ['prioridad', 'severidad', 'alerta', 'situacion', 'que_hacer'];
const MAX_HIGHLIGHTS = 3;

const VIEW_OF_TYPE: Record<KpiAlert['type'], AgentView> = {
  occupancy: 'v_bed_occupancy',
  stockout: 'v_drug_inventory',
  emergency_wait: 'v_emergency_wait_times',
  surgery_compliance: 'v_surgeries',
};

// Preguntas del plan B para profundizar en cada tipo.
const FOLLOW_UP_OF_TYPE: Record<KpiAlert['type'], string> = {
  occupancy: '¿Cuál es la ocupación de camas por servicio hoy?',
  stockout: '¿Cuáles son los medicamentos con menos de 5 días de inventario?',
  emergency_wait: '¿Cuál es la espera promedio en urgencias por nivel de triage este mes?',
  surgery_compliance: '¿Cuál es el cumplimiento quirúrgico por mes?',
};

export interface AlertPlan {
  answer: string;
  highlights: string[];
  notes: string[];
  rows: Record<string, string>[];
  views: AgentView[];
  modules: AppModule[];
  followUps: string[];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const TYPE_LABEL: Record<KpiAlert['type'], string> = {
  occupancy: 'Ocupación de camas',
  stockout: 'Inventario de medicamentos',
  emergency_wait: 'Espera en urgencias',
  surgery_compliance: 'Cumplimiento quirúrgico',
};

// Nombres del HIS muy largos ("ALIMENTO LIQUIDO PARA PROPOSITOS…, POLIMERICO, …"): se cortan en la
// primera coma o guion después del nombre principal. La tabla conserva el nombre completo.
const MAX_NAME = 50;
export function shortName(name: string): string {
  if (name.length <= MAX_NAME) return name;
  const cut = name.slice(15).search(/,| -| \(/);
  // Se prefiere cortar en la coma aunque pase un poco del máximo, antes que partir una palabra.
  const short = cut >= 0 && cut + 15 <= MAX_NAME + 10 ? name.slice(0, cut + 15) : name.slice(0, MAX_NAME).trimEnd();
  return `${short}…`;
}

// Una frase por tipo de alerta, con la más urgente de ese tipo (el orden del módulo ya la pone primero).
function typeSummary(alerts: KpiAlert[], type: KpiAlert['type']): string {
  const ofType = alerts.filter((a) => a.type === type);
  const critical = ofType.filter((a) => a.severity === 'critical').length;
  const top = ofType[0];
  const detail =
    critical > 0
      ? `${plural(ofType.length, 'alerta', 'alertas')}, ${critical} ${critical === 1 ? 'crítica' : 'críticas'}`
      : plural(ofType.length, 'advertencia', 'advertencias');
  return `${TYPE_LABEL[type]}: ${detail}. La más urgente es ${shortName(subject(top))}: ${top.recommendation}`;
}

// alerts en el orden del módulo (críticas primero).
export function buildAlertPlan(alerts: KpiAlert[]): AlertPlan {
  if (alerts.length === 0) {
    return {
      answer:
        'No hay alertas activas: la ocupación, el inventario de medicamentos y la espera en urgencias están dentro de sus umbrales. ' +
        'Conviene seguir revisando el módulo de alertas en cada cambio de turno.',
      highlights: [],
      notes: [],
      rows: [],
      views: [],
      modules: ['alerts'],
      followUps: [FOLLOW_UP_OF_TYPE.occupancy, FOLLOW_UP_OF_TYPE.stockout],
    };
  }

  const critical = alerts.filter((a) => a.severity === 'critical').length;
  const warning = alerts.length - critical;
  const counts = [
    critical && plural(critical, 'crítica', 'críticas'),
    warning && plural(warning, 'advertencia', 'advertencias'),
  ]
    .filter(Boolean)
    .join(' y ');
  const first = alerts[0];
  const types = [...new Set(alerts.map((a) => a.type))];

  return {
    answer:
      `Hay ${plural(alerts.length, 'alerta activa', 'alertas activas')} (${counts}). ` +
      `Empiece por la más urgente, ${shortName(first.title)}: ${first.recommendation}`,
    highlights: types.slice(0, MAX_HIGHLIGHTS).map((t) => typeSummary(alerts, t)),
    notes: [
      ...(alerts.some((a) => a.is_simulated)
        ? ['Algunas alertas usan datos simulados (inventario o capacidad de camas): valide las cifras antes de actuar.']
        : []),
      'Son sugerencias operativas a partir de los datos; la decisión final es del equipo asistencial.',
    ],
    rows: alerts.map((a, i) => ({
      prioridad: String(i + 1),
      severidad: SEVERITY_LABEL[a.severity],
      alerta: a.title,
      situacion: a.message,
      que_hacer: actionSteps(a)
        .map((step, j) => `${j + 1}) ${step}`)
        .join(' '),
    })),
    views: types.map((t) => VIEW_OF_TYPE[t]),
    modules: ['alerts'],
    followUps: types.map((t) => FOLLOW_UP_OF_TYPE[t]),
  };
}
