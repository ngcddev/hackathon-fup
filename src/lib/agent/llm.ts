// Cliente del LLM (AGE-02, RNF-10, RNF-03). Sin imports del servidor: se prueba con vitest.
//
// Cadena: Gemini (principal) → un reintento solo ante 429 o 5xx → Groq (respaldo) → plan B.
// Presupuesto total de 8 s con AbortController: Gemini hasta 3,5 s por llamada y Groq hasta 4 s.
// Gemini nunca consume el tiempo reservado para Groq, y si falla por saturación o timeout queda en
// pausa 60 s: mientras tanto las preguntas van directo a Groq sin perder segundos esperando a Gemini.
// Si el presupuesto se agota, se devuelve 'unavailable' y el flujo sigue con el plan B.
// Solo se envían esquema, reglas y la pregunta: nunca filas, resultados ni datos de usuarios.
// Las llaves solo existen en el servidor (GEMINI_API_KEY, GROQ_API_KEY, sin prefijo NEXT_PUBLIC_).
// El SQL devuelto NO se ejecuta aquí: run.ts lo pasa por validateSql y runAgentQuery.

import type { LlmProvider } from '../types/api';
import { canonicalizeLiterals } from './literals';
import { buildSystemPrompt, buildUserMessage } from './prompt';
import { normalizeQuestion, unaccentLikeLiterals } from './text';

export type LlmDecision =
  | { type: 'sql'; sql: string; answerTemplate: string; followUps: string[] }
  | { type: 'out_of_scope'; reason: string }
  | { type: 'sensitive' }
  | { type: 'help' };

export type LlmOutcome =
  | { status: 'ok'; decision: LlmDecision; provider: LlmProvider }
  | { status: 'unavailable'; reason: string };

export const LLM_BUDGET_MS = 8_000;
const GEMINI_TIMEOUT_MS = 3_500;
const GROQ_TIMEOUT_MS = 4_000;
const GEMINI_COOLDOWN_MS = 60_000;
const MIN_CALL_MS = 600; // con menos tiempo que esto no vale la pena empezar otra llamada
const RETRY_PAUSE_MS = 300;
const MAX_SQL_CHARS = 4_000;
const MAX_REASON_CHARS = 200;
const MAX_OUTPUT_TOKENS = 1_024;

export function isLlmEnabled(): boolean {
  return process.env.AGENT_LLM_ENABLED === 'true';
}

// ------------------------------------------------------------------ Interpretación de la salida

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function parseDecision(text: string): LlmDecision | null {
  const value = extractJson(text);
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  switch (obj.type) {
    case 'sql': {
      if (typeof obj.sql !== 'string') return null;
      const sql = canonicalizeLiterals(unaccentLikeLiterals(obj.sql.trim()));
      if (sql === '' || sql.length > MAX_SQL_CHARS) return null;
      const template = typeof obj.answer_template === 'string' ? obj.answer_template : '';
      // Se limpian en context.ts (followUpQuestions) antes de mostrarse.
      const followUps = Array.isArray(obj.follow_ups)
        ? obj.follow_ups.filter((q): q is string => typeof q === 'string').slice(0, 3)
        : [];
      return { type: 'sql', sql, answerTemplate: template, followUps };
    }
    case 'out_of_scope': {
      const reason = typeof obj.reason === 'string' ? obj.reason : '';
      const clean = reason.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
      return { type: 'out_of_scope', reason: clean.slice(0, MAX_REASON_CHARS) };
    }
    case 'sensitive':
      return { type: 'sensitive' };
    case 'help':
      return { type: 'help' };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ Proveedores

class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

// Saturación o caída del proveedor (429, 5xx, timeout): vale la pena pausarlo un rato.
const isOutage = (error: unknown) =>
  error instanceof ProviderError && (error.retryable || error.message === 'timeout');

// Instante hasta el que Gemini queda en pausa tras una caída (0 = disponible).
let geminiPausedUntil = 0;

export function resetProviderPause(): void {
  geminiPausedUntil = 0;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json: unknown = await response.json().catch(() => undefined);
    return { status: response.status, json, headers: response.headers };
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderError('timeout');
    throw new ProviderError(`error de red (${error instanceof Error ? error.name : 'desconocido'})`);
  } finally {
    clearTimeout(timer);
  }
}

// Solo el código HTTP va al mensaje: el cuerpo del error del proveedor no se registra.
function httpError(status: number): ProviderError {
  return new ProviderError(`HTTP ${status}`, status === 429 || status >= 500);
}

function geminiText(json: unknown): string | null {
  const parts = (json as { candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] } }[] })
    ?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
  return text === '' ? null : text;
}

