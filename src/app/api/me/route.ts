import { permissionsFor } from '@/lib/auth/permissions';
import { withAuth } from '@/lib/auth/with-auth';
import type { MeResponse } from '@/lib/types/api';

// Barra superior (AUT-08) y menú según permisos (RNF-05). Solo exige sesión.
export const GET = withAuth(null, (_request, { user }) => {
  const body: MeResponse = {
    id: user.id,
    full_name: user.full_name,
    role: user.role,
    permissions: permissionsFor(user.role),
  };
  return Response.json(body);
});
