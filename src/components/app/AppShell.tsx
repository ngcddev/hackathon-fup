'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { cn, fmtDate, fmtDateTime, prettyName } from '@/components/ui/format';
import type { Permission } from '@/lib/auth/permissions';
import { createClient } from '@/lib/supabase/client';
import { ALL_HOSPITAL, clearSnapshot, useKpis, useOnline } from './KpisProvider';
import { useSession } from './SessionProvider';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  permission?: Permission;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Resumen', icon: 'resumen' },
  { href: '/agente', label: 'Agente IA', icon: 'agente', permission: 'agent:query' },
  { href: '/pacientes', label: 'Pacientes e ingresos', icon: 'pacientes' },
  { href: '/camas', label: 'Camas', icon: 'camas' },
  { href: '/medicamentos', label: 'Medicamentos', icon: 'medicamentos' },
  { href: '/cirugias', label: 'Cirugías', icon: 'cirugias' },
  { href: '/alertas', label: 'Alertas', icon: 'alertas' },
  { href: '/fuentes', label: 'Fuentes de datos', icon: 'fuentes', permission: 'sources:view' },
  { href: '/usuarios', label: 'Usuarios', icon: 'usuarios', permission: 'users:manage' },
  { href: '/registro', label: 'Registro de actividad', icon: 'registro', permission: 'logs:view' },
];

// Pregunta sugerida al abrir el agente desde el encabezado, según la pantalla actual.
const CONTEXT_QUESTION: Record<string, string> = {
  '/pacientes': '¿Cuál es el tiempo de espera promedio en urgencias en la última semana?',
  '/camas': '¿Cuál es la ocupación de camas por servicio hoy?',
  '/medicamentos': '¿Cuáles son los medicamentos con menos de 5 días de inventario?',
  '/cirugias': '¿Cuál es el cumplimiento quirúrgico por mes?',
  '/alertas': '¿Cuáles son los medicamentos con menos de 5 días de inventario?',
};

const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, roleLabel, can } = useSession();
  const { data, service, setService, services, stale } = useKpis();
  const online = useOnline();
  const [menuOpen, setMenuOpen] = useState(false);

  const items = NAV.filter((n) => !n.permission || can(n.permission));
  const current = items.find((n) => isActive(pathname, n.href)) ?? items[0];
  const critical = data?.alerts.filter((a) => a.severity === 'critical').length ?? 0;
  const initials = me.full_name
    .replace(/^(Dra?\.)\s/, '')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');

  const logout = async () => {
    await createClient().auth.signOut();
    clearSnapshot();
    router.replace('/login');
    router.refresh();
  };

  const askAi = () => {
    const question = service !== ALL_HOSPITAL && pathname.startsWith('/camas') ? `¿Cuál es la ocupación de ${prettyName(service)} hoy?` : (CONTEXT_QUESTION[pathname] ?? '');
    router.push(`/agente?q=${encodeURIComponent(question)}&n=${Date.now()}`);
  };

  const showBanner = !online || stale;

  return (
    <div className="flex min-h-screen">
      {menuOpen && <div onClick={() => setMenuOpen(false)} className="fixed inset-0 z-[60] bg-ink/50 lg:hidden" />}

      <aside
        className={cn(
          'fixed left-0 top-0 z-[70] h-screen w-[280px] max-w-[85vw] shrink-0 flex-col border-r border-line bg-white lg:sticky lg:flex',
          menuOpen ? 'flex' : 'hidden',
        )}
      >
        <div className="flex items-center gap-3 border-b border-line px-[22px] py-5">
          <span className="block size-11 shrink-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="Logo Hospital Susana López de Valencia" className="size-full object-contain" />
          </span>
          <div className="leading-snug">
            <div className="text-[15px] font-extrabold">Hospital Susana López</div>
            <div className="text-[13px] text-muted">de Valencia E.S.E.</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3.5" aria-label="Principal">
          {items.map((n) => {
            const active = n === current;
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setMenuOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-[11px] text-base no-underline hover:brightness-95',
                  active ? 'bg-navy font-bold text-white hover:text-white' : 'bg-white font-medium text-ink hover:text-ink',
                )}
              >
                <Icon name={n.icon} size={20} className="shrink-0" />
                <span className="flex-1">{n.label}</span>
                {n.href === '/alertas' && critical > 0 && (
                  <span
                    aria-label="alertas críticas"
                    className="flex h-6 min-w-[26px] items-center justify-center rounded-full border border-danger-line bg-danger-bg px-2 text-[13px] font-extrabold text-danger"
                  >
                    {critical}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col gap-3 border-t border-line px-[18px] py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-navy text-sm font-bold">{initials}</div>
            <div className="min-w-0 leading-snug">
              <div className="truncate text-[15px] font-bold">{me.full_name}</div>
              <div className="text-sm text-muted">{roleLabel}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-white px-3 text-[15px] font-semibold hover:border-leaf"
          >
            <Icon name="logout" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {showBanner && (
          <div role="status" className="flex items-center justify-center gap-2.5 border-b border-line bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
            <Icon name="offline" size={16} strokeWidth={2} />
            {stale && data ? `Sin conexión, datos del ${fmtDateTime(data.generated_at)}` : 'Sin conexión. Algunas funciones no están disponibles.'}
          </div>
        )}
        <header className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-3 sm:gap-4 sm:px-5 sm:py-3.5 lg:px-8">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
            className="flex size-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-white lg:hidden"
          >
            <Icon name="menu" size={22} strokeWidth={2} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[22px] font-extrabold leading-tight sm:text-[28px] tracking-tight">{current.label}</h1>
            <div className="mt-0.5 text-sm font-medium text-muted">{data ? `Datos al ${fmtDate(data.reference_date)}` : 'Cargando datos…'}</div>
          </div>
          <label className="relative -mr-1.5 flex items-center gap-1 text-[13px] font-semibold text-muted">
            <span>Servicio:</span>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="h-[34px] max-w-[220px] cursor-pointer appearance-none rounded-md border-0 bg-transparent pl-1.5 pr-[26px] text-sm font-bold text-navy hover:bg-slate-100"
            >
              <option value={ALL_HOSPITAL}>{ALL_HOSPITAL}</option>
              {services.map((s) => (
                <option key={s} value={s}>
                  {prettyName(s)}
                </option>
              ))}
            </select>
            <Icon name="chevron" size={14} strokeWidth={2.6} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-navy" />
          </label>
          {can('agent:query') && (
            <button
              type="button"
              onClick={askAi}
              aria-label="Preguntar a la IA"
              className="flex h-11 cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-leaf px-3 text-[15px] sm:px-5 font-bold text-white hover:bg-forest"
            >
              <Icon name="agente" />
              <span className="hidden sm:inline">Preguntar a la IA</span>
            </button>
          )}
        </header>

        <main className="w-full max-w-[1520px] flex-1 px-4 pb-12 pt-5 sm:px-5 sm:pt-7 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
