import { withAuth } from '@/lib/auth/with-auth';
import { applyBatch } from '@/lib/import/batches';

// 4.5.3: valida en SQL y carga todo o nada con core.apply_batch.
export const POST = withAuth<{ batchId: string }>(null, async (_request, { user, params }) => {
  return Response.json(await applyBatch(params.batchId, user.role));
});
