import { withAuth } from '@/lib/auth/with-auth';
import { assertPassword, assertUserId, resetPassword } from '@/lib/auth/users';
import type { UserResponse } from '@/lib/types/api';

export const POST = withAuth<{ userId: string }>('users:manage', async (request, { user, params }) => {
  assertUserId(params.userId);
  const body = (await request.json().catch(() => null)) as { temporary_password?: unknown } | null;
  const password = assertPassword(body?.temporary_password);
  const response: UserResponse = { user: await resetPassword(user.id, params.userId, password) };
  return Response.json(response);
});
