import 'server-only';
import { ApiError } from '@/lib/api/errors';
import { queryAsAppBackend } from '@/lib/db';
import type {
  AdminLogAction,
  AdminLogEntry,
  LlmProvider,
  LogsResponse,
  QueryLogEntry,
  QueryLogStatus,
  QueryOrigin,
} from '@/lib/types/api';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface LogFilters {
  type: 'queries' | 'admin';
  userId: string | null;
  from: string | null;
  to: string | null;
  limit: number;
}

function parseDate(value: string | null, name: string): string | null {
  if (value === null || value === '') return null;
  const valid = DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (!valid) throw new ApiError('VALIDATION_ERROR', `${name} debe tener el formato AAAA-MM-DD.`);
  return value;
}

export function parseLogFilters(params: URLSearchParams): LogFilters {
  const type = params.get('type');
  if (type !== 'queries' && type !== 'admin') {
    throw new ApiError('VALIDATION_ERROR', 'type es obligatorio y debe ser queries o admin.');
  }
  const userId = params.get('user_id') || null;
  if (userId !== null && !UUID_PATTERN.test(userId)) {
    throw new ApiError('VALIDATION_ERROR', 'user_id no es válido.');
  }
  const rawLimit = params.get('limit');
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null && rawLimit !== '') {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new ApiError('VALIDATION_ERROR', `limit debe ser un entero entre 1 y ${MAX_LIMIT}.`);
    }
  }
  return { type, userId, from: parseDate(params.get('from'), 'from'), to: parseDate(params.get('to'), 'to'), limit };
}

// Filtros comunes: usuario y rango de fechas inclusivo en hora de Colombia. Devuelve el WHERE y sus parámetros.
function buildWhere(filters: LogFilters, userColumn: string, dateColumn: string) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.userId) {
    values.push(filters.userId);
    conditions.push(`${userColumn} = $${values.length}`);
  }
  if (filters.from) {
    values.push(filters.from);
    conditions.push(`${dateColumn} >= ($${values.length}::date)::timestamp AT TIME ZONE 'America/Bogota'`);
  }
  if (filters.to) {
    values.push(filters.to);
    conditions.push(`${dateColumn} < (($${values.length}::date + 1)::timestamp AT TIME ZONE 'America/Bogota')`);
  }
  values.push(filters.limit);
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values, limitParam: `$${values.length}` };
}

interface QueryLogRow {
  query_log_id: number;
  user_id: string;
  full_name: string;
  asked_at: Date;
  question: string;
  generated_sql: string | null;
  origin: QueryOrigin;
  llm_provider: LlmProvider | null;
  status: QueryLogStatus;
  row_count: number | null;
  duration_ms: number;
}

interface AdminLogRow {
  admin_log_id: number;
  actor_user_id: string;
  actor_name: string;
  target_user_id: string;
  target_name: string;
  action: AdminLogAction;
  old_value: string | null;
  new_value: string | null;
  created_at: Date;
}

// AUT-15: log de consultas del agente y de acciones de administración. Nunca se seleccionan
// error_message (puede traer detalle interno) ni filas devueltas (SEG-06).
export async function getLogs(filters: LogFilters): Promise<LogsResponse> {
  if (filters.type === 'queries') {
    const { where, values, limitParam } = buildWhere(filters, 'q.user_id', 'q.asked_at');
    const rows = await queryAsAppBackend<QueryLogRow>(
      `SELECT q.query_log_id, q.user_id, u.full_name, q.asked_at, q.question, q.generated_sql,
              q.origin, q.llm_provider, q.status, q.row_count, q.duration_ms
         FROM audit.query_log q
         JOIN core.user_profiles u ON u.user_id = q.user_id
         ${where}
        ORDER BY q.asked_at DESC, q.query_log_id DESC
        LIMIT ${limitParam}`,
      values,
    );
    const entries: QueryLogEntry[] = rows.map((r) => ({
      query_log_id: r.query_log_id,
      user: { user_id: r.user_id, full_name: r.full_name },
      asked_at: r.asked_at.toISOString(),
      question: r.question,
      generated_sql: r.generated_sql,
      origin: r.origin,
      llm_provider: r.llm_provider,
      status: r.status,
      row_count: r.row_count,
      duration_ms: r.duration_ms,
    }));
    return { type: 'queries', entries };
  }

  // En el log de administración, user_id filtra por la cuenta que ejecutó la acción.
  const { where, values, limitParam } = buildWhere(filters, 'l.actor_user_id', 'l.created_at');
  const rows = await queryAsAppBackend<AdminLogRow>(
    `SELECT l.admin_log_id, l.actor_user_id, a.full_name AS actor_name,
            l.target_user_id, t.full_name AS target_name,
            l.action, l.old_value, l.new_value, l.created_at
       FROM audit.user_admin_log l
       JOIN core.user_profiles a ON a.user_id = l.actor_user_id
       JOIN core.user_profiles t ON t.user_id = l.target_user_id
       ${where}
      ORDER BY l.created_at DESC, l.admin_log_id DESC
      LIMIT ${limitParam}`,
    values,
  );
  const entries: AdminLogEntry[] = rows.map((r) => ({
    admin_log_id: r.admin_log_id,
    actor: { user_id: r.actor_user_id, full_name: r.actor_name },
    target: { user_id: r.target_user_id, full_name: r.target_name },
    action: r.action,
    old_value: r.old_value,
    new_value: r.new_value,
    created_at: r.created_at.toISOString(),
  }));
  return { type: 'admin', entries };
}
