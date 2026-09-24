import { redirect } from 'next/navigation';
import { AccountDisabled } from '@/components/app/AccountDisabled';
import { AppShell } from '@/components/app/AppShell';
import { KpisProvider } from '@/components/app/KpisProvider';
import { SessionProvider } from '@/components/app/SessionProvider';
import { ToastProvider } from '@/components/app/ToastProvider';
import { ApiError } from '@/lib/api/errors';
import { getCurrentUser } from '@/lib/auth/with-auth';
import { permissionsFor } from '@/lib/auth/permissions';
import type { MeResponse } from '@/lib/types/api';

// El proxy ya exige sesión; aquí se lee el perfil real (rol e is_active) para armar el menú.
// Los permisos ocultan opciones, pero cada endpoint los vuelve a verificar en el servidor.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let me: MeResponse;
  try {
    const user = await getCurrentUser();
    me = { id: user.id, full_name: user.full_name, role: user.role, permissions: permissionsFor(user.role) };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') redirect('/login');
    if (error instanceof ApiError && error.code === 'ACCOUNT_DISABLED') return <AccountDisabled />;
    throw error;
  }

  return (
    <SessionProvider me={me}>
      <ToastProvider>
        <KpisProvider>
          <AppShell>{children}</AppShell>
        </KpisProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
