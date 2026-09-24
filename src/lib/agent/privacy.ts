// Filtro de privacidad del agente (SEG-04, RNF-03, regla no negociable 2).
// Sin imports del servidor: se prueba con vitest.

import { normalizeText } from './text';

export const SENSITIVE_MESSAGE =
  'No puedo responder preguntas sobre una persona identificable (nombre, documento, teléfono, dirección o historia clínica de un paciente). ' +
  'Este asistente solo entrega datos agregados y anonimizados para proteger la privacidad de los pacientes. ' +
  'Prueba con una pregunta sobre cifras del hospital, por ejemplo: "¿Qué servicio tiene más pacientes ingresados este mes?".';

// Palabras que apuntan a identificar a alguien.
const IDENTITY_WORDS =
  /\b(cedula|cedulas|documento|documentos|identificacion|tarjeta de identidad|pasaporte|telefono|celular|direccion|domicilio|historia clinica|historias clinicas|como se llama|quien es)\b/;
// "nombre" o "apellido" solo son sensibles si se refieren a una persona (no "nombre del servicio").
const NAME_OF_PERSON =
  /\b(nombre|nombres|apellido|apellidos)\b.*\b(paciente|persona|senor|senora|usuario|madre|padre|hijo|hija)\b|\b(paciente|persona|senor|senora|usuario)\b.*\b(nombre|nombres|apellido|apellidos)\b/;
const PATIENT_ID = /\bpaciente\s+(numero|no|id|con id|llamado|llamada)\b/;
// Datos individuales de un paciente concreto.
const INDIVIDUAL_RECORD =
  /\b(diagnostico|motivo|historia|resultado|examenes)\b.{0,25}\b(del|de la|de el)\s+(paciente|senor|senora)\b/;

// Secuencias de 6 a 11 dígitos (documentos), también con puntos, comas o espacios de miles.
const DIGIT_RUN = /(?<!\d)\d{6,11}(?!\d)/;

function collapseDigitSeparators(text: string): string {
  return text.replace(/(?<=\d)[.,\s](?=\d{3}(?!\d))/g, '');
}

export function isSensitiveQuestion(question: string): boolean {
  const normalized = normalizeText(question);
  const compact = collapseDigitSeparators(question);
  return (
    DIGIT_RUN.test(question) ||
    DIGIT_RUN.test(compact) ||
    IDENTITY_WORDS.test(normalized) ||
    NAME_OF_PERSON.test(normalized) ||
    PATIENT_ID.test(normalized) ||
    INDIVIDUAL_RECORD.test(normalized)
  );
}

// Para registrar la pregunta en la auditoría sin guardar números de documento (SEG-06).
export function redactQuestionForLog(question: string): string {
  return collapseDigitSeparators(question).replace(/\d{6,}/g, '[número omitido]');
}

export const PATIENT_KEY_COLUMN = 'patient_key';

// Quita patient_key del resultado aunque la consulta lo haya seleccionado (regla 2).
export function stripPatientKey<T extends Record<string, unknown>>(
  columns: string[],
  rows: T[],
): { columns: string[]; rows: Record<string, unknown>[] } {
  const isBlocked = (name: string) => name.toLowerCase() === PATIENT_KEY_COLUMN;
  if (!columns.some(isBlocked)) return { columns, rows };
  return {
    columns: columns.filter((c) => !isBlocked(c)),
    rows: rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !isBlocked(key)))),
  };
}
