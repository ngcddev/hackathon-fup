'use client';

import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import { clearSnapshot } from './KpisProvider';

// Cuenta con is_active = false: no se entra a la aplicación, solo se puede cerrar sesión (AUT-05).
export function AccountDisabled() {
  const router = useRouter();

  const logout = async () => {
    await createClient().auth.signOut();
    clearSnapshot();
    router.replace('/login');
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-5">
      <div role="alert" className="flex max-w-[480px] flex-col items-center gap-4 rounded-2xl border border-line bg-white px-8 py-12 text-center shadow-float">
        <Icon name="shield" size={40} strokeWidth={1.5} className="text-navy" />
        <h1 className="m-0 text-2xl font-extrabold text-navy">Tu cuenta está desactivada</h1>
        <p className="m-0 text-base leading-normal text-muted">Contacta al administrador del sistema para volver a acceder.</p>
        <button
          type="button"
          onClick={logout}
          className="h-[46px] cursor-pointer rounded-lg border-[1.5px] border-navy bg-white px-6 text-[15px] font-bold"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
