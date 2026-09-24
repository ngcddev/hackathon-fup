import 'server-only';
import { ApiError } from '@/lib/api/errors';
import { can, importPermissionFor, type Role } from '@/lib/auth/permissions';
import { queryAsAppBackend, withImporterTransaction, type PoolClient } from '@/lib/db';
import { toInternalError } from '@/lib/db/errors';
import { getPool } from '@/lib/db/pools';
import {
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
  IMPORT_TARGETS,
  type ApplyBatchResponse,
  type CreateBatchResponse,
  type ImportRow,
  type ImportRowError,
  type ImportTarget,
  type SendRowsResponse,
} from '@/lib/types/api';
import { cleanText, tryBool, tryDate, tryInt, tryNumeric } from './parse';

// Importación en 3 pasos (contrato §4.5): crear lote → enviar filas → aplicar.
//
// Escritura con el rol importer (SEG-10): inserta el lote y las filas en staging y ejecuta
// core.apply_batch, que valida otra vez en SQL (autoridad final) y carga todo o nada (IMP-05).
// El rol importer no puede leer staging ni actualizar lotes; por eso:
// - Al crear el lote, rows_read guarda las filas declaradas (total_rows). apply_batch lo
//   reemplaza por las filas realmente recibidas, y aquí se comparan antes de confirmar.
// - Cada trozo se valida en el servidor con las mismas reglas del SQL para devolver los errores
//   por fila en el paso 2. Los conteos del paso 2 son de ese trozo: los repetidos entre trozos
//   y cualquier diferencia los detecta apply_batch al aplicar.
// Las consultas de solo lectura sobre core (datos ya existentes) van con app_backend.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROW_ERRORS = 100;
const INSERT_ROWS_PER_STATEMENT = 500; // 500 × 6 columnas + 2 = muy por debajo del tope de 65.535 parámetros

const STAGING_TABLE: Record<ImportTarget, string> = {
  drug_stock: 'staging.stg_drug_stock',
  bed_inventory: 'staging.stg_bed_inventory',
  surgery_schedules: 'staging.stg_surgery_schedule',
};

const INVALID_DATE = 'Fecha inválida. Use AAAA-MM-DD o DD/MM/AAAA.';
const REQUIRED = 'Campo obligatorio vacío.';

interface BatchRow {
  target_table: string;
  status: string;
  load_type: string;
  rows_read: number;
}

interface Batch {
  target: ImportTarget;
  status: string;
  declaredRows: number;
}

const isTarget = (value: unknown): value is ImportTarget =>
  typeof value === 'string' && (IMPORT_TARGETS as readonly string[]).includes(value);

function assertCanImport(role: Role, target: ImportTarget): void {
  if (!can(role, importPermissionFor(target))) throw new ApiError('FORBIDDEN');
}

function assertBatchId(batchId: string): void {
  if (!UUID.test(batchId)) throw new ApiError('VALIDATION_ERROR', 'El identificador del lote no es válido.');
}

// Solo lotes de la interfaz: los del histórico o la semilla no existen para esta API.
async function findBatch(batchId: string): Promise<Batch> {
  assertBatchId(batchId);
  let row: BatchRow | undefined;
  try {
    const result = await getPool('importer').query<BatchRow>({
      text: 'SELECT target_table, status, load_type, rows_read FROM audit.import_batches WHERE batch_id = $1',
      values: [batchId],
    });
    row = result.rows[0];
  } catch (error) {
    throw toInternalError('findBatch', error);
  }
  if (!row || row.load_type !== 'ui_import' || !isTarget(row.target_table)) {
    throw new ApiError('NOT_FOUND', 'El lote no existe.');
  }
  return { target: row.target_table, status: row.status, declaredRows: row.rows_read };
}

// ---------------------------------------------------------------- 4.5.1 Crear lote

