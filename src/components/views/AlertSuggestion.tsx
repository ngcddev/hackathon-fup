'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { OriginBadge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/components/ui/format';
import { apiPost, errorMessage } from '@/lib/api/client';
import type {
  AlertSuggestionRequest,
  AlertSuggestionResponse,
  AlertType,
  KpiAlert,
  LlmProvider,
} from '@/lib/types/api';

// ------------------------------------------------------------------ Estado por alerta
// Vive en AlertsView: si el usuario cambia de filtro o colapsa la lista, la sugerencia no se pierde.

export type SuggestionState =
  | { status: 'loading'; open: true }
  | { status: 'ready'; open: boolean; data: AlertSuggestionResponse }
  | { status: 'error'; open: true; message: string };

export function useAlertSuggestions() {
  const [byId, setById] = useState<Record<string, SuggestionState>>({});

  const request = useCallback(async (alertId: string) => {
    setById((s) => ({ ...s, [alertId]: { status: 'loading', open: true } }));
    try {
      const data = await apiPost<AlertSuggestionResponse>('/api/alerts/suggestion', {
        alert_id: alertId,
      } satisfies AlertSuggestionRequest);
      setById((s) => ({ ...s, [alertId]: { status: 'ready', open: true, data } }));
    } catch (e) {
      setById((s) => ({ ...s, [alertId]: { status: 'error', open: true, message: errorMessage(e) } }));
    }
  }, []);

  // Primer clic: pide la sugerencia. Después solo muestra u oculta la que ya llegó.
  const toggle = useCallback(
    (alertId: string) => {
      const current = byId[alertId];
      if (!current) return void request(alertId);
      if (current.status === 'ready') {
        setById((s) => ({ ...s, [alertId]: { ...current, open: !current.open } }));
      }
    },
    [byId, request],
  );

  return { get: (alertId: string) => byId[alertId], toggle, retry: request };
}

// ------------------------------------------------------------------ Botón

export function SuggestButton({
  alertId,
  state,
  onClick,
}: {
  alertId: string;
  state: SuggestionState | undefined;
  onClick: () => void;
}) {
  const loading = state?.status === 'loading';
  const label = loading
    ? 'Analizando…'
    : state?.status === 'ready'
      ? state.open
        ? 'Ocultar sugerencia'
        : 'Ver sugerencia de la IA'
      : 'Sugerir solución con IA';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-expanded={Boolean(state?.open)}
      aria-controls={panelId(alertId)}
      className="inline-flex h-11 cursor-pointer items-center gap-2 self-start rounded-xl border-[1.5px] border-navy bg-white px-4 text-[15px] font-bold text-navy hover:bg-slate-100 disabled:cursor-default disabled:opacity-60"
    >
      <Icon name="agent" size={18} />
      {label}
    </button>
  );
}

