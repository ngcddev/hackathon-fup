import 'server-only';
import { ApiError } from '@/lib/api/errors';
import type { AuthUser } from '@/lib/auth/with-auth';
import { queryAsAppBackend, runAgentQuery } from '@/lib/db';
import type { AgentView, AppModule, LlmProvider, QueryCell, QueryOrigin, QueryResponse } from '@/lib/types/api';
import { fillAnswerTemplate } from './answer-template';
import { ALERT_PLAN_COLUMNS, buildAlertPlan, isAlertPlanQuestion } from './alert-plan';
import { getActiveAlerts } from './alert-suggestion-service';
import { describeResult, followUpQuestions, relatedModules, viewNotes } from './context';
import { detectHelp, HELP_COLUMNS, helpAnswer, helpRows, SCOPE_HINT, type HelpKind } from './help';
import {
  buildFinding,
  INSIGHT_CHECKS,
  INSIGHTS_COLUMNS,
  isInsightsQuestion,
  summarizeInsights,
  type Finding,
} from './insights';
import { forgetDecision, generateSqlWithLlm, isLlmEnabled, rememberDecision, type LlmDecision } from './llm';
import { NO_DATA_ANSWER, isForwardLooking, matchPlanB, suggestedQuestions } from './plan-b';
import { isSensitiveQuestion, redactQuestionForLog, SENSITIVE_MESSAGE, stripPatientKey } from './privacy';
import { logQuery } from './query-log';
import { MAX_LIMIT, validateSql } from './validator';

// Flujo de POST /api/query (AGE-03 a AGE-07):
//   privacidad → pregunta idéntica a una del plan B (respuesta directa, sin LLM) →
//   LLM (Gemini → Groq) → según el type: sensitive → 422; out_of_scope → plan B o 422;
//   sql → validador → runAgentQuery. Si el LLM, el validador o la ejecución fallan → plan B (AGE-05).
//   → quitar patient_key → respuesta → registro en audit.query_log (con la causa del respaldo).

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

interface Trace {
  origin: QueryOrigin;
  provider: LlmProvider | null;
  sql: string | null;
  // Causa por la que se pasó al plan B (AGE-05); va a query_log.error_message aunque la respuesta sea 'ok'.
  note: string | null;
}

interface Outcome {
  response: QueryResponse;
  sql: string;
}

const NOTE_MAX = 300;

function buildResponse(
  question: string,
  started: number,
  referenceDate: string,
  data: {
    answer: string;
    sql: string;
    viewsUsed: AgentView[];
    columns: string[];
    rows: Record<string, unknown>[];
    origin: QueryOrigin;
    provider: LlmProvider | null;
    followUps?: string[]; // preguntas sugeridas por el LLM
    withContext?: boolean; // false en las respuestas de ayuda: sin destacados, notas ni sugerencias
    highlights?: string[]; // si vienen, reemplazan a los calculados con describeResult
    notes?: string[]; // si vienen, reemplazan a las notas por vista
    modules?: AppModule[]; // módulos que van antes que los derivados de las vistas
  },
): QueryResponse {
  const matrix = data.rows.map((row) => data.columns.map((c) => toCell(row[c])));
  const truncated = matrix.length >= MAX_LIMIT;
  const withContext = data.withContext ?? true;
  return {
    question,
    answer: data.answer,
    sql: data.sql,
    columns: data.columns,
    rows: matrix,
    row_count: matrix.length,
    truncated,
    origin: data.origin,
    llm_provider: data.provider,
    views_used: data.viewsUsed,
    includes_simulated_data: data.viewsUsed.some((v) => SIMULATED_VIEWS.has(v)),
    reference_date: referenceDate,
    duration_ms: Math.round(performance.now() - started),
    highlights: withContext ? (data.highlights ?? describeResult(data.columns, data.rows)) : [],
    notes: withContext
      ? (data.notes ?? (data.rows.length > 0 ? viewNotes(data.viewsUsed, data.answer, truncated) : []))
      : [],
    follow_up_questions: withContext ? followUpQuestions(question, data.viewsUsed, data.followUps) : [],
    modules: withContext ? relatedModules(data.viewsUsed, data.modules) : [],
  };
}