export async function createBatch(body: unknown, userId: string, role: Role): Promise<CreateBatchResponse> {
  const input = (body ?? {}) as Record<string, unknown>;
  const { target, total_rows: totalRows } = input;
  const fileName = typeof input.file_name === 'string' ? input.file_name.trim() : '';
  const sourceSystem = typeof input.source_system === 'string' ? input.source_system.trim() : '';

  if (!isTarget(target)) throw new ApiError('VALIDATION_ERROR', 'El tipo de importación no es válido.');
  if (!fileName) throw new ApiError('VALIDATION_ERROR', 'Falta el nombre del archivo.');
  if (!/\.(csv|xlsx)$/i.test(fileName)) throw new ApiError('VALIDATION_ERROR', 'El archivo debe ser .csv o .xlsx.');
  if (!sourceSystem) throw new ApiError('VALIDATION_ERROR', 'Falta el sistema de origen.');
  if (!Number.isInteger(totalRows) || (totalRows as number) < 1 || (totalRows as number) > IMPORT_LIMITS.max_rows_per_batch) {
    throw new ApiError(
      'VALIDATION_ERROR',
      `El lote debe tener entre 1 y ${IMPORT_LIMITS.max_rows_per_batch.toLocaleString('es-CO')} filas.`,
    );
  }
  assertCanImport(role, target);

  const batchId = await withImporterTransaction(async (client) => {
    const result = await client.query<{ batch_id: string }>({
      text: `INSERT INTO audit.import_batches
               (load_type, target_table, file_name, source_system, imported_by_user_id, rows_read, status)
             VALUES ('ui_import', $1, $2, $3, $4, $5, 'pending')
             RETURNING batch_id`,
      values: [target, fileName.slice(0, 255), sourceSystem.slice(0, 100), userId, totalRows],
    });
    return result.rows[0].batch_id;
  });

  return {
    batch_id: batchId,
    target,
    status: 'pending',
    max_chunk_bytes: IMPORT_LIMITS.max_chunk_bytes,
    max_rows_per_batch: IMPORT_LIMITS.max_rows_per_batch,
  };
}

// ---------------------------------------------------------------- 4.5.2 Enviar filas

function parseRows(body: unknown, target: ImportTarget): ImportRow[] {
  const rows = (body as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new ApiError('VALIDATION_ERROR', 'No se recibieron filas.');

  const columns = new Set<string>(IMPORT_COLUMNS[target]);
  const seen = new Set<number>();
  return rows.map((raw) => {
    const row = raw as { row_number?: unknown; values?: unknown } | null;
    const rowNumber = row?.row_number;
    if (!Number.isInteger(rowNumber) || (rowNumber as number) < 1) {
      throw new ApiError('VALIDATION_ERROR', 'Cada fila debe traer un número de fila válido.');
    }
    if (seen.has(rowNumber as number)) {
      throw new ApiError('VALIDATION_ERROR', `La fila ${rowNumber} viene repetida.`);
    }
    seen.add(rowNumber as number);

    if (!row?.values || typeof row.values !== 'object' || Array.isArray(row.values)) {
      throw new ApiError('VALIDATION_ERROR', `La fila ${rowNumber} no trae valores.`);
    }
    const values: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(row.values)) {
      if (!columns.has(key)) {
        throw new ApiError('VALIDATION_ERROR', `La columna "${key}" no pertenece a la plantilla.`);
      }
      if (value !== null && typeof value !== 'string') {
        throw new ApiError('VALIDATION_ERROR', `La fila ${rowNumber} tiene un valor que no es texto.`);
      }
      values[key] = value;
    }
    return { row_number: rowNumber as number, values };
  });
}

// Reglas por celda: las mismas de core._validate_batch, con los mismos mensajes.
function cellErrors(target: ImportTarget, v: Record<string, string | null>): [string, string][] {
  const out: [string, string][] = [];
  const required = (col: string) => {
    if (cleanText(v[col]) === null) out.push([col, REQUIRED]);
  };
  const date = (col: string, optional = false) => {
    if (optional && cleanText(v[col]) === null) return;
    if (tryDate(v[col]) === null) out.push([col, INVALID_DATE]);
  };

  if (target === 'drug_stock') {
    required('item_code');
    required('item_name');
    const stock = tryNumeric(v.current_stock);
    if (stock === null) out.push(['current_stock', 'Debe ser un número (sin separador de miles).']);
    else if (stock < 0) out.push(['current_stock', 'No puede ser negativo.']);
    date('stock_date');
    date('expiration_date', true);
  } else if (target === 'bed_inventory') {
    required('bed_code');
    required('bed_name');
    required('bed_group');
    required('bed_subgroup');
    if (tryBool(v.is_active) === null) out.push(['is_active', 'Use Sí o No.']);
  } else {
    required('schedule_number');
    if (tryInt(v.patient_id) === null) out.push(['patient_id', 'Debe ser un número entero.']);
    if (cleanText(v.admission_id) !== null && tryInt(v.admission_id) === null) {
      out.push(['admission_id', 'Debe ser un número entero.']);
    }
    required('service_code');
    date('scheduled_date');
  }
  return out;
}

// Clave de "no repetir" de cada plantilla (null si faltan los datos para armarla).
function uniqueKey(target: ImportTarget, v: Record<string, string | null>): string | null {
  if (target === 'drug_stock') {
    const code = cleanText(v.item_code);
    const date = tryDate(v.stock_date);
    return code && date ? `${code}|${date}` : null;
  }
  if (target === 'bed_inventory') return cleanText(v.bed_code);
  const schedule = cleanText(v.schedule_number);
  return schedule ? `${schedule}|${cleanText(v.service_code) ?? ''}` : null;
}

