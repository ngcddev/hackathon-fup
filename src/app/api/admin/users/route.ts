import { withAuth } from '@/lib/auth/with-auth';
import { createUser, listUsers, parseCreateUser } from '@/lib/auth/users';
import type { ListUsersResponse, UserResponse } from '@/lib/types/api';

// AUT-06/07: administración de cuentas. Solo admin ('users:manage').
export const GET = withAuth('users:manage', async () => {
  const body: ListUsersResponse = { users: await listUsers() };
  return Response.json(body);
});

export const POST = withAuth('users:manage', async (request, { user }) => {
  const input = parseCreateUser(await request.json().catch(() => null));
  const body: UserResponse = { user: await createUser(user.id, input) };
  return Response.json(body);
});
