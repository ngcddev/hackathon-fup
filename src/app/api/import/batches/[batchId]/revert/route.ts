import { withAuth } from '@/lib/auth/with-auth';
import { revertBatch } from '@/lib/import/revert';

// IMP-08: revertir un lote aplicado. Solo admin ('import:revert'); no depende del target del lote.
export const POST = withAuth<{ batchId: string }>('import:revert', async (_request, { user, params }) => {
  return Response.json(await revertBatch(params.batchId, user.id));
});
