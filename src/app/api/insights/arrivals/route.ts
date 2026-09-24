import { withAuth } from '@/lib/auth/with-auth';
import { getArrivalsInsight } from '@/lib/queries/insights/arrivals';

// D6: mapa de calor de llegadas a urgencias y las 3 franjas con más llegadas.
export const GET = withAuth('dashboard:view', async () => Response.json(await getArrivalsInsight()));
