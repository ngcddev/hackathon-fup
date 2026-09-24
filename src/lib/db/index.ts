import 'server-only';
import type { PoolClient } from 'pg';
import { getPool } from './pools';
import { ApiError } from '@/lib/api/errors';
import { toInternalError } from './errors';

export type { PoolClient };

// Consultas del backend (sesión, administración, logs, consultas fijas) con el rol app_backend.
// Siempre parametrizadas ($1, $2...). Nunca se usa `name`: el pooler en modo transaction
// no admite prepared statements con nombre.
export async function queryAsAppBackend<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const result = await getPool('app_backend').query({ text: sql, values: params });
    return result.rows as T[];
  } catch (error) {
    throw toInternalError('queryAsAppBackend', error);
  }
}

export type AgentQueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  durationMs: number;
};

// SQL generado por el LLM (o del plan B) con el rol agent_ro. Defensa en profundidad:
// aunque el rol ya es de solo lectura y con timeout de 5 s, la transacción lo repite.
// Protocolo simple (sin parámetros): el SQL llega como texto ya validado.
export async function runAgentQuery(sql: string): Promise<AgentQueryResult> {
  let client: PoolClient | undefined;
  let broken = false;
  try {
    client = await getPool('agent_ro').connect();
    const started = performance.now();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await client.query({ text: sql });
    await client.query('COMMIT');
    const durationMs = Math.round(performance.now() - started);
    // Varias sentencias devuelven un arreglo de resultados: el agente solo admite un SELECT.
    if (Array.isArray(result)) {
      throw new Error('La consulta contiene más de una sentencia.');
    }
    return {
      columns: result.fields.map((f) => f.name),
      rows: result.rows as Record<string, unknown>[],
      durationMs,
    };
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true; // la conexión quedó en mal estado: se descarta en vez de volver al pool
      }
    }
    throw toInternalError('runAgentQuery', error);
  } finally {
    client?.release(broken || undefined);
  }
}

// Escritura del importador con el rol importer: BEGIN, COMMIT y ROLLBACK ante cualquier error.
export async function withImporterTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient | undefined;
  let broken = false;
  try {
    client = await getPool('importer').connect();
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
    }
    // Un ApiError lanzado por fn (por ejemplo BATCH_REJECTED) es un error de negocio: pasa intacto.
    if (error instanceof ApiError) throw error;
    throw toInternalError('withImporterTransaction', error);
  } finally {
    client?.release(broken || undefined);
  }
}
