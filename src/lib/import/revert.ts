import 'server-only';
import { ApiError } from '@/lib/api/errors';
import { toInternalError } from '@/lib/db/errors';
import { getPool } from '@/lib/db/pools';
import type { RevertBatchResponse } from '@/lib/types/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// IMP-08: revierte un lote de importación de la interfaz con core.revert_batch, que bloquea el
// lote, borra sus filas, marca 'reverted' con quién y cuándo, y recupera la capacidad derivada
// de las camas. La función valida otra vez que el actor sea un admin activo.
// Los códigos SQLSTATE de la función se traducen al catálogo de errores; el mensaje de
// Postgres nunca llega al cliente.
export async function revertBatch(batchId: string, actorUserId: string): Promise<RevertBatchResponse> {
  if (!UUID.test(batchId)) throw new ApiError('VALIDATION_ERROR', 'El identificador del lote no es válido.');
  try {
    const result = await getPool('app_backend').query<{ rows_reverted: number }>({
      text: 'SELECT core.revert_batch($1::uuid, $2::uuid) AS rows_reverted',
      values: [batchId, actorUserId],
    });
    return { batch_id: batchId, status: 'reverted', rows_reverted: result.rows[0].rows_reverted };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'P0002') throw new ApiError('NOT_FOUND', 'El lote no existe.');
    if (code === '55000') {
      throw new ApiError(
        'BATCH_INVALID_STATE',
        'Solo se pueden revertir lotes importados desde la interfaz que estén aplicados.',
      );
    }
    if (code === '42501') throw new ApiError('FORBIDDEN');
    throw toInternalError('revertBatch', error);
  }
}
