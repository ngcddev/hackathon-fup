'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Permission, Role } from '@/lib/auth/permissions';
import type { MeResponse } from '@/lib/types/api';

const SessionContext = createContext<MeResponse | null>(null);

export const ROLE_LABEL: Record<Role, string> = {
  director: 'Director',
  service_head: 'Jefe de servicio',
  medic: 'Médico',
  admin: 'Administrador',
};

export function SessionProvider({ me, children }: { me: MeResponse; children: ReactNode }) {
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

// Los permisos solo deciden qué se muestra; el servidor los vuelve a verificar en cada endpoint.
export function useSession() {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useSession debe usarse dentro de SessionProvider.');
  return {
    me,
    roleLabel: ROLE_LABEL[me.role],
    can: (permission: Permission) => me.permissions.includes(permission),
  };
}
