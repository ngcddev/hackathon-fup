import 'server-only';
import { buildAlerts } from '@/lib/alerts';
import { ApiError } from '@/lib/api/errors';
import type { AuthUser } from '@/lib/auth/with-auth';
import { runAgentQuery } from '@/lib/db';
import { getDrugRiskRows } from '@/lib/queries/kpis/critical-drugs';
import { getEmergencyWaitData } from '@/lib/queries/kpis/emergency-wait';
import { getOccupancySnapshot } from '@/lib/queries/kpis/occupancy';
import type { AlertSuggestionResponse, KpiAlert } from '@/lib/types/api';
import { contextQueriesFor } from './alert-context';
import {
  buildSuggestionMessage,
  fallbackSuggestion,
  llmSuggestion,
  parseSuggestion,
  SUGGESTION_SYSTEM,
} from './alert-suggestion';
import { completeJsonWithLlm } from './llm';
import { logQuery } from './query-log';
import { validateSql } from './validator';

// ------------------------------------------------------------------ Alertas activas
// Las mismas que el módulo Alertas (mismas consultas fijas y buildAlerts). Se recalculan en el
// servidor en vez de recibirlas del cliente, para que al LLM solo llegue texto generado aquí.
// Caché de 60 s compartida por todas las peticiones (y en vuelo: dos pedidos simultáneos esperan
// la misma consulta).

const ALERTS_TTL_MS = 60_000;
let alertsCache: { at: number; promise: Promise<KpiAlert[]> } | undefined;

async function loadAlerts(): Promise<KpiAlert[]> {
  const [snapshot, drugRows, waitData] = await Promise.all([
    getOccupancySnapshot(),
    getDrugRiskRows(),
    getEmergencyWaitData(),
  ]);
  return buildAlerts(snapshot.rows, drugRows, waitData.card, waitData.by_shift);
}

export function getActiveAlerts(): Promise<KpiAlert[]> {
  if (!alertsCache || Date.now() - alertsCache.at > ALERTS_TTL_MS) {
    const promise = loadAlerts();
    alertsCache = { at: Date.now(), promise };
    // Si falla, no se guarda: la siguiente petición lo vuelve a intentar.
    promise.catch(() => {
      if (alertsCache?.promise === promise) alertsCache = undefined;
    });
  }
  return alertsCache.promise;
}

// ------------------------------------------------------------------ Sugerencias
// Una por alerta y mensaje (si cambian las cifras, cambia la clave) durante 10 minutos: varios
// usuarios mirando la misma alerta no gastan cuota del LLM.

const SUGGESTION_TTL_MS = 10 * 60_000;
const SUGGESTION_MAX_ENTRIES = 100;
const suggestions = new Map<string, { at: number; value: AlertSuggestionResponse }>();

const keyOf = (alert: KpiAlert) => `${alert.id}|${alert.message}`;

function cached(alert: KpiAlert): AlertSuggestionResponse | null {
  const hit = suggestions.get(keyOf(alert));
  if (!hit || Date.now() - hit.at > SUGGESTION_TTL_MS) return null;
  return hit.value;
}

function remember(alert: KpiAlert, value: AlertSuggestionResponse): void {
  if (suggestions.size >= SUGGESTION_MAX_ENTRIES) suggestions.delete(suggestions.keys().next().value as string);
  suggestions.set(keyOf(alert), { at: Date.now(), value });
}

// Datos de contexto de la alerta (subservicios con camas libres, consumo por área, espera por turno…).
// Cada consulta pasa por el validador y se ejecuta con agent_ro; si una falla, se omite.
async function gatherFacts(alert: KpiAlert): Promise<string[]> {
  const results = await Promise.all(
    contextQueriesFor(alert).map(async (query) => {
      try {
        const validation = await validateSql(query.sql);
        if (!validation.ok) {
          console.error(`[alertas] El contexto "${query.id}" no pasó el validador: ${validation.reason}`);
          return [];
        }
        return query.facts((await runAgentQuery(validation.sql)).rows);
      } catch (error) {
        const code = (error as { cause?: { code?: string } }).cause?.code;
        console.warn(`[alertas] El contexto "${query.id}" falló (${code ?? 'sin código'}); se omite.`);
        return [];
      }
    }),
  );
  return results.flat();
}

export async function suggestForAlert(alertId: string, user: AuthUser): Promise<AlertSuggestionResponse> {
  const started = performance.now();
  const alert = (await getActiveAlerts()).find((a) => a.id === alertId);
  if (!alert) {
    throw new ApiError(
      'NOT_FOUND',
      'La alerta ya no está activa. Actualice el módulo de alertas para ver las vigentes.',
    );
  }

  const hit = cached(alert);
  if (hit) return hit;

  const facts = await gatherFacts(alert);
  const llm = await completeJsonWithLlm(SUGGESTION_SYSTEM, buildSuggestionMessage(alert, facts), (raw) =>
    parseSuggestion(raw, alert, facts),
  );
  const response =
    llm.status === 'ok' ? llmSuggestion(alert, llm.value, llm.provider, facts) : fallbackSuggestion(alert, facts);
  // Solo se guarda lo de la IA: si el LLM estaba caído, la próxima vez se vuelve a intentar.
  if (llm.status === 'ok') remember(alert, response);

  // SEG-06: queda en la auditoría del agente, sin filas (la alerta ya es un dato agregado).
  await logQuery({
    userId: user.id,
    question: `Sugerencia para la alerta: ${alert.title}`.slice(0, 500),
    generatedSql: null,
    origin: response.origin,
    llmProvider: response.llm_provider,
    status: 'ok',
    errorMessage: llm.status === 'ok' ? null : `LLM no disponible: ${llm.reason}`.slice(0, 300),
    rowCount: response.steps.length,
    durationMs: Math.round(performance.now() - started),
  });
  return response;
}
