'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useOnline } from '@/components/app/KpisProvider';
import { Icon, type IconName } from '@/components/ui/Icon';
import { fmtInt } from '@/components/ui/format';
import { ClientApiError, apiPost, errorMessage } from '@/lib/api/client';
import type { AgentView, QueryCell, QueryRequest, QueryResponse } from '@/lib/types/api';
import { SUGGESTED_QUESTIONS } from './SummaryView';

interface Message {
  id: number;
  question: string;
  state: 'loading' | 'ok' | 'error';
  result?: QueryResponse;
  errorTitle?: string;
  errorText?: string;
}

const ERROR_TITLE: Partial<Record<string, string>> = {
  SENSITIVE_DATA_REQUESTED: 'No podemos responder esa pregunta',
  OUT_OF_SCOPE: 'No tengo datos para responder eso',
  AGENT_UNAVAILABLE: 'El asistente no está disponible',
  NETWORK: 'El agente requiere conexión',
  VALIDATION_ERROR: 'La pregunta no es válida',
};

// Módulo del sistema donde se ven con más detalle los datos de cada vista del agente.
interface Module {
  href: string;
  label: string;
  icon: IconName;
}

const MODULE_OF_VIEW: Record<AgentView, Module> = {
  v_bed_occupancy: { href: '/beds', label: 'Camas', icon: 'beds' },
  v_admissions: { href: '/patients', label: 'Pacientes e ingresos', icon: 'patients' },
  v_emergency_wait_times: { href: '/patients', label: 'Pacientes e ingresos', icon: 'patients' },
  v_diagnosis_monthly: { href: '/patients', label: 'Pacientes e ingresos', icon: 'patients' },
  v_drug_inventory: { href: '/drugs', label: 'Medicamentos', icon: 'drugs' },
  v_drug_consumption_daily: { href: '/drugs', label: 'Medicamentos', icon: 'drugs' },
  v_surgeries: { href: '/surgeries', label: 'Cirugías', icon: 'surgeries' },
  v_service_demand_daily: { href: '/', label: 'Resumen', icon: 'summary' },
};

// Un enlace por módulo aunque varias vistas lleven al mismo.
function relatedModules(views: AgentView[]): Module[] {
  const byHref = new Map<string, Module>();
  for (const view of views) {
    const target = MODULE_OF_VIEW[view];
    if (target && !byHref.has(target.href)) byHref.set(target.href, target);
  }
  return [...byHref.values()];
}

function formatCell(cell: QueryCell): string {
  if (cell === null) return '—';
  if (typeof cell === 'number') return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(cell);
  if (typeof cell === 'boolean') return cell ? 'Sí' : 'No';
  return cell;
}

const ORIGIN_LABEL = (r: QueryResponse) =>
  r.origin === 'predefined'
    ? 'Respuesta predefinida'
    : `IA${r.llm_provider ? ` (${r.llm_provider === 'gemini' ? 'Gemini' : 'Groq'})` : ''}`;

interface AgentChatViewProps {
  initialQuestion: string;
  autoSend: boolean;
  requestId: string;
}