const panelId = (alertId: string) => `sugerencia-${alertId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

// ------------------------------------------------------------------ Panel

const PROVIDER_LABEL: Record<LlmProvider, string> = { gemini: 'Gemini', groq: 'Groq' };

// Pregunta para seguir en el Agente IA según el tipo de alerta (preguntas que el plan B responde).
const AGENT_QUESTION: Record<AlertType, string> = {
  occupancy: '¿Cuál es la ocupación de camas por servicio hoy?',
  stockout: '¿Cuáles son los medicamentos con menos de 5 días de inventario?',
  emergency_wait: '¿Cuál es la espera promedio en urgencias por nivel de triage este mes?',
  surgery_compliance: '¿Cuál es el cumplimiento quirúrgico por mes?',
};

export function SuggestionPanel({
  alert,
  state,
  onRetry,
}: {
  alert: KpiAlert;
  state: SuggestionState;
  onRetry: () => void;
}) {
  return (
    <section
      id={panelId(alert.id)}
      aria-live="polite"
      aria-busy={state.status === 'loading'}
      aria-label={`Sugerencia para ${alert.title}`}
      className="flex flex-col gap-4 rounded-xl border border-line bg-canvas p-4 sm:col-span-2 sm:p-5"
    >
      {state.status === 'loading' && (
        <div className="flex flex-col gap-2.5">
          <div className="sgh-pulse h-[18px] w-[72%] rounded-md bg-mist" />
          <div className="sgh-pulse h-[18px] w-[58%] rounded-md bg-mist" />
          <div className="sgh-pulse h-[64px] rounded-[10px] bg-slate-100" />
          <div className="text-sm text-muted">La IA está analizando la alerta; puede tardar unos segundos…</div>
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <Icon name="info" size={20} className="shrink-0 text-navy" />
          <div className="min-w-0 flex-1 text-[15px] leading-normal text-slate-700">
            <strong className="block text-navy">No pudimos generar la sugerencia</strong>
            {state.message}
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="h-10 cursor-pointer rounded-lg border-[1.5px] border-navy bg-white px-4 text-[15px] font-bold"
          >
            Reintentar
          </button>
        </div>
      )}

      {state.status === 'ready' && <SuggestionBody alert={alert} data={state.data} />}
    </section>
  );
}

function SuggestionBody({ alert, data }: { alert: KpiAlert; data: AlertSuggestionResponse }) {
  const fromAi = data.origin === 'llm';
  const agentHref = `/agent?q=${encodeURIComponent(AGENT_QUESTION[alert.type])}&send=1&n=${encodeURIComponent(data.generated_at)}`;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <Icon name="agent" size={20} className="text-navy" />
        <h4 className="m-0 text-lg font-extrabold">Plan sugerido</h4>
        {/* Lo generado se marca igual que lo simulado: borde punteado (el usuario sabe de dónde sale). */}
        <OriginBadge
          origin="Derivado"
          label={
            fromAi
              ? `Generado con IA${data.llm_provider ? ` · ${PROVIDER_LABEL[data.llm_provider]}` : ''}`
              : 'Plan predefinido · IA no disponible'
          }
        />
      </div>

      <p className="m-0 text-base leading-relaxed text-slate-800">{data.summary}</p>

      {/* Transparencia: las cifras del hospital en que se apoyan los pasos, para poder verificarlas. */}
      {data.facts.length > 0 && (
        <details className="group rounded-lg border border-line bg-white">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-[15px] font-bold text-navy">
            <Icon name="summary" size={16} />
            Datos en que se basa ({data.facts.length})
            <span aria-hidden className="ml-auto inline-block transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <ul className="m-0 flex list-disc flex-col gap-1 border-t border-line py-3 pl-9 pr-4 text-[15px] leading-normal text-slate-700">
            {data.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </details>
      )}

      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {data.steps.map((step, i) => (
          <li
            key={`${i}-${step.action}`}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-line bg-white p-3.5"
          >
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-sm font-extrabold text-white"
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              {/* El orden ya lo anuncia la lista (<ol>): sin "Paso N" extra para lectores de pantalla. */}
              <div className="text-base font-bold leading-snug">{step.action}</div>
              {step.detail && <div className="text-[15px] leading-normal text-slate-700">{step.detail}</div>}
              <div className="flex flex-wrap gap-2">
                {/* En un plan de la IA, distingue lo que ya recomendaba el tablero de lo que aporta la IA. */}
                {fromAi && step.source === 'system' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-navy bg-white px-2.5 py-0.5 text-[13px] font-bold text-navy">
                    <Icon name="alerts" size={13} strokeWidth={2.2} />
                    Del tablero de alertas
                  </span>
                )}
                <Chip icon="users" label="Responsable" value={step.owner} />
                <Chip icon="clock" label="Cuándo" value={step.timeframe} strong={/ahora/i.test(step.timeframe)} />
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex items-start gap-2 border-t border-line pt-3.5 text-[15px] leading-normal">
        <Icon name="check" size={18} strokeWidth={2.4} className="mt-0.5 shrink-0 text-ok" />
        <span>
          <strong>Cómo saber que funcionó:</strong> {data.monitor}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] leading-normal text-muted">
        <span className="flex max-w-[640px] items-start gap-1.5">
          <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
          {fromAi
            ? 'Sugerencia generada con IA a partir de datos agregados, sin información de pacientes. La decisión final es del equipo asistencial.'
            : 'La IA no respondió a tiempo; se muestra el plan predefinido del hospital para este tipo de alerta.'}
        </span>
        <Link href={agentHref} className="whitespace-nowrap text-[15px] font-bold">
          Analizar con el Agente IA →
        </Link>
      </div>
    </>
  );
}

function Chip({
  icon,
  label,
  value,
  strong = false,
}: {
  icon: 'users' | 'clock';
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold',
        strong ? 'border-danger-line bg-danger-bg text-danger' : 'border-line bg-white text-muted',
      )}
    >
      <Icon name={icon} size={13} strokeWidth={2.2} />
      <span className="sr-only">{label}: </span>
      {value}
    </span>
  );
}
