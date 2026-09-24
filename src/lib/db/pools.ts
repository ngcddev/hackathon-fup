import 'server-only';
import { Pool, types, type PoolConfig } from 'pg';

// Un pool por rol de Postgres (modelo_datos_hslv §2). Las cadenas van por el pooler
// de Supabase en modo transaction (puerto 6543, usuario "rol.referencia_del_proyecto").
export type DbRole = 'app_backend' | 'agent_ro' | 'importer';

const ENV_VAR: Record<DbRole, string> = {
  app_backend: 'DATABASE_URL_APP_BACKEND',
  agent_ro: 'DATABASE_URL_AGENT_RO',
  importer: 'DATABASE_URL_IMPORTER',
};

// Los timestamp sin zona (hora de Colombia, S-12) y las fechas se devuelven como texto
// del servidor: pg los convertiría a Date en la zona del proceso y correría las horas.
// bigint y numeric llegan como number (los conteos y promedios de este sistema caben de sobra).
const TYPE_PARSERS: Record<number, (v: string) => unknown> = {
  [types.builtins.DATE]: (v) => v,
  [types.builtins.TIMESTAMP]: (v) => v,
  [types.builtins.INT8]: (v) => Number(v),
  [types.builtins.NUMERIC]: (v) => Number(v),
};
const poolTypes = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') =>
    TYPE_PARSERS[oid] ?? types.getTypeParser(oid, format as 'text'),
};

declare global {
  var __hslvPools: Partial<Record<DbRole, Pool>> | undefined;
}

function buildConfig(role: DbRole): PoolConfig {
  const raw = process.env[ENV_VAR[role]];
  if (!raw) {
    throw new Error(`Falta la variable de entorno ${ENV_VAR[role]}.`);
  }
  // pg deja que sslmode de la URL pise la opción ssl; se quita para controlarla aquí.
  const url = new URL(raw);
  url.searchParams.delete('sslmode');
  const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
  return {
    connectionString: url.toString(),
    // El pooler de Supabase presenta una cadena de certificados que Node no trae en su almacén.
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 3, // funciones serverless: pocas conexiones por instancia
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
    application_name: `hslv_${role}`,
    types: poolTypes,
  };
}

// Singleton en globalThis para sobrevivir al hot reload de `next dev`.
export function getPool(role: DbRole): Pool {
  const pools = (globalThis.__hslvPools ??= {});
  let pool = pools[role];
  if (!pool) {
    pool = new Pool(buildConfig(role));
    // Un cliente inactivo que pierde la conexión emite 'error'; sin manejador tumbaría el proceso.
    pool.on('error', (err) => console.error(`[db:${role}] error en cliente inactivo:`, err));
    pools[role] = pool;
  }
  return pool;
}