// Saludos y preguntas sobre el asistente: temas disponibles con un ejemplo de cada uno, sin SQL.
async function helpResponse(question: string, started: number, kind: HelpKind): Promise<QueryResponse> {
  const referenceDate = await getReferenceDate();
  return buildResponse(question, started, referenceDate, {
    answer: helpAnswer(kind, referenceDate),
    sql: '',
    viewsUsed: [],
    columns: HELP_COLUMNS,
    rows: helpRows(),
    origin: 'predefined',
    provider: null,
    withContext: false,
  });
}

// Hallazgos: cada indicador pasa por el validador y se ejecuta con agent_ro, todos en paralelo.
// Si uno falla, se omite; si fallan todos, el asistente no está disponible.
async function insightsResponse(question: string, started: number): Promise<Outcome> {
  const results = await Promise.all(
    INSIGHT_CHECKS.map(async (check) => {
      try {
        const validation = await validateSql(check.sql);
        if (!validation.ok) {
          console.error(`[agent] El indicador "${check.id}" no pasó el validador: ${validation.reason}`);
          return null;
        }
        const result = await runWithColdCacheRetry(validation.sql);
        const finding = buildFinding(check, result.rows);
        return finding ? { finding, sql: validation.sql, views: validation.viewsUsed } : null;
      } catch (error) {
        const code = (error as { cause?: { code?: string } }).cause?.code;
        console.warn(`[agent] El indicador "${check.id}" falló (${code ?? 'sin código'}); se omite.`);
        return null;
      }
    }),
  );
  const ok = results.filter((r): r is { finding: Finding; sql: string; views: AgentView[] } => r !== null);
  const referenceDate = await getReferenceDate();
  const summary = summarizeInsights(
    ok.map((r) => r.finding),
    referenceDate,
  );
  if (!summary) throw new ApiError('AGENT_UNAVAILABLE');
  const sql = ok.map((r) => r.sql).join(';\n\n');
  const response = buildResponse(question, started, referenceDate, {
    answer: summary.answer,
    sql,
    viewsUsed: [...new Set(ok.flatMap((r) => r.views))],
    columns: INSIGHTS_COLUMNS,
    rows: summary.rows,
    origin: 'predefined',
    provider: null,
    highlights: summary.highlights,
    followUps: summary.followUps,
  });
  return { response, sql };
}

// Plan de acción: las mismas alertas que el módulo Alertas (mismas consultas fijas y buildAlerts),
// con pasos concretos por tipo. No usa LLM ni SQL generado.
async function alertPlanResponse(question: string, started: number): Promise<Outcome> {
  const plan = buildAlertPlan(await getActiveAlerts());
  const response = buildResponse(question, started, await getReferenceDate(), {
    answer: plan.answer,
    sql: '',
    viewsUsed: plan.views,
    columns: ALERT_PLAN_COLUMNS,
    rows: plan.rows,
    origin: 'predefined',
    provider: null,
    highlights: plan.highlights,
    notes: plan.notes,
    modules: plan.modules,
    followUps: plan.followUps,
  });
  return { response, sql: '' };
}

// Mensaje de "fuera de alcance" con orientación sobre lo que sí se puede preguntar.
function outOfScopeMessage(reason: string | null): string {
  const base = reason ? reason.replace(/[.\s]+$/, '') + '.' : 'No tengo datos para responder esa pregunta.';
  return `${base} ${SCOPE_HINT}`;
}

type LlmSqlResult = { ok: true; outcome: Outcome } | { ok: false; note: string; validatorRejected: boolean };

