import { withAuth } from '@/lib/auth/with-auth';
import { getKpis } from '@/lib/queries/kpis';

export const GET = withAuth('dashboard:view', async (request) => {
  const raw = request.nextUrl.searchParams.get('service');
  const service = raw !== null && raw.trim() !== '' ? raw.trim() : null;
  return Response.json(await getKpis(service));
});
