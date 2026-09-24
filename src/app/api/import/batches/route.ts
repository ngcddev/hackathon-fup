import { withAuth } from '@/lib/auth/with-auth';
import { createBatch } from '@/lib/import/batches';

// 4.5.1: crea un lote pendiente. El permiso depende del target del cuerpo (importPermissionFor).
export const POST = withAuth(null, async (request, { user }) => {
  const body: unknown = await request.json().catch(() => null);
  return Response.json(await createBatch(body, user.id, user.role));
});
