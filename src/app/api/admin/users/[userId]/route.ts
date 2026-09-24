import { withAuth } from '@/lib/auth/with-auth';
import { assertUserId, parseUpdateUser, updateUser } from '@/lib/auth/users';
import type { UserResponse } from '@/lib/types/api';

export const PATCH = withAuth<{ userId: string }>('users:manage', async (request, { user, params }) => {
  assertUserId(params.userId);
  const changes = parseUpdateUser(await request.json().catch(() => null));
  const body: UserResponse = { user: await updateUser(user.id, params.userId, changes) };
  return Response.json(body);
});
