// Proxy de Next.js 16 (antes "middleware"): exige sesión antes de llegar a páginas y endpoints (AUT-01)
// y renueva los tokens de Supabase en las cookies. Sin sesión: las páginas redirigen a /login y los
// endpoints responden 401 con el formato único.
//
// Esto es solo la primera barrera. El rol y is_active se verifican en cada controlador con
// withAuth (SEG-15): el proxy no consulta la base para no sumar latencia a cada recurso.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { API_ERROR_CATALOG } from '@/lib/api/errors';

const LOGIN_PATH = '/login';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // getClaims valida la firma del JWT (no confía en la cookie tal cual) y renueva el token si venció.
  const { data } = await supabase.auth.getClaims();
  const hasSession = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  // Desarrollo sin Supabase (AUTH_STUB): el controlador decide con el usuario falso.
  const stubbed = process.env.AUTH_STUB === 'true' && process.env.NODE_ENV !== 'production';

  if (!hasSession && !stubbed) {
    const rejected = pathname.startsWith('/api/')
      ? NextResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: API_ERROR_CATALOG.UNAUTHENTICATED.message } },
          { status: API_ERROR_CATALOG.UNAUTHENTICATED.status },
        )
      : pathname === LOGIN_PATH
        ? null
        : NextResponse.redirect(new URL(LOGIN_PATH, request.url));
    if (rejected) {
      response.cookies.getAll().forEach((cookie) => rejected.cookies.set(cookie));
      return rejected;
    }
  }

  if (hasSession && pathname === LOGIN_PATH) {
    const home = NextResponse.redirect(new URL('/', request.url));
    response.cookies.getAll().forEach((cookie) => home.cookies.set(cookie));
    return home;
  }

  return response;
}

export const config = {
  // Todo menos archivos estáticos e imágenes.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
