// withAuth(permission, handler): sesión real con Supabase Auth + perfil en core.user_profiles.
//
// En CADA request (AUT-05, SEG-15):
//   1. Se valida el JWT de la cookie de sesión (getClaims); sin sesión válida: 401 UNAUTHENTICATED.
//   2. Se lee el perfil en core.user_profiles con el rol app_backend (una consulta por clave primaria).
//      Sin perfil o con is_active = false: 403 ACCOUNT_DISABLED. Así una cuenta desactivada pierde
//      el acceso en su siguiente solicitud aunque su token siga vigente.
//   3. Se verifica el permiso contra la matriz de permissions.ts: sin permiso, 403 FORBIDDEN.
// El rol NUNCA se lee del token (user_metadata lo puede editar el usuario): solo de la base.
//
// AUTH_STUB=true + AUTH_STUB_ROLE=<rol> inyectan un usuario falso SOLO fuera de producción
// (desarrollo sin Supabase). Sin ellos, todo depende de la sesión real.

import type { NextRequest } from 'next/server';
import { ApiError, toErrorResponse } from '@/lib/api/errors';
import { can, isRole, type Permission, type Role } from '@/lib/auth/permissions';
import { queryAsAppBackend } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';

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

interface ProfileRow {
  full_name: string;
  role: string;
  is_active: boolean;
}

function stubUser(): AuthUser | null {
  if (process.env.AUTH_STUB !== 'true' || process.env.NODE_ENV === 'production') return null;
  const role = process.env.AUTH_STUB_ROLE;
  if (!isRole(role)) throw new ApiError('UNAUTHENTICATED'); // rol ausente o inválido: falla cerrado
  return { id: '00000000-0000-0000-0000-000000000000', full_name: 'Usuario simulado', role };
}

// Usuario en sesión, o ApiError (401 sin sesión, 403 cuenta desactivada). También sirve a las
// páginas del servidor (layouts) que necesiten el rol.
export async function getCurrentUser(): Promise<AuthUser> {
  const stub = stubUser();
  if (stub) return stub;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) throw new ApiError('UNAUTHENTICATED');

  const [profile] = await queryAsAppBackend<ProfileRow>(
    'SELECT full_name, role, is_active FROM core.user_profiles WHERE user_id = $1',
    [userId],
  );
  if (!profile || !profile.is_active || !isRole(profile.role)) {
    if (!profile) console.warn(`[auth] Usuario ${userId} con sesión pero sin perfil en core.user_profiles.`);
    throw new ApiError('ACCOUNT_DISABLED');
  }
  return { id: userId, full_name: profile.full_name, role: profile.role };
}

// `permission = null` exige solo sesión válida (por ejemplo GET /api/me).
// El handler recibe `params` ya resuelto (en Next.js 16 llega como Promise).
export function withAuth<P extends object = Record<string, never>>(
  permission: Permission | null,
  handler: AuthedHandler<P>,
) {
  return async (request: NextRequest, routeContext: { params: Promise<P> }): Promise<Response> => {
    try {
      const user = await getCurrentUser();
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
