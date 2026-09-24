import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDecisionCache, generateSqlWithLlm, resetProviderPause } from './llm';

const SQL_JSON = JSON.stringify({
  type: 'sql',
  sql: 'SELECT 1 AS n FROM agent.v_admissions LIMIT 1',
  answer_template: 'Hay {n}',
});

function mockProviders(geminiStatus: number) {
  const calls = { gemini: 0, groq: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('generativelanguage')) {
        calls.gemini++;
        return new Response(JSON.stringify({ error: {} }), { status: geminiStatus });
      }
      calls.groq++;
      return new Response(JSON.stringify({ choices: [{ message: { content: SQL_JSON } }] }), { status: 200 });
    }),
  );
  return calls;
}

describe('cadena de proveedores con Gemini caído', () => {
  beforeEach(() => {
    vi.stubEnv('AGENT_LLM_ENABLED', 'true');
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubEnv('GEMINI_MODEL', 'm');
    vi.stubEnv('GROQ_API_KEY', 'k');
    vi.stubEnv('GROQ_MODEL', 'm');
    clearDecisionCache();
    resetProviderPause();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('con 503 responde Groq y luego pausa Gemini', async () => {
    const calls = mockProviders(503);
    const first = await generateSqlWithLlm('pregunta uno');
    expect(first).toMatchObject({ status: 'ok', provider: 'groq' });
    expect(calls).toEqual({ gemini: 2, groq: 1 });

    const second = await generateSqlWithLlm('pregunta dos');
    expect(second).toMatchObject({ status: 'ok', provider: 'groq' });
    expect(calls).toEqual({ gemini: 2, groq: 2 }); // Gemini en pausa: no se llamó otra vez
  });

  it('un error no transitorio (400) no pausa Gemini', async () => {
    const calls = mockProviders(400);
    await generateSqlWithLlm('pregunta uno');
    await generateSqlWithLlm('pregunta dos');
    expect(calls.gemini).toBe(2);
  });

  it('Gemini en pausa y Groq sin cuota: se le da una última oportunidad a Gemini', async () => {
    const calls = { gemini: 0, groq: 0 };
    let geminiUp = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('generativelanguage')) {
          calls.gemini++;
          return geminiUp
            ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: SQL_JSON }] } }] }), {
                status: 200,
              })
            : new Response('{}', { status: 503 });
        }
        calls.groq++;
        return new Response('{}', { status: 429 });
      }),
    );
    await generateSqlWithLlm('primera'); // Gemini cae y queda en pausa; Groq sin cuota
    geminiUp = true;
    const r = await generateSqlWithLlm('segunda');
    expect(r).toMatchObject({ status: 'ok', provider: 'gemini' });
  });

  it('Groq sin cuota usa el modelo de respaldo si está configurado', async () => {
    vi.stubEnv('GROQ_FALLBACK_MODEL', 'respaldo');
    const models: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        if (url.includes('generativelanguage')) return new Response('{}', { status: 400 });
        const { model } = JSON.parse(init.body) as { model: string };
        models.push(model);
        return model === 'respaldo'
          ? new Response(JSON.stringify({ choices: [{ message: { content: SQL_JSON } }] }), { status: 200 })
          : new Response('{}', { status: 429 });
      }),
    );
    const r = await generateSqlWithLlm('pregunta');
    expect(r).toMatchObject({ status: 'ok', provider: 'groq' });
    expect(models).toEqual(['m', 'respaldo']);
  });
});
