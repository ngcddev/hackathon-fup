import { withAuth } from '@/lib/auth/with-auth';
import { getLogs, parseLogFilters } from '@/lib/auth/logs';

// AUT-15: log de consultas y de administración. Solo admin ('logs:view').
export const GET = withAuth('logs:view', async (request) => {
  const filters = parseLogFilters(request.nextUrl.searchParams);
  return Response.json(await getLogs(filters));
});
