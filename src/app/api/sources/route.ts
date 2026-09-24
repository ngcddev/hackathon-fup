import { withAuth } from '@/lib/auth/with-auth';
import { getSources } from '@/lib/queries/sources';

// DAS-12: panel de fuentes de datos, solo lectura. Todos los roles ('sources:view').
export const GET = withAuth('sources:view', async () => Response.json(await getSources()));