// SQL del LLM: validador → ejecución con agent_ro (con el mismo reintento por caché fría que el plan B).
// Si falla, responde el plan B.
async function answerWithLlmSql(
  question: string,
  started: number,
  decision: Extract<LlmDecision, { type: 'sql' }>,
  provider: LlmProvider,
): Promise<LlmSqlResult> {
  const validation = await validateSql(decision.sql);
  if (!validation.ok) {
    console.warn(`[agent] El SQL de ${provider} no pasó el validador: ${validation.reason}`);
    return { ok: false, note: `SQL del LLM rechazado por el validador: ${validation.reason}`, validatorRejected: true };
  }
  let result;
  try {
    result = await runWithColdCacheRetry(validation.sql);
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    console.warn(`[agent] El SQL de ${provider} falló al ejecutarse (${code ?? 'sin código'}).`);
    const why = code === '57014' ? 'timeout de 5 s' : `error de ejecución${code ? ` (${code})` : ''}`;
    return { ok: false, note: `SQL del LLM falló al ejecutarse: ${why}`, validatorRejected: false };
  }
  const { columns, rows } = stripPatientKey(result.columns, result.rows);
  const answer = rows.length === 0 ? NO_DATA_ANSWER : fillAnswerTemplate(decision.answerTemplate, columns, rows);
  const response = buildResponse(question, started, await getReferenceDate(), {
    answer,
    sql: validation.sql,
    viewsUsed: validation.viewsUsed,
    columns,
    rows,
    origin: 'llm',
    provider,
    followUps: decision.followUps,
  });
  return { ok: true, outcome: { response, sql: validation.sql } };
}