const DUPLICATE_IN_FILE: Record<ImportTarget, [string, string]> = {
  drug_stock: ['item_code', 'Medicamento repetido en el archivo para la misma fecha de foto.'],
  bed_inventory: ['bed_code', 'Cama repetida en el archivo.'],
  surgery_schedules: ['service_code', 'Servicio repetido en el archivo para la misma programación.'],
};

// SEG-12: datos que ya existen en core y que la importación no puede sobrescribir.
async function existingKeys(target: ImportTarget, rows: ImportRow[]): Promise<Map<string, string>> {
  const keys = rows.map((r) => uniqueKey(target, r.values)).filter((k): k is string => k !== null);
  const found = new Map<string, string>();
  if (keys.length === 0) return found;

  if (target === 'drug_stock') {
    const pairs = keys.map((k) => k.split('|'));
    const hits = await queryAsAppBackend<{ item_code: string; stock_date: string }>(
      `SELECT d.item_code, d.stock_date::text AS stock_date
       FROM core.drug_stock d
       JOIN unnest($1::text[], $2::date[]) AS k(item_code, stock_date)
         ON d.item_code = k.item_code AND d.stock_date = k.stock_date`,
      [pairs.map((p) => p[0]), pairs.map((p) => p[1])],
    );
    for (const h of hits) {
      found.set(
        `${h.item_code}|${h.stock_date}`,
        `Ya existe una foto de inventario del ${h.stock_date} para este medicamento. No se sobrescriben datos.`,
      );
    }
  } else if (target === 'bed_inventory') {
    const hits = await queryAsAppBackend<{ bed_code: string }>(
      `SELECT bed_code FROM core.bed_inventory WHERE data_origin = 'imported' AND bed_code = ANY($1::text[])`,
      [keys],
    );
    for (const h of hits) found.set(h.bed_code, 'Esta cama ya fue importada en un lote anterior. No se sobrescriben datos.');
  } else {
    const pairs = keys.map((k) => k.split('|'));
    const hits = await queryAsAppBackend<{ schedule_number: string; service_code: string }>(
      `SELECT s.schedule_number, s.service_code
       FROM core.surgery_schedules s
       JOIN unnest($1::text[], $2::text[]) AS k(schedule_number, service_code)
         ON s.schedule_number = k.schedule_number AND s.service_code = k.service_code`,
      [pairs.map((p) => p[0]), pairs.map((p) => p[1])],
    );
    for (const h of hits) {
      found.set(`${h.schedule_number}|${h.service_code}`, 'Esta programación y servicio ya existen. No se sobrescriben datos.');
    }
  }
  return found;
}

const EXISTING_COLUMN: Record<ImportTarget, string> = {
  drug_stock: 'stock_date',
  bed_inventory: 'bed_code',
  surgery_schedules: 'schedule_number',
};

async function validateRows(target: ImportTarget, rows: ImportRow[]): Promise<ImportRowError[]> {
  const errors: ImportRowError[] = [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const [column, message] of cellErrors(target, row.values)) {
      errors.push({ row_number: row.row_number, column_name: column, message });
    }
    const key = uniqueKey(target, row.values);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const [dupColumn, dupMessage] = DUPLICATE_IN_FILE[target];
  const existing = await existingKeys(target, rows);
  for (const row of rows) {
    const key = uniqueKey(target, row.values);
    if (!key) continue;
    if ((counts.get(key) ?? 0) > 1) errors.push({ row_number: row.row_number, column_name: dupColumn, message: dupMessage });
    const clash = existing.get(key);
    if (clash) errors.push({ row_number: row.row_number, column_name: EXISTING_COLUMN[target], message: clash });
  }
  return errors.sort((a, b) => a.row_number - b.row_number);
}

async function insertStaging(client: PoolClient, batchId: string, target: ImportTarget, rows: ImportRow[]) {
  const columns = IMPORT_COLUMNS[target];
  const table = STAGING_TABLE[target];
  for (let start = 0; start < rows.length; start += INSERT_ROWS_PER_STATEMENT) {
    const slice = rows.slice(start, start + INSERT_ROWS_PER_STATEMENT);
    const values: unknown[] = [];
    const tuples = slice.map((row) => {
      const base = values.length;
      values.push(batchId, row.row_number, ...columns.map((c) => row.values[c] ?? null));
      return `(${values.slice(base).map((_, i) => `$${base + i + 1}`).join(', ')})`;
    });
    // Las celdas se guardan como texto tal cual llegan (SEG-11: una fórmula nunca se evalúa).
    await client.query({
      text: `INSERT INTO ${table} (batch_id, source_row_number, ${columns.join(', ')}) VALUES ${tuples.join(', ')}`,
      values,
    });
  }
}