export function AgentChatView({ initialQuestion, autoSend, requestId }: AgentChatViewProps) {
  const online = useOnline();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const handled = useRef('');

  const ask = async (raw: string) => {
    const question = raw.trim();
    if (!question) return;
    const id = nextId.current++;
    setDraft('');
    setMessages((m) => [...m, { id, question, state: 'loading' }]);
    const patch = (p: Partial<Message>) => setMessages((m) => m.map((x) => (x.id === id ? { ...x, ...p } : x)));
    try {
      const result = await apiPost<QueryResponse>('/api/query', { question } satisfies QueryRequest);
      patch({ state: 'ok', result });
    } catch (e) {
      const code = e instanceof ClientApiError ? e.code : 'INTERNAL_ERROR';
      patch({
        state: 'error',
        errorTitle: ERROR_TITLE[code] ?? 'No pudimos responder esa pregunta',
        errorText: errorMessage(e),
      });
    }
  };

  // Llegada desde el resumen o el encabezado: con `send=1` se envía sola; si no, queda escrita en la caja.
  useEffect(() => {
    if (!initialQuestion || handled.current === requestId) return;
    handled.current = requestId;
    if (autoSend) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void ask(initialQuestion);
    } else {
      setDraft(initialQuestion);
      setTimeout(() => input.current?.focus(), 50);
    }
  }, [initialQuestion, autoSend, requestId]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (online) void ask(draft);
  };

  const jumpTo = (id: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`#msg-${id}`);
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - 16;
  };

  return (
    <div className="flex min-h-[calc(100vh-190px)] flex-wrap items-stretch gap-5">
      <aside className="flex min-w-0 flex-[1_1_100%] flex-col sm:min-w-[220px] sm:flex-[0_1_260px] gap-2.5 rounded-2xl border border-line bg-white p-4 shadow-card">
        <button
          type="button"
          onClick={() => {
            setMessages([]);
            setDraft('');
          }}
          className="h-11 cursor-pointer rounded-lg border-[1.5px] border-navy bg-white text-[15px] font-bold"
        >
          + Nueva conversación
        </button>
        <div className="px-1 pt-2 text-[13px] font-bold uppercase tracking-[0.05em] text-muted">Historial</div>
        {messages.length === 0 && (
          <div className="p-1 text-sm text-muted">Sus preguntas de esta sesión aparecerán aquí.</div>
        )}
        {[...messages].reverse().map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => jumpTo(m.id)}
            className="cursor-pointer rounded-lg border-0 bg-transparent px-3 py-2.5 text-left text-sm leading-snug hover:bg-slate-100"
          >
            {m.question}
          </button>
        ))}
      </aside>

      <section className="flex max-h-[calc(100vh-190px)] min-h-[420px] min-w-0 flex-[1_1_560px] sm:min-h-[560px] flex-col rounded-2xl border border-line bg-white shadow-card">
        <div ref={scroller} className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 && (
            <div className="m-auto flex max-w-[560px] flex-col items-center gap-2.5 py-10 text-center">
              <Icon name="agent" size={40} strokeWidth={1.5} className="text-navy" />
              <div className="text-[26px] font-extrabold">¿Qué quiere saber hoy?</div>
              <div className="text-base leading-normal text-muted">
                Pregunte en lenguaje natural. El agente consulta los datos del hospital y le muestra la respuesta con su
                tabla y un acceso al módulo relacionado.
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} id={`msg-${m.id}`} className="flex flex-col gap-3.5">
              <div className="max-w-[80%] self-end rounded-2xl rounded-br-[4px] bg-navy px-[18px] py-3 text-[17px] leading-normal text-white">
                {m.question}
              </div>

              {m.state === 'loading' && (
                <div aria-busy="true" className="flex max-w-[760px] flex-col gap-2.5">
                  <div className="sgh-pulse h-[18px] w-[70%] rounded-md bg-mist" />
                  <div className="sgh-pulse h-[18px] w-[52%] rounded-md bg-mist" />
                  <div className="sgh-pulse h-[140px] rounded-[10px] bg-slate-100" />
                  <div className="text-sm text-muted">Consultando las vistas del sistema…</div>
                </div>
              )}

              {m.state === 'error' && (
                <div
                  role="alert"
                  className="flex max-w-[760px] flex-col gap-1.5 rounded-xl border border-line bg-canvas px-[18px] py-4"
                >
                  <div className="text-[17px] font-bold">{m.errorTitle}</div>
                  <div className="text-[15px] leading-normal text-slate-700">{m.errorText}</div>
                </div>
              )}

              {m.state === 'ok' && m.result && (
                <Answer result={m.result} onAsk={online ? (q) => void ask(q) : undefined} />
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={!online}
                onClick={() => void ask(q)}
                className="cursor-pointer rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-left text-sm font-medium leading-snug hover:border-leaf disabled:cursor-default disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
          {!online && (
            <div
              role="status"
              className="rounded-lg border border-line bg-slate-100 px-3.5 py-2.5 text-[15px] font-semibold"
            >
              El agente requiere conexión. Vuelva a intentarlo cuando se restablezca la red.
            </div>
          )}
          <form onSubmit={submit} className="flex gap-2.5">
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!online}
              maxLength={500}
              placeholder={online ? 'Escriba su pregunta…' : 'Sin conexión'}
              aria-label="Pregunta"
              className="h-[54px] min-w-0 flex-1 rounded-xl border-[1.5px] border-slate-300 bg-white px-[18px] text-[17px] outline-none focus:border-leaf disabled:bg-slate-100"
            />
            <button
              type="submit"
              disabled={!online}
              className="h-[54px] cursor-pointer rounded-xl border-0 bg-leaf px-6 text-base font-bold text-white disabled:cursor-default disabled:opacity-40"
            >
              Enviar
            </button>
          </form>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Icon name="shield" size={16} />
            El agente solo lee datos anonimizados; nunca muestra información identificable de pacientes.
          </div>
        </div>
      </section>
    </div>
  );
}

