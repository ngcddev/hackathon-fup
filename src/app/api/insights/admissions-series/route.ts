import { withAuth } from '@/lib/auth/with-auth';
import { getAdmissionsSeries, parseAdmissionsSeriesParams } from '@/lib/queries/insights/admissions-series';

// Serie de ingresos por año, mes o día para la vista Pacientes. Respeta el filtro de servicio.
export const GET = withAuth('dashboard:view', async (request) => {
  const searchParams = request.nextUrl.searchParams;
  const rawService = searchParams.get('service');
  const service = rawService !== null && rawService.trim() !== '' ? rawService.trim() : null;
  return Response.json(await getAdmissionsSeries(parseAdmissionsSeriesParams(searchParams), service));
});
