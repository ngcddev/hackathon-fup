import { suggestForAlert } from '@/lib/agent/alert-suggestion-service';
import { ApiError } from '@/lib/api/errors';
import { withAuth } from '@/lib/auth/with-auth';

const MAX_ID_LENGTH = 300;
const INVALID_ID = 'Indique la alerta (alert_id) para la que quiere la sugerencia.';

// Sugerencia con IA para resolver una alerta activa. Mismo permiso que ver las alertas.
export const POST = withAuth('dashboard:view', async (request, { user }) => {
  const body: unknown = await request.json().catch(() => null);
  const raw = typeof body === 'object' && body !== null ? (body as { alert_id?: unknown }).alert_id : undefined;
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_ID_LENGTH) {
    throw new ApiError('VALIDATION_ERROR', INVALID_ID);
  }
  return Response.json(await suggestForAlert(raw.trim(), user));
});