function Answer({ result, onAsk }: { result: QueryResponse; onAsk?: (question: string) => void }) {
  const modules = relatedModules(result.views_used);
  return (
    <div className="flex max-w-full flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {result.includes_simulated_data && (
          <span className="rounded-full border border-dashed border-slate-500 px-2.5 py-0.5 text-[13px] font-bold text-muted">
            Incluye datos simulados
          </span>
        )}
      </div>
      <p className="m-0 max-w-[860px] text-lg leading-relaxed">{result.answer}</p>

      {result.highlights.length > 0 && (
        <div className="max-w-[860px] rounded-xl border border-line bg-canvas px-[18px] py-3.5">
          <div className="mb-1.5 text-[13px] font-bold uppercase tracking-[0.05em] text-muted">Datos destacados</div>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-base leading-relaxed">
            {result.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      {result.columns.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full border-collapse text-[15px]">
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <th
                      key={c}
                      className="sticky top-0 whitespace-nowrap border-b border-line bg-slate-100 px-3.5 py-2.5 text-left text-[13px] font-bold uppercase tracking-[0.05em] text-muted"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-t border-mist">
                    {row.map((cell, j) => (
                      <td key={j} className="whitespace-nowrap px-3.5 py-[9px]">
                        {formatCell(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-between gap-3 border-t border-line bg-canvas px-3.5 py-2.5 text-sm">
            <span className="font-bold">{fmtInt(result.row_count)} filas</span>
            {result.truncated && <span className="font-semibold text-slate-700">Resultado truncado en 200 filas</span>}
          </div>
        </div>
      )}

      {result.notes.length > 0 && (
        <div className="flex max-w-[860px] flex-col gap-1 text-[15px] leading-normal text-slate-700">
          <div className="text-[13px] font-bold uppercase tracking-[0.05em] text-muted">Para tener en cuenta</div>
          {result.notes.map((n) => (
            <div key={n} className="flex gap-2">
              <Icon name="info" size={16} className="mt-[3px] shrink-0 text-muted" />
              <span>{n}</span>
            </div>
          ))}
        </div>
      )}

      {modules.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold uppercase tracking-[0.05em] text-muted">Ver en el módulo</span>
          {modules.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="inline-flex items-center gap-2 rounded-xl border-[1.5px] border-navy bg-white px-3.5 py-2 text-sm font-bold text-navy no-underline hover:bg-slate-100"
            >
              <Icon name={m.icon} size={16} />
              {m.label}
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}

      {result.follow_up_questions.length > 0 && onAsk && (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-bold uppercase tracking-[0.05em] text-muted">Preguntas relacionadas</div>
          <div className="flex flex-wrap gap-2">
            {result.follow_up_questions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onAsk(q)}
                className="cursor-pointer rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-left text-sm font-medium leading-snug hover:border-leaf"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted">
        <span>
          Origen: <strong>{ORIGIN_LABEL(result)}</strong>
        </span>
        {result.views_used.length > 0 && (
          <span>
            Vistas: <span className="font-mono">{result.views_used.join(', ')}</span>
          </span>
        )}
        <span>Duración: {fmtInt(result.duration_ms)} ms</span>
        <span>Fecha de referencia: {result.reference_date.split('-').reverse().join('/')}</span>
      </div>
    </div>
  );
}
