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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-8">
      <div className="grid w-full max-w-[1040px] grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] overflow-hidden rounded-2xl border border-line bg-white shadow-float">
        <div
          className="relative flex min-h-[560px] flex-col justify-between bg-slate-200 bg-cover bg-center p-6"
          style={{
            backgroundImage: 'linear-gradient(rgba(15,23,42,0.25), rgba(15,23,42,0.35)), url(/login-hospital.webp)',
          }}
        >
          <div className="flex items-center gap-3 self-center rounded-full border border-white/60 bg-white/45 py-2 pl-2 pr-5 backdrop-blur-md">
            <span className="block size-10 shrink-0 overflow-hidden rounded-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.svg"
                alt="Logo Hospital Susana López de Valencia"
                className="size-full object-contain mix-blend-multiply"
              />
            </span>
            <div className="text-center text-sm font-bold leading-snug text-navy">
              Hospital Susana López de Valencia E.S.E.
              <br />
              <span className="font-medium text-muted">Popayán, Cauca</span>
            </div>
          </div>
          <h1 className="m-0 mx-auto max-w-[460px] px-2 pb-2 text-center text-3xl font-extrabold sm:text-4xl leading-tight tracking-tight text-white [text-shadow:0_2px_4px_rgba(15,23,42,0.6),0_4px_24px_rgba(15,23,42,0.55)] text-balance">
            ¡Pensando en ti, doy lo mejor de mi!
          </h1>
        </div>

        <div className="flex items-center justify-center px-10 py-12">
          <form onSubmit={submit} className="flex w-full max-w-[400px] flex-col gap-[18px]">
            <div>
              <h2 className="m-0 text-[28px] font-extrabold tracking-tight text-navy">Iniciar sesión</h2>
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