async function callGemini(question: string, timeoutMs: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!key || !model) throw new ProviderError('sin GEMINI_API_KEY o GEMINI_MODEL');
  const { status, json } = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': key },
    {
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      contents: [{ role: 'user', parts: [{ text: buildUserMessage(question) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    },
    timeoutMs,
  );
  if (status !== 200) throw httpError(status);
  const text = geminiText(json);
  if (text === null) throw new ProviderError('respuesta vacía');
  return text;
}

async function callGroq(question: string, timeoutMs: number): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL;
  if (!key || !model) throw new ProviderError('sin GROQ_API_KEY o GROQ_MODEL');
  const { status, json, headers } = await postJson(
    'https://api.groq.com/openai/v1/chat/completions',
    { Authorization: `Bearer ${key}` },
    {
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserMessage(question) },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      reasoning_effort: 'low',
    },
    timeoutMs,
  );
  // Cuota restante del plan gratuito (8.000 TPM): útil para vigilarla antes de la demo.
  const left = headers.get('x-ratelimit-remaining-tokens');
  if (left !== null) {
    console.info(`[agent] groq: tokens restantes ${left}, solicitudes restantes ${headers.get('x-ratelimit-remaining-requests') ?? '?'}`);
  }
  if (status !== 200) throw httpError(status);
  const text = (json as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text === '') throw new ProviderError('respuesta vacía');
  return text;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ Caché de decisiones (RNF-01)
// Guarda pregunta → SQL y plantilla, no resultados: los datos se consultan siempre en vivo.
// Solo entran decisiones que ya se ejecutaron bien (rememberDecision desde run.ts).

interface CacheEntry {
  decision: Extract<LlmDecision, { type: 'sql' }>;
  provider: LlmProvider;
  at: number;
}

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, CacheEntry>();

// Misma normalización que la pregunta que recibe el LLM (buildUserMessage).
const cacheKey = (question: string) => normalizeQuestion(question);

function cachedOutcome(question: string): LlmOutcome | null {
  const key = cacheKey(question);
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return { status: 'ok', decision: hit.decision, provider: hit.provider };
}

export function rememberDecision(question: string, decision: LlmDecision, provider: LlmProvider): void {
  if (decision.type !== 'sql') return;
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(cacheKey(question), { decision, provider, at: Date.now() });
}

export function forgetDecision(question: string): void {
  cache.delete(cacheKey(question));
}

export function clearDecisionCache(): void {
  cache.clear();
}

// ------------------------------------------------------------------ Punto de entrada

export async function generateSqlWithLlm(question: string): Promise<LlmOutcome> {
  if (!isLlmEnabled()) return { status: 'unavailable', reason: 'AGENT_LLM_ENABLED no está activo' };

  const cached = cachedOutcome(question);
  if (cached) return cached;

  const deadline = Date.now() + LLM_BUDGET_MS;
  const remaining = () => deadline - Date.now();
  const failures: string[] = [];

  let outage = false;

  // reserveMs: tiempo del presupuesto que este proveedor no puede usar (se guarda para el siguiente).
  async function attempt(
    provider: LlmProvider,
    call: (question: string, timeoutMs: number) => Promise<string>,
    capMs: number,
    canRetry: boolean,
    reserveMs = 0,
  ): Promise<LlmOutcome | null> {
    outage = false;
    for (let tries = 0; tries < (canRetry ? 2 : 1); tries++) {
      const timeoutMs = Math.min(capMs, remaining() - reserveMs);
      if (timeoutMs < MIN_CALL_MS) {
        failures.push(`${provider}: sin tiempo en el presupuesto`);
        return null;
      }
      try {
        const text = await call(question, timeoutMs);
        const decision = parseDecision(text);
        if (decision) return { status: 'ok', decision, provider };
        failures.push(`${provider}: JSON inválido`);
        return null;
      } catch (error) {
        const retryable = error instanceof ProviderError && error.retryable;
        outage = isOutage(error);
        failures.push(`${provider}: ${error instanceof Error ? error.message : 'error'}`);
        if (!retryable || tries === 1) return null;
        await sleep(Math.min(RETRY_PAUSE_MS, Math.max(0, remaining() - MIN_CALL_MS)));
      }
    }
    return null;
  }

  if (Date.now() < geminiPausedUntil) {
    failures.push('gemini: en pausa por una caída reciente');
  } else {
    const fromGemini = await attempt('gemini', callGemini, GEMINI_TIMEOUT_MS, true, GROQ_TIMEOUT_MS);
    if (fromGemini) return fromGemini;
    if (outage) {
      geminiPausedUntil = Date.now() + GEMINI_COOLDOWN_MS;
      console.warn('[agent] Gemini no responde; se pausa 60 s y las preguntas van directo a Groq.');
    }
  }
  const fromGroq = await attempt('groq', callGroq, GROQ_TIMEOUT_MS, false);
  if (fromGroq) return fromGroq;
  return { status: 'unavailable', reason: failures.join('; ') };
}
