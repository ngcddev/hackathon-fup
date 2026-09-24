// Verifica POST /api/query (plan B) contra el servidor local y supabase/tests/expected_values.md.
//
// Uso (con `npm run dev` corriendo en otra terminal):
//   QUERY_CHECK_EMAIL=admin@... QUERY_CHECK_PASSWORD=... npx tsx scripts/query-check.ts
// Variables (además de las de .env.local):
//   QUERY_CHECK_BASE_URL   por defecto http://localhost:3000
//   QUERY_CHECK_EMAIL / QUERY_CHECK_PASSWORD   cuenta admin; se inicia sesión con Supabase Auth
//   QUERY_CHECK_COOKIE     alternativa: cabecera Cookie ya armada de una sesión abierta
// La prueba 6 (sin sesión → 401) exige que el servidor NO tenga AUTH_STUB=true.

import { spawnSync } from 'node:child_process';
import { createServerClient } from '@supabase/ssr';

try {
  process.loadEnvFile('.env.local');
} catch {
  // sin .env.local: se usan las variables del entorno
}

const BASE = process.env.QUERY_CHECK_BASE_URL ?? 'http://localhost:3000';

interface Reply {
  status: number;
  body: Record<string, unknown>;
  ms: number;
  raw: string;
}

async function loginCookie(): Promise<string> {
  if (process.env.QUERY_CHECK_COOKIE) return process.env.QUERY_CHECK_COOKIE;
  const email = process.env.QUERY_CHECK_EMAIL;
  const password = process.env.QUERY_CHECK_PASSWORD;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!email || !password || !url || !key) return '';
  const jar = new Map<string, string>();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`No se pudo iniciar sesión: ${error.message}`);
  return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
}

