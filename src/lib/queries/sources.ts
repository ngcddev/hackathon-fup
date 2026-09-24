import 'server-only';
import { queryAsAppBackend } from '@/lib/db';
import type { BatchLoadType, BatchStatus, SourceBatch, SourcesResponse, SourceTable } from '@/lib/types/api';

// Tablas de core que reciben datos, con la columna que marca lo simulado (o null si no la tienen).
const SOURCE_TABLES: { table: string; simulatedFilter: string | null }[] = [
  { table: 'patients', simulatedFilter: null },
  { table: 'admissions', simulatedFilter: null },
  { table: 'triages', simulatedFilter: null },
  { table: 'first_attentions', simulatedFilter: null },
  { table: 'service_lines', simulatedFilter: null },
  { table: 'drug_dispensations', simulatedFilter: null },
  { table: 'surgery_schedules', simulatedFilter: null },
  { table: 'bed_inventory', simulatedFilter: "data_origin = 'simulated'" },
  { table: 'drug_stock', simulatedFilter: "data_origin = 'simulated'" },
];

interface BatchRow {
  batch_id: string;
  load_type: BatchLoadType;
  target_table: string;
  file_name: string | null;
  source_system: string;
  imported_by_user_id: string | null;
  imported_by_name: string | null;
  imported_at: Date;
  rows_read: number;
  rows_loaded: number;
  rows_rejected: number;
  status: BatchStatus;
  is_simulated: boolean;
}

// DAS-12: qué hay cargado, de dónde viene y cuánto es simulado. Solo conteos y metadatos de lotes.
export async function getSources(): Promise<SourcesResponse> {
  // Los nombres de tabla salen de la lista fija de arriba, nunca de la entrada del usuario.
  const countsSql = SOURCE_TABLES.map(
    ({ table, simulatedFilter }) =>
      `SELECT '${table}' AS "table", count(*)::bigint AS rows,
              ${simulatedFilter ? `count(*) FILTER (WHERE ${simulatedFilter})` : '0'}::bigint AS simulated_rows
         FROM core.${table}`,
  ).join(' UNION ALL ');

  const [tables, batches, [last]] = await Promise.all([
    queryAsAppBackend<SourceTable>(countsSql),
    queryAsAppBackend<BatchRow>(
      `SELECT b.batch_id, b.load_type, b.target_table, b.file_name, b.source_system,
              b.imported_by_user_id, u.full_name AS imported_by_name, b.imported_at,
              b.rows_read, b.rows_loaded, b.rows_rejected, b.status, b.is_simulated
         FROM audit.import_batches b
         LEFT JOIN core.user_profiles u ON u.user_id = b.imported_by_user_id
        ORDER BY b.imported_at DESC
        LIMIT 50`,
    ),
    queryAsAppBackend<{ last_load_at: Date | null }>(
      `SELECT max(imported_at) AS last_load_at FROM audit.import_batches WHERE status = 'applied'`,
    ),
  ]);

  const total = tables.reduce((sum, t) => sum + t.rows, 0);
  const simulated = tables.reduce((sum, t) => sum + t.simulated_rows, 0);

  return {
    tables,
    batches: batches.map(
      (b): SourceBatch => ({
        batch_id: b.batch_id,
        load_type: b.load_type,
        target_table: b.target_table,
        file_name: b.file_name,
        source_system: b.source_system,
        imported_by: b.imported_by_user_id
          ? { user_id: b.imported_by_user_id, full_name: b.imported_by_name ?? '' }
          : null,
        imported_at: b.imported_at.toISOString(),
        rows_read: b.rows_read,
        rows_loaded: b.rows_loaded,
        rows_rejected: b.rows_rejected,
        status: b.status,
        is_simulated: b.is_simulated,
      }),
    ),
    last_load_at: last?.last_load_at ? last.last_load_at.toISOString() : null,
    simulated_pct: total === 0 ? 0 : Math.round((simulated / total) * 1000) / 10,
  };
}
