// Firma definitiva de withAuth(permission, handler).
//
// TODO (bloque 2): reemplazar `resolveUser` por la implementación real:
//   - leer la sesión con Supabase Auth (cookies) y responder UNAUTHENTICATED si no hay;
//   - cargar core.user_profiles y verificar `is_active` en CADA request (AUT-05),
//     respondiendo ACCOUNT_DISABLED si la cuenta está desactivada;
//   - mantener el costo de la verificación por debajo de 200 ms (RNF-15).
// Mientras tanto este stub FALLA CERRADO: sin AUTH_STUB=true (y fuera de
// producción) todo responde 401.

import type { NextRequest } from 'next/server';
import { ApiError, toErrorResponse } from '@/lib/api/errors';
import { can, isRole, type Permission, type Role } from '@/lib/auth/permissions';

export interface AuthUser {
  id: string;
  full_name: string;
  role: Role;
}

export interface AuthContext<P extends object = Record<string, never>> {
  user: AuthUser;
  params: P;
}

export type AuthedHandler<P extends object = Record<string, never>> = (
  request: NextRequest,
  ctx: AuthContext<P>,
) => Promise<Response> | Response;

async function resolveUser(): Promise<AuthUser> {
  const stubEnabled = process.env.AUTH_STUB === 'true' && process.env.NODE_ENV !== 'production';
  if (!stubEnabled) {
    throw new ApiError('UNAUTHENTICATED');
  }
  const role = process.env.AUTH_STUB_ROLE;
  if (!isRole(role)) {
    // Rol ausente o inválido: falla cerrado.
    throw new ApiError('UNAUTHENTICATED');
  }
  return { id: '00000000-0000-0000-0000-000000000000', full_name: 'Usuario simulado', role };
}

// `permission = null` exige solo sesión válida (por ejemplo GET /api/me).
// El handler recibe `params` ya resuelto (en Next.js 16 llega como Promise).
export function withAuth<P extends object = Record<string, never>>(
  permission: Permission | null,
  handler: AuthedHandler<P>,
) {
  return async (request: NextRequest, routeContext: { params: Promise<P> }): Promise<Response> => {
    try {
      const user = await resolveUser();
      if (permission !== null && !can(user.role, permission)) {
        throw new ApiError('FORBIDDEN');
      }
      const params = await routeContext.params;
      return await handler(request, { user, params });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
