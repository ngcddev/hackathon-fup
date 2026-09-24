'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useOnline } from '@/components/app/KpisProvider';
import { Icon } from '@/components/ui/Icon';
import { fmtInt } from '@/components/ui/format';
import { ClientApiError, apiPost, errorMessage } from '@/lib/api/client';
import type { QueryCell, QueryRequest, QueryResponse } from '@/lib/types/api';
import { SUGGESTED_QUESTIONS } from './ResumenView';

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
  OUT_OF_SCOPE: 'La pregunta está fuera del alcance de los datos',
  AGENT_UNAVAILABLE: 'El asistente no está disponible',
  NETWORK: 'El agente requiere conexión',
  VALIDATION_ERROR: 'La pregunta no es válida',
};

function formatCell(cell: QueryCell): string {
  if (cell === null) return '—';
  if (typeof cell === 'number') return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(cell);
  if (typeof cell === 'boolean') return cell ? 'Sí' : 'No';
  return cell;
}

const ORIGIN_LABEL = (r: QueryResponse) =>
  r.origin === 'predefined' ? 'Respuesta predefinida' : `IA${r.llm_provider ? ` (${r.llm_provider === 'gemini' ? 'Gemini' : 'Groq'})` : ''}`;

interface AgenteViewProps {
  initialQuestion: string;
  autoSend: boolean;
  requestId: string;
}

export function AgenteView({ initialQuestion, autoSend, requestId }: AgenteViewProps) {
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
      patch({ state: 'error', errorTitle: ERROR_TITLE[code] ?? 'No pudimos responder esa pregunta', errorText: errorMessage(e) });
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
        {messages.length === 0 && <div className="p-1 text-sm text-muted">Sus preguntas de esta sesión aparecerán aquí.</div>}
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
              <Icon name="agente" size={40} strokeWidth={1.5} className="text-navy" />
              <div className="text-[26px] font-extrabold">¿Qué quiere saber hoy?</div>
              <div className="text-base leading-normal text-muted">
                Pregunte en lenguaje natural. El agente consulta las vistas del sistema y le muestra la tabla y la consulta SQL que usó.
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} id={`msg-${m.id}`} className="flex flex-col gap-3.5">
              <div className="max-w-[80%] self-end rounded-2xl rounded-br-[4px] bg-navy px-[18px] py-3 text-[17px] leading-normal text-white">{m.question}</div>

              {m.state === 'loading' && (
                <div aria-busy="true" className="flex max-w-[760px] flex-col gap-2.5">
                  <div className="sgh-pulse h-[18px] w-[70%] rounded-md bg-mist" />
                  <div className="sgh-pulse h-[18px] w-[52%] rounded-md bg-mist" />
                  <div className="sgh-pulse h-[140px] rounded-[10px] bg-slate-100" />
                  <div className="text-sm text-muted">Consultando las vistas del sistema…</div>
                </div>
              )}

              {m.state === 'error' && (
                <div role="alert" className="flex max-w-[760px] flex-col gap-1.5 rounded-xl border border-line bg-canvas px-[18px] py-4">
                  <div className="text-[17px] font-bold">{m.errorTitle}</div>
                  <div className="text-[15px] leading-normal text-slate-700">{m.errorText}</div>
                </div>
              )}

              {m.state === 'ok' && m.result && <Answer result={m.result} />}
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
            <div role="status" className="rounded-lg border border-line bg-slate-100 px-3.5 py-2.5 text-[15px] font-semibold">
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

function Answer({ result }: { result: QueryResponse }) {
  return (
    <div className="flex max-w-full flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {result.includes_simulated_data && (
          <span className="rounded-full border border-dashed border-slate-500 px-2.5 py-0.5 text-[13px] font-bold text-muted">Incluye datos simulados</span>
        )}
      </div>
      <p className="m-0 max-w-[860px] text-lg leading-relaxed">{result.answer}</p>

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

      <details className="rounded-xl border border-line bg-white">
        <summary className="cursor-pointer px-4 py-3 text-[15px] font-bold">Ver SQL generado</summary>
        <pre className="m-0 select-text overflow-x-auto whitespace-pre-wrap border-t border-line bg-canvas px-4 py-3.5 font-mono text-sm leading-relaxed">{result.sql}</pre>
      </details>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted">
        <span>
          Origen: <strong>{ORIGIN_LABEL(result)}</strong>
        </span>
        <span>
          Vistas: <span className="font-mono">{result.views_used.join(', ')}</span>
        </span>
        <span>Duración: {fmtInt(result.duration_ms)} ms</span>
        <span>Fecha de referencia: {result.reference_date.split('-').reverse().join('/')}</span>
      </div>
    </div>
  );
}
