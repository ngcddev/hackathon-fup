import { ApiError } from '@/lib/api/errors';
import { withAuth } from '@/lib/auth/with-auth';
import { sendRows } from '@/lib/import/batches';
import { IMPORT_LIMITS } from '@/lib/types/api';

// 4.5.2: recibe un trozo de filas; las inválidas también se guardan y se informan por fila.
export const POST = withAuth<{ batchId: string }>(null, async (request, { user, params }) => {
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') >= IMPORT_LIMITS.max_chunk_bytes) throw new ApiError('PAYLOAD_TOO_LARGE');
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'El cuerpo de la solicitud no es JSON válido.');
  }
  return Response.json(await sendRows(params.batchId, body, user.role));
});