export async function sendRows(batchId: string, body: unknown, role: Role): Promise<SendRowsResponse> {
  const batch = await findBatch(batchId);
  assertCanImport(role, batch.target);
  if (batch.status !== 'pending') {
    throw new ApiError('BATCH_INVALID_STATE', 'El lote ya no está pendiente: cree uno nuevo para volver a importar.');
  }
  const rows = parseRows(body, batch.target);
  if (rows.length > batch.declaredRows) {
    throw new ApiError('BATCH_INVALID_STATE', 'Se enviaron más filas de las declaradas al crear el lote.');
  }

  const errors = await validateRows(batch.target, rows);
  try {
    await withImporterTransaction((client) => insertStaging(client, batchId, batch.target, rows));
  } catch (error) {
    // Clave primaria (batch_id, source_row_number): la fila ya llegó en un trozo anterior.
    if (error instanceof ApiError && (error.cause as { code?: string } | undefined)?.code === '23505') {
      throw new ApiError('VALIDATION_ERROR', 'Alguna fila de este trozo ya se había enviado en el lote.');
    }
    throw error;
  }

  const invalid = new Set(errors.map((e) => e.row_number)).size;
  return {
    batch_id: batchId,
    received_rows: rows.length,
    total_received_rows: rows.length,
    invalid_rows: invalid,
    row_errors: errors.slice(0, MAX_ROW_ERRORS),
    errors_truncated: errors.length > MAX_ROW_ERRORS,
  };
}

// ---------------------------------------------------------------- 4.5.3 Aplicar

type ApplyOutcome =
  | { kind: 'applied'; rowsLoaded: number; appliedAt: Date }
  | { kind: 'rejected'; rowsRejected: number; duplicateMessage: string | null };

export async function applyBatch(batchId: string, role: Role): Promise<ApplyBatchResponse> {
  const batch = await findBatch(batchId);
  assertCanImport(role, batch.target);
  if (batch.status !== 'pending') {
    throw new ApiError('BATCH_INVALID_STATE', 'El lote ya fue aplicado, rechazado o revertido.');
  }

  let outcome: ApplyOutcome;
  try {
    outcome = await withImporterTransaction(async (client) => {
      const status = (await client.query<{ status: string }>({ text: 'SELECT core.apply_batch($1::uuid) AS status', values: [batchId] }))
        .rows[0].status;
      const after = (
        await client.query<{ rows_read: number; rows_loaded: number; rows_rejected: number; now: Date }>({
          text: 'SELECT rows_read, rows_loaded, rows_rejected, now() AS now FROM audit.import_batches WHERE batch_id = $1',
          values: [batchId],
        })
      ).rows[0];

      // apply_batch cuenta lo que realmente hay en staging: si no coincide con lo declarado,
      // se deshace todo y el lote sigue pendiente.
      if (after.rows_read !== batch.declaredRows) {
        throw new ApiError(
          'VALIDATION_ERROR',
          `Se recibieron ${after.rows_read} de ${batch.declaredRows} filas. Vuelva a validar el archivo.`,
        );
      }
      if (status === 'applied') return { kind: 'applied', rowsLoaded: after.rows_loaded, appliedAt: after.now };

      // Rechazado: el estado 'rejected' y el reporte se confirman; el error sale después del COMMIT.
      const duplicate = await client.query<{ error_message: string }>({
        text: `SELECT error_message FROM audit.import_errors
               WHERE batch_id = $1 AND error_message LIKE 'Ya existe una foto de inventario%'
               ORDER BY row_number LIMIT 1`,
        values: [batchId],
      });
      return { kind: 'rejected', rowsRejected: after.rows_rejected, duplicateMessage: duplicate.rows[0]?.error_message ?? null };
    });
  } catch (error) {
    const code = ((error as { cause?: { code?: string } }).cause ?? (error as { code?: string }))?.code;
    if (code === 'P0002') throw new ApiError('NOT_FOUND', 'El lote no existe.');
    if (code === '55000') throw new ApiError('BATCH_INVALID_STATE', 'El lote ya fue aplicado, rechazado o revertido.');
    if (code === '42501') throw new ApiError('FORBIDDEN');
    throw error;
  }

  if (outcome.kind === 'rejected') {
    if (outcome.duplicateMessage) throw new ApiError('DUPLICATE_STOCK_DATE', outcome.duplicateMessage);
    const n = outcome.rowsRejected;
    throw new ApiError(
      'BATCH_REJECTED',
      `${n.toLocaleString('es-CO')} ${n === 1 ? 'fila inválida' : 'filas inválidas'}. No se aplicó ningún dato.`,
    );
  }
  return { batch_id: batchId, status: 'applied', rows_loaded: outcome.rowsLoaded, applied_at: outcome.appliedAt.toISOString() };
}