async function execute(question: string, trace: Trace): Promise<Outcome> {
  const started = performance.now();
  let outOfScopeReason: string | null = null;
  let validatorRejected = false;

  // 0. Una pregunta idéntica a una del plan B (las de la demo y sus variantes), o que cumple todas las palabras
  //    clave de una entrada `direct`, se responde con su SQL fijo: sin gastar tokens del LLM ni depender de la
  //    red, y siempre con la misma respuesta.
  const match = matchPlanB(question);
  const directPlanB = match !== null && (match.exact || (match.score === 1 && match.entry.direct === true));

  // 1. LLM (Gemini → Groq). Con AGENT_LLM_ENABLED apagado no hay llamada y el flujo sigue con el plan B.
  if (!directPlanB && isLlmEnabled()) {
    const llm = await generateSqlWithLlm(question);
    if (llm.status === 'unavailable') {
      trace.note = `LLM no disponible: ${llm.reason}`;
    } else {
      const { decision, provider } = llm;
      trace.origin = 'llm';
      trace.provider = provider;
      if (decision.type === 'sensitive') {
        trace.note = 'El LLM marcó la pregunta como sensible';
        throw new ApiError('SENSITIVE_DATA_REQUESTED', SENSITIVE_MESSAGE);
      }
      if (decision.type === 'help') {
        trace.note = 'El LLM marcó la pregunta como consulta sobre el asistente';
        return { response: await helpResponse(question, started, 'help'), sql: '' };
      }
      if (decision.type === 'out_of_scope') {
        outOfScopeReason = decision.reason;
        trace.note = 'El LLM marcó la pregunta como fuera de alcance';
      } else {
        const attempt = await answerWithLlmSql(question, started, decision, provider);
        if (attempt.ok) {
          rememberDecision(question, decision, provider);
          trace.sql = attempt.outcome.sql;
          return attempt.outcome;
        }
        forgetDecision(question);
        trace.sql = decision.sql;
        trace.note = attempt.note;
        validatorRejected = attempt.validatorRejected;
      }
    }
  }

  // 2. Plan B (AGE-05).
  if (!match) {
    if (outOfScopeReason !== null) {
      throw new ApiError('OUT_OF_SCOPE', outOfScopeMessage(outOfScopeReason));
    }
    // SQL del LLM bloqueado por el validador (p. ej. pide otro esquema) y sin plan B: se trata como fuera de alcance.
    if (validatorRejected) throw new ApiError('OUT_OF_SCOPE', outOfScopeMessage(null));
    if (isForwardLooking(question)) {
      throw new ApiError(
        'OUT_OF_SCOPE',
        outOfScopeMessage('Solo consulto datos históricos y de hoy; no hago pronósticos ni estimaciones del futuro'),
      );
    }
    const suggestions = suggestedQuestions()
      .map((q) => `"${q}"`)
      .join(' · ');
    throw new ApiError(
      'AGENT_UNAVAILABLE',
      `No pude interpretar la pregunta y el asistente inteligente no está disponible. Prueba con una de estas: ${suggestions}`,
    );
  }
  // El LLM dijo que ninguna vista responde y el plan B solo coincide por palabras clave: es más honesto
  // rechazar que devolver una pregunta parecida (p. ej. "menos frecuente en cardiología" no existe).
  if (outOfScopeReason !== null && !match.exact) {
    throw new ApiError('OUT_OF_SCOPE', outOfScopeMessage(outOfScopeReason));
  }
  const { entry } = match;
  // Coincidencia aproximada: se dice qué pregunta se respondió, para que no parezca la que se hizo.
  const interpretedAs = !match.exact ? `Interpreté tu pregunta como: «${entry.question}» ` : '';
  trace.origin = 'predefined';
  trace.provider = null;

  // 3. Validador: el SQL predefinido pasa por las mismas reglas que el del LLM.
  const validation = await validateSql(entry.sql);
  if (!validation.ok) {
    console.error(`[agent] El SQL del plan B "${entry.id}" no pasó el validador: ${validation.reason}`);
    throw new ApiError('AGENT_UNAVAILABLE');
  }
  trace.sql = validation.sql;

  // 4. Ejecución con el rol agent_ro y sin patient_key.
  const result = await runWithColdCacheRetry(validation.sql);
  const { columns, rows } = stripPatientKey(result.columns, result.rows);
  const response = buildResponse(question, started, await getReferenceDate(), {
    answer: interpretedAs + (rows.length === 0 ? NO_DATA_ANSWER : entry.buildAnswer(rows)),
    sql: validation.sql,
    viewsUsed: validation.viewsUsed,
    columns,
    rows,
    origin: 'predefined',
    provider: null,
  });
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

  // AGE-10: saludos y "¿qué puedo consultar?" se responden sin LLM con los temas disponibles.
  const helpKind = detectHelp(question);
  if (helpKind) {
    const response = await helpResponse(question, started, helpKind);
    await logQuery({
      ...base,
      generatedSql: null,
      status: 'ok',
      errorMessage: null,
      rowCount: response.row_count,
      durationMs: elapsed(),
    });
    return { ...response, duration_ms: elapsed() };
  }

  const trace: Trace = { origin: 'predefined', provider: null, sql: null, note: null };
  const note = () => (trace.note === null ? null : trace.note.slice(0, NOTE_MAX));

  try {
    // "¿Qué encontraste de novedoso?", "¿cómo vamos?": varios indicadores sin LLM.
    // "¿Cómo soluciono las alertas?": plan de acción con las alertas del módulo.
    const { response, sql } = isAlertPlanQuestion(question)
      ? await alertPlanResponse(question, started)
      : isInsightsQuestion(question)
        ? await insightsResponse(question, started)
        : await execute(question, trace);
    await logQuery({
      ...base,
      origin: response.origin,
      llmProvider: response.llm_provider,
      generatedSql: sql === '' ? null : sql,
      status: 'ok',
      // Si respondió el plan B por un fallo del LLM, aquí queda la causa (AGE-05).
      errorMessage: note(),
      rowCount: response.row_count,
      durationMs: elapsed(),
    });
    return { ...response, duration_ms: elapsed() };
  } catch (error) {
    const rejected =
      error instanceof ApiError &&
      (error.code === 'AGENT_UNAVAILABLE' ||
        error.code === 'OUT_OF_SCOPE' ||
        error.code === 'SENSITIVE_DATA_REQUESTED');
    await logQuery({
      ...base,
      origin: trace.origin,
      llmProvider: trace.provider,
      generatedSql: trace.sql,
      status: rejected ? 'rejected' : 'error',
      // Detalle solo para auditoría interna; nunca sale al cliente.
      errorMessage: [error instanceof ApiError ? error.code : 'Error de ejecución', note()].filter(Boolean).join(' · '),
      rowCount: null,
      durationMs: elapsed(),
    });
    throw error;
  }
}
