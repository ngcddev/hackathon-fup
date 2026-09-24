// Preguntas sobre el propio asistente (AGE-10): saludos, agradecimientos y "¿qué puedo consultar?".
// Se reconocen sin LLM (no gastan cuota) y se responden con los temas disponibles y un ejemplo
// de cada uno, en vez de marcarlas como fuera de alcance. Sin imports del servidor: se prueba con vitest.

import { PLAN_B } from './plan-b';
import { normalizeText } from './text';

export type HelpKind = 'greeting' | 'thanks' | 'help';

const GREETING =
  '(?:hola|holi|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hey|oye|saludos|que tal|como estas|como vas)';
const LEAD = `^(?:${GREETING}\\s+)*(?:(?:y|a ver|dime|cuentame|me dices|me puedes decir|podrias decirme|quisiera saber|quiero saber|una pregunta)\\s+)?`;
const FILLER =
  '(?:\\s+(?:por favor|porfa|porfavor|contigo|con usted|aqui|aca|en este sistema|en el sistema|en este chat|del hospital|sobre el hospital|tu|usted|bot|asistente|agente|exactamente|hoy|entonces|mas|orientame|guiame|ayudame))*$';

const HELP_CORE = [
  'que (?:puedo|podria|se puede|le puedo|te puedo) (?:consultar|consultarte|preguntar|preguntarte|saber|pedir|pedirte|hacer)',
  'que (?:datos|informacion|info|temas|cosas|preguntas|consultas) (?:tienes|tiene|hay|manejas|maneja|conoces|respondes|sabes|puedo hacer|puedo consultar|puedo preguntar|puedes responder)',
  '(?:mas )?(?:de|sobre) (?:la |los )?(?:info|informacion|datos) que (?:tienes|tiene|manejas|maneja)',
  'que (?:sabes|puedes|puede) hacer',
  'en que (?:me |le )?(?:puedes|puede|podrias) ayudar(?:me|le)?',
  'como (?:te uso|lo uso|se usa|funcionas|funciona|funciona esto|te pregunto|uso esto)',
  'ayuda|ayudame|help|menu|opciones',
  '(?:que|quien) eres',
  'para que (?:sirves|sirve esto)',
  '(?:dame |muestrame )?(?:algunos |unos )?ejemplos?(?: de preguntas)?',
  'que (?:me )?(?:puedes|podrias|puede) (?:decir|responder|mostrar|contestar)',
  '(?:sobre |de )?que (?:temas|cosas) (?:me |le )?(?:puedes|puede|podrias|sabes) (?:informar|hablar|responder|ayudar|consultar)',
  'no se (?:que|como) (?:preguntar|preguntarte|consultar|usarte|empezar)',
  'orientame|guiame|por donde empiezo',
];

const HELP_RE = new RegExp(`${LEAD}(?:${HELP_CORE.join('|')})${FILLER}`);
const GREETING_RE = new RegExp(`^(?:${GREETING}\\s*)+${FILLER}`);
const THANKS_RE =
  /^(?:(?:muchas|mil) )?(?:gracias|ok|okay|listo|perfecto|genial|excelente|vale|entendido|super)(?: (?:gracias|muchas gracias|bot|asistente))*$/;

export function detectHelp(question: string): HelpKind | null {
  const text = normalizeText(question);
  if (text === '') return null;
  if (THANKS_RE.test(text)) return 'thanks';
  if (GREETING_RE.test(text)) return 'greeting';
  if (HELP_RE.test(text)) return 'help';
  return null;
}

// Un ejemplo por tema, tomado del plan B: se sabe que esas preguntas responden.
const TOPICS: { topic: string; example: string }[] = [
  { topic: 'Camas y ocupación por servicio', example: 'uci_beds_today' },
  { topic: 'Urgencias: espera, triage y horas de llegada', example: 'emergency_wait_week' },
  { topic: 'Ingresos por servicio, edad, sexo, régimen o zona', example: 'top_service_admissions_month' },
  { topic: 'Diagnósticos más frecuentes', example: 'top_diagnoses_month' },
  { topic: 'Inventario de medicamentos', example: 'drugs_below_5_days' },
  { topic: 'Consumo de medicamentos', example: 'top_dispensed_drugs_30d' },
  { topic: 'Servicios prestados por especialidad', example: 'top_specialties_services_month' },
  { topic: 'Cirugías programadas y realizadas', example: 'surgery_compliance_by_month' },
].map(({ topic, example }) => ({
  topic,
  example: PLAN_B.find((e) => e.id === example)?.question ?? '',
}));

export const HELP_COLUMNS = ['tema', 'ejemplo_de_pregunta'];

export function helpRows(): Record<string, string>[] {
  return TOPICS.map((t) => ({ tema: t.topic, ejemplo_de_pregunta: t.example }));
}

const LEAD_TEXT: Record<HelpKind, string> = {
  greeting: '¡Hola! Soy el asistente de datos del hospital.',
  thanks: 'Con gusto. Si quiere, puede seguir preguntando.',
  help: 'Soy el asistente de datos del hospital.',
};

// referenceDate en ISO (AAAA-MM-DD).
export function helpAnswer(kind: HelpKind, referenceDate: string): string {
  const date = referenceDate ? ` con corte al ${referenceDate.split('-').reverse().join('/')}` : '';
  return (
    `${LEAD_TEXT[kind]} Respondo preguntas con cifras agregadas y anonimizadas${date}. ` +
    'Estos son los temas que puedo consultar, con un ejemplo de cada uno; puede escribir la pregunta con sus propias palabras.'
  );
}

// Se agrega a los mensajes de "fuera de alcance" para orientar al usuario.
export const SCOPE_HINT =
  'Puedo responder sobre camas y ocupación, urgencias, ingresos, diagnósticos, medicamentos, especialidades y cirugías. ' +
  'Escriba "¿qué puedo consultar?" para ver ejemplos.';