async function ask(question: string, cookie: string): Promise<Reply> {
  const started = performance.now();
  const response = await fetch(`${BASE}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ question }),
  });
  const raw = await response.text();
  const ms = Math.round(performance.now() - started);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // respuesta no JSON: queda el texto en raw
  }
  return { status: response.status, body, ms, raw };
}

let failures = 0;
const report = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK   ' : 'FALLO'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

type Rows = unknown[][];
const rowsOf = (b: Record<string, unknown>): Rows => (b.rows as Rows) ?? [];

// Valores de supabase/tests/expected_values.md §2.
interface DemoCase {
  name: string;
  questions: string[];
  verify: (body: Record<string, unknown>) => string | null;
}

const DEMO: DemoCase[] = [
  {
    name: 'P1 UCI ocupadas hoy (30 de 46, 65,2 %)',
    questions: [
      '¿Cuántas camas de UCI están ocupadas hoy?',
      'camas uci ocupadas',
      'ocupación de la unidad de cuidados intensivos',
    ],
    verify: (b) => {
      const total = rowsOf(b).find((r) => r[0] === 'TOTAL UCI');
      const answer = String(b.answer);
      if (!total || total[1] !== 30 || total[2] !== 46 || total[3] !== 65.2) return `total=${JSON.stringify(total)}`;
      return answer.startsWith('Hay 30 de 46 camas UCI ocupadas (65,2 %)') ? null : `answer=${answer}`;
    },
  },
  {
    name: 'P2 medicamentos con menos de 5 días (10, simulados)',
    questions: [
      '¿Cuáles son los medicamentos con menos de 5 días de inventario?',
      'medicamentos críticos',
      'medicinas con menos de cinco dias de stock',
    ],
    verify: (b) => {
      if (b.row_count !== 10) return `row_count=${String(b.row_count)}`;
      if (b.includes_simulated_data !== true) return 'includes_simulated_data no es true';
      const first = rowsOf(b)[0];
      if (!String(first?.[0]).startsWith('LOSARTAN 50 mg') || first?.[3] !== 1.4)
        return `primero=${JSON.stringify(first)}`;
      return null;
    },
  },
  {
    name: 'P3 espera en urgencias última semana (62,1 min, 796 ingresos)',
    questions: [
      '¿Cuál es el tiempo de espera promedio en urgencias en la última semana?',
      '¿cuánto se demoran en urgencias esta semana?',
      'espera promedio urgencias ultima semana',
    ],
    verify: (b) => {
      const total = rowsOf(b).find((r) => r[0] === 'TOTAL');
      if (!total || total[1] !== 796 || total[2] !== 62.1) return `total=${JSON.stringify(total)}`;
      return String(b.answer).startsWith('El tiempo promedio fue de 62,1 minutos')
        ? null
        : `answer=${String(b.answer)}`;
    },
  },
  {
    name: 'P4 servicio con más pacientes este mes (Pediatría 405)',
    questions: [
      '¿Qué servicio tiene más pacientes ingresados este mes?',
      'servicio con más ingresos este mes',
      'que servicio recibe mas pacientes',
    ],
    verify: (b) => {
      const counts = rowsOf(b).map((r) => r[1]);
      if (JSON.stringify(counts) !== JSON.stringify([405, 394, 235, 153, 95]))
        return `pacientes=${JSON.stringify(counts)}`;
      return String(rowsOf(b)[0]?.[0]) === 'PEDIATRIA' ? null : `primero=${String(rowsOf(b)[0]?.[0])}`;
    },
  },
];

async function main() {
  const cookie = await loginCookie();
  if (!cookie) console.log('(sin credenciales: se asume AUTH_STUB=true en el servidor; la prueba 6 fallará)');
  const everything: string[] = [];

  // 1 y 2. Las 4 de la demo, textual y con 2 variantes cada una.
  for (const demo of DEMO) {
    for (const [i, question] of demo.questions.entries()) {
      const label = `${demo.name} · ${i === 0 ? 'textual' : `variante ${i}`}`;
      const reply = await ask(question, cookie);
      everything.push(reply.raw);
      const problem =
        reply.status !== 200
          ? `HTTP ${reply.status}: ${reply.raw.slice(0, 160)}`
          : reply.body.origin !== 'predefined'
            ? `origin=${String(reply.body.origin)}`
            : demo.verify(reply.body);
      report(`1. ${label}`, problem === null, problem ?? `"${question}"`);
      report(`2. Tarda menos de 10 s: ${label}`, reply.ms < 10_000, `${reply.ms} ms`);
    }
  }

  // 3. Pregunta sensible (D3 de la demo).
  const sensitive = await ask('¿Cómo se llama el paciente con cédula 1061234567?', cookie);
  everything.push(sensitive.raw);
  report(
    '3. Pregunta sobre una persona → 422 SENSITIVE_DATA_REQUESTED',
    sensitive.status === 422 &&
      (sensitive.body.error as { code?: string } | undefined)?.code === 'SENSITIVE_DATA_REQUESTED',
    `HTTP ${sensitive.status}`,
  );

  // 4. Sin coincidencia en el plan B.
  const unmatched = await ask('¿Cuál es la capital de Francia?', cookie);
  everything.push(unmatched.raw);
  report(
    '4. Sin coincidencia → 503 AGENT_UNAVAILABLE',
    unmatched.status === 503 && (unmatched.body.error as { code?: string } | undefined)?.code === 'AGENT_UNAVAILABLE',
    `HTTP ${unmatched.status}`,
  );

  // 5. Ninguna respuesta contiene patient_key. (El SQL de P4 usa COUNT(DISTINCT patient_key) y eso es
  // legítimo: se revisan columnas y filas, no el texto del SQL.)
  const leaks = everything.filter((raw) => {
    try {
      const body = JSON.parse(raw) as { columns?: string[]; rows?: unknown[][]; answer?: string };
      return (
        (body.columns ?? []).some((c) => /patient_key/i.test(c)) ||
        /patient_key/i.test(String(body.answer ?? '')) ||
        /patient_key/i.test(JSON.stringify(body.rows ?? []))
      );
    } catch {
      return /patient_key/i.test(raw);
    }
  });
  report('5. Ninguna respuesta contiene patient_key', leaks.length === 0, `${everything.length} respuestas revisadas`);

  // 6. Sin sesión → 401.
  const anonymous = await ask('camas uci ocupadas', '');
  report('6. Sin sesión → 401', anonymous.status === 401, `HTTP ${anonymous.status}`);

  // 7. Pruebas del validador.
  const vitest = spawnSync('npx vitest run', { shell: true, encoding: 'utf8' });
  const summary = (vitest.stdout + vitest.stderr).split('\n').find((l) => /Tests\s/.test(l)) ?? '';
  report(
    '7. npx vitest run pasa todas las pruebas',
    vitest.status === 0,
    summary.replace(/\u001b\[[0-9;]*m/g, '').trim(),
  );

  console.log(failures === 0 ? '\nTODO OK' : `\n${failures} prueba(s) con FALLO`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('FALLO  el script no pudo terminar:', error instanceof Error ? error.message : error);
  process.exit(1);
});
