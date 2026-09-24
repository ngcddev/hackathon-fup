// Punto de entrada del LLM (AGE-02). Por ahora responde "no disponible" y el flujo cae al plan B.
//
// Cómo se conecta (siguiente sesión): implementar `generateSqlWithLlm` para que, con
// AGENT_LLM_ENABLED=true, llame a Gemini (principal) y a Groq (respaldo) con el esquema de las
// vistas del agente, la pregunta y los few-shot, y devuelva { status: 'ok', sql, provider }.
// El SQL devuelto NO se ejecuta aquí: run.ts lo pasa por validateSql y runAgentQuery igual que
// el del plan B. Cualquier fallo del LLM (cuota, timeout, SQL inválido) devuelve
// { status: 'unavailable', reason } y el flujo sigue con el plan B (AGE-05).
// El LLM solo recibe esquema, pregunta y agregados; nunca filas de pacientes (RNF-03).

import type { LlmProvider } from '../types/api';

export type LlmOutcome =
  | { status: 'ok'; sql: string; provider: LlmProvider }
  | { status: 'unavailable'; reason: string };

export function isLlmEnabled(): boolean {
  return process.env.AGENT_LLM_ENABLED === 'true';
}

export async function generateSqlWithLlm(question: string): Promise<LlmOutcome> {
  void question;
  if (!isLlmEnabled()) return { status: 'unavailable', reason: 'AGENT_LLM_ENABLED no está activo' };
  return { status: 'unavailable', reason: 'LLM sin conectar todavía' };
}
