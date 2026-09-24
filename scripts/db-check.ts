// Verifica la conexión de los tres roles por el pooler de Supabase (modo transaction).
// Uso: npx tsx scripts/db-check.ts   (lee .env.local; también sirve el entorno del proceso)
// No importa src/lib/db (lleva 'server-only'): prueba los roles con pg directo.
import { Client } from 'pg';

try {
  process.loadEnvFile('.env.local');
} catch {
  // sin .env.local: se usan las variables del entorno
}

type Role = 'app_backend' | 'agent_ro' | 'importer';
const ENV_VAR: Record<Role, string> = {
  app_backend: 'DATABASE_URL_APP_BACKEND',
  agent_ro: 'DATABASE_URL_AGENT_RO',
  importer: 'DATABASE_URL_IMPORTER',
};

let failures = 0;
function report(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'OK   ' : 'FALLO'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function connect(role: Role): Promise<Client> {
  const raw = process.env[ENV_VAR[role]];
  if (!raw) throw new Error(`falta ${ENV_VAR[role]}`);
  const url = new URL(raw);
  url.searchParams.delete('sslmode');
  const client = new Client({
    connectionString: url.toString(),
    ssl: ['localhost', '127.0.0.1'].includes(url.hostname) ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return client;
}

// Ejecuta una prueba y la reporta; un error inesperado cuenta como FALLO.
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    report(name, true, (await fn()) || '');
  } catch (e) {
    report(name, false, e instanceof Error ? e.message : String(e));
  }
}

// Verifica que la sentencia falle por permisos o solo lectura, no por otro motivo.
async function expectDenied(client: Client, sql: string): Promise<string> {
  try {
    await client.query(sql);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === '42501' || err.code === '25006') return `rechazada (${err.code})`;
    throw new Error(`falló por otro motivo: ${err.code} ${err.message}`);
  }
  throw new Error('la sentencia se ejecutó y no debía');
}

async function main() {
  const clients: Partial<Record<Role, Client>> = {};

  console.log('1. Conexión por el pooler');
  for (const role of Object.keys(ENV_VAR) as Role[]) {
    await check(`${role} conecta`, async () => {
      const c = await connect(role);
      clients[role] = c;
      const { rows } = await c.query('select current_user as u');
      if (rows[0].u !== role) throw new Error(`current_user = ${rows[0].u}`);
      return `port ${new URL(process.env[ENV_VAR[role]]!).port || '5432'}`;
    });
  }

  const agent = clients.agent_ro;
  console.log('2. agent_ro');
  if (agent) {
    await check('agent.reference_date() = 2026-09-21', async () => {
      const { rows } = await agent.query("select to_char(agent.reference_date(), 'YYYY-MM-DD') as d");
      if (rows[0].d !== '2026-09-21') throw new Error(`devolvió ${rows[0].d}`);
    });
    await check('SHOW transaction_read_only = on', async () => {
      const { rows } = await agent.query('show transaction_read_only');
      if (rows[0].transaction_read_only !== 'on') throw new Error(`devolvió ${rows[0].transaction_read_only}`);
    });
    await check('SELECT sobre core.patients falla', () => expectDenied(agent, 'select 1 from core.patients limit 1'));
    await check('INSERT falla', () =>
      expectDenied(
        agent,
        "insert into audit.query_log (user_id, question, origin, status, duration_ms) values (gen_random_uuid(), 'x', 'llm', 'ok', 0)",
      ),
    );
  } else {
    for (const n of ['reference_date', 'transaction_read_only', 'SELECT sobre core.patients', 'INSERT'])
      report(`agent_ro: ${n}`, false, 'sin conexión');
  }

  console.log('3. Consulta parametrizada con app_backend');
  const app = clients.app_backend;
  if (app) {
    await check('SELECT $1 por el pooler', async () => {
      const { rows } = await app.query({ text: 'select $1::int + $2::int as total', values: [40, 2] });
      if (Number(rows[0].total) !== 42) throw new Error(`devolvió ${rows[0].total}`);
    });
  } else {
    report('app_backend: consulta parametrizada', false, 'sin conexión');
  }

  console.log('4. importer');
  const importer = clients.importer;
  if (importer) {
    await check('SELECT sobre core.admissions falla', () =>
      expectDenied(importer, 'select 1 from core.admissions limit 1'),
    );
  } else {
    report('importer: SELECT sobre core.admissions', false, 'sin conexión');
  }

  await Promise.all(Object.values(clients).map((c) => c?.end()));
  console.log(failures === 0 ? '\nTodo OK' : `\n${failures} prueba(s) con FALLO`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
