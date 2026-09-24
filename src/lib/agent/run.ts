import 'server-only';
import { ApiError } from '@/lib/api/errors';
import type { AuthUser } from '@/lib/auth/with-auth';
import { queryAsAppBackend, runAgentQuery } from '@/lib/db';
import type { QueryCell, QueryResponse } from '@/lib/types/api';
import { generateSqlWithLlm } from './llm';
import { NO_DATA_ANSWER, matchPlanB, suggestedQuestions } from './plan-b';
import { isSensitiveQuestion, redactQuestionForLog, SENSITIVE_MESSAGE, stripPatientKey } from './privacy';
import { logQuery } from './query-log';
import { MAX_LIMIT, validateSql } from './validator';

// Flujo de POST /api/query (AGE-03 a AGE-07):
//   privacidad → LLM (por ahora no disponible) → plan B → validador → runAgentQuery
//   → quitar patient_key → respuesta → registro en audit.query_log.

const SIMULATED_VIEWS = new Set(['v_drug_inventory']);

let cachedReferenceDate: { value: string; at: number } | undefined;

// Fecha de referencia ("hoy" del sistema). Casi nunca cambia: se cachea 5 minutos.
async function getReferenceDate(): Promise<string> {
  if (cachedReferenceDate && Date.now() - cachedReferenceDate.at < 5 * 60_000) {
    return cachedReferenceDate.value;
  }
  const rows = await queryAsAppBackend<{ reference_date: string }>(
    'SELECT agent.reference_date()::text AS reference_date',
  );
  const value = rows[0]?.reference_date ?? '';
  cachedReferenceDate = { value, at: Date.now() };
  return value;
}

function toCell(value: unknown): QueryCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

// Con la caché fría, una consulta puede pasar de los 5 s del rol del agente (statement_timeout,
// código 57014) y la siguiente responde en ~2 s. Se reintenta una sola vez.
async function runWithColdCacheRetry(sql: string) {
  try {
    return await runAgentQuery(sql);
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code !== '57014') throw error;
    console.warn('[agent] statement_timeout en la primera ejecución; se reintenta una vez.');
    return runAgentQuery(sql);
  }
}

interface Outcome {
  response: QueryResponse;
  sql: string;
}

async function execute(question: string): Promise<Outcome> {
  const started = performance.now();

  // 1. LLM: por ahora siempre "no disponible" (AGENT_LLM_ENABLED); el flujo sigue con el plan B.
  const llm = await generateSqlWithLlm(question);
  if (llm.status === 'ok') {
    // TODO (LLM): validar llm.sql con validateSql, ejecutarlo y responder con origin 'llm'.
    // Si falla la validación o la ejecución, se cae al plan B (AGE-05).
  }

  // 2. Plan B.
  const match = matchPlanB(question);
  if (!match) {
    const suggestions = suggestedQuestions().map((q) => `"${q}"`).join(' · ');
    throw new ApiError(
      'AGENT_UNAVAILABLE',
      `No pude interpretar la pregunta y el asistente inteligente no está disponible. Prueba con una de estas: ${suggestions}`,
    );
  }
  const { entry } = match;

  // 3. Validador: el SQL predefinido pasa por las mismas reglas que el del LLM.
  const validation = await validateSql(entry.sql);
  if (!validation.ok) {
    console.error(`[agent] El SQL del plan B "${entry.id}" no pasó el validador: ${validation.reason}`);
    throw new ApiError('AGENT_UNAVAILABLE');
  }

  // 4. Ejecución con el rol agent_ro y sin patient_key.
  const result = await runWithColdCacheRetry(validation.sql);
  const { columns, rows } = stripPatientKey(result.columns, result.rows);
  const matrix = rows.map((row) => columns.map((c) => toCell(row[c])));

  const response: QueryResponse = {
    question,
    answer: rows.length === 0 ? NO_DATA_ANSWER : entry.buildAnswer(rows),
    sql: validation.sql,
    columns,
    rows: matrix,
    row_count: matrix.length,
    truncated: matrix.length >= MAX_LIMIT,
    origin: 'predefined',
    llm_provider: null,
    views_used: validation.viewsUsed,
    includes_simulated_data: validation.viewsUsed.some((v) => SIMULATED_VIEWS.has(v)),
    reference_date: await getReferenceDate(),
    duration_ms: Math.round(performance.now() - started),
  };
  return { response, sql: validation.sql };
}

export async function handleQuery(question: string, user: AuthUser): Promise<QueryResponse> {
  const started = performance.now();
  const base = {
    userId: user.id,
    question: redactQuestionForLog(question),
    origin: 'predefined' as const,
    llmProvider: null,
  };
  const elapsed = () => Math.round(performance.now() - started);

  // SEG-04: antes de todo lo demás.
  if (isSensitiveQuestion(question)) {
    await logQuery({
      ...base,
      generatedSql: null,
      status: 'rejected',
      errorMessage: 'Pregunta sobre una persona identificable',
      rowCount: null,
      durationMs: elapsed(),
    });
    throw new ApiError('SENSITIVE_DATA_REQUESTED', SENSITIVE_MESSAGE);
  }

  try {
    const { response, sql } = await execute(question);
    await logQuery({
      ...base,
      generatedSql: sql,
      status: 'ok',
      errorMessage: null,
      rowCount: response.row_count,
      durationMs: elapsed(),
    });
    return { ...response, duration_ms: elapsed() };
  } catch (error) {
    const rejected = error instanceof ApiError && error.code === 'AGENT_UNAVAILABLE';
    await logQuery({
      ...base,
      generatedSql: null,
      status: rejected ? 'rejected' : 'error',
      // Detalle solo para auditoría interna; nunca sale al cliente.
      errorMessage: error instanceof ApiError ? error.code : 'Error de ejecución',
      rowCount: null,
      durationMs: elapsed(),
    });
    throw error;
  }
}
