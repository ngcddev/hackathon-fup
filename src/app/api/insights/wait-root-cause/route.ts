import { withAuth } from '@/lib/auth/with-auth';
import { getWaitRootCause } from '@/lib/queries/insights/wait-root-cause';

// D7: qué segmento (turno, día de la semana, triage) explica el cambio de la espera en urgencias.
export const GET = withAuth('dashboard:view', async () => Response.json(await getWaitRootCause()));
