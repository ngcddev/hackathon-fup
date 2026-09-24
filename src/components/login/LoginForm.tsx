'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';

const FIELD =
  'h-[50px] w-full rounded-lg border-[1.5px] border-slate-300 bg-white px-4 text-base text-ink outline-none focus:border-leaf focus:shadow-[0_0_0_3px_rgba(76,140,35,0.25)]';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    // El inicio de sesión lo resuelve Supabase Auth directamente desde el navegador.
    const { error: authError } = await createClient().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (authError) {
      setError('Correo o contraseña incorrectos.');
      setBusy(false);
      return;
    }
    router.replace('/');
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-6 sm:px-5 sm:py-8">
      <div className="grid w-full max-w-[1040px] grid-cols-1 overflow-hidden md:grid-cols-2 rounded-2xl border border-line bg-white shadow-float">
        <div
          className="relative flex aspect-[751/687] min-h-[320px] flex-col justify-between gap-4 bg-slate-200 bg-cover bg-[center_30%] p-4 sm:p-6 md:aspect-auto md:min-h-[560px]"
          style={{
            backgroundImage:
              'linear-gradient(to bottom, rgba(15,23,42,0.3), rgba(15,23,42,0.05) 30%, rgba(15,23,42,0.05) 55%, rgba(15,23,42,0.6)), url(/login-hospital.webp)',
          }}
        >
          <div className="mx-auto flex w-fit max-w-full items-center justify-center gap-2.5 self-center rounded-full border border-white/60 bg-white/60 px-1.5 py-1.5 backdrop-blur-md sm:gap-3 sm:bg-white/45 sm:p-2">
            <span className="block size-8 shrink-0 overflow-hidden rounded-full sm:size-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.svg"
                alt="Logo Hospital Susana López de Valencia"
                className="size-full object-contain mix-blend-multiply"
              />
            </span>
            <div className="min-w-0 flex-1 text-balance text-center text-xs font-bold leading-snug text-navy sm:text-sm">
              Hospital Susana López de Valencia E.S.E.
              <br />
              <span className="font-medium text-muted">Popayán, Cauca</span>
            </div>
            {/* Contrapeso del logo para que el texto quede centrado en la etiqueta. */}
            <span aria-hidden className="block size-8 shrink-0 sm:size-10" />
          </div>
          <h1 className="m-0 mx-auto max-w-[460px] px-2 pb-2 text-center text-2xl font-extrabold leading-tight sm:text-3xl md:text-4xl tracking-tight text-white [text-shadow:0_2px_4px_rgba(15,23,42,0.6),0_4px_24px_rgba(15,23,42,0.55)] text-balance">
            ¡Pensando en ti, doy lo mejor de mi!
          </h1>
        </div>

        <div className="flex items-center justify-center px-6 py-8 sm:px-10 sm:py-12">
          <form onSubmit={submit} className="flex w-full max-w-[400px] flex-col gap-[18px]">
            <div>
              <h2 className="m-0 text-2xl font-extrabold tracking-tight text-navy sm:text-[28px]">Iniciar sesión</h2>
              <p className="mb-0 mt-1.5 text-base text-muted">Sistema de Gestión Hospitalaria Inteligente</p>
            </div>
            <label className="flex flex-col gap-2 text-[15px] font-semibold">
              Correo
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                placeholder="nombre@hsl.gov.co"
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-2 text-[15px] font-semibold">
              Contraseña
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                placeholder="••••••••"
                className={FIELD}
              />
            </label>
            {error && (
              <div
                role="alert"
                className="flex items-center gap-2.5 rounded-lg border border-danger-line bg-danger-bg px-3.5 py-3 text-[15px] font-semibold text-danger"
              >
                <Icon name="alerts" />
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="h-[52px] cursor-pointer rounded-lg border-0 bg-leaf text-[17px] font-bold text-white hover:bg-forest disabled:cursor-default disabled:opacity-60"
            >
              {busy ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
