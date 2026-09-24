import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const getClaims = vi.fn();
const queryAsAppBackend = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims } }),
}));
vi.mock('@/lib/db', () => ({ queryAsAppBackend }));

const { withAuth } = await import('./with-auth');

const request = {} as NextRequest;
const routeContext = { params: Promise.resolve({}) };
const handler = vi.fn(async (_req: NextRequest, ctx: { user: { role: string } }) =>
  Response.json({ role: ctx.user.role }),
);

async function call(permission: Parameters<typeof withAuth>[0]) {
  const response = await withAuth(permission, handler)(request, routeContext);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const session = (sub = 'user-1') => getClaims.mockResolvedValue({ data: { claims: { sub } }, error: null });
const profile = (row: { full_name?: string; role: string; is_active?: boolean }) =>
  queryAsAppBackend.mockResolvedValue([{ full_name: 'Ana Pérez', is_active: true, ...row }]);

beforeEach(() => {
  vi.stubEnv('AUTH_STUB', '');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('withAuth: sesión real', () => {
  it('sin sesión → 401 UNAUTHENTICATED y no toca la base', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const { status, body } = await call('dashboard:view');
    expect(status).toBe(401);
    expect(body).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });
    expect(queryAsAppBackend).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('token inválido (error de getClaims) → 401', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('jwt malformed') });
    expect((await call('dashboard:view')).status).toBe(401);
  });

  it('cuenta desactivada → 403 ACCOUNT_DISABLED aunque el token sea válido (AUT-05)', async () => {
    session();
    profile({ role: 'admin', is_active: false });
    const { status, body } = await call('dashboard:view');
    expect(status).toBe(403);
    expect(body).toMatchObject({ error: { code: 'ACCOUNT_DISABLED' } });
  });

  it('sesión sin perfil en core.user_profiles → 403 ACCOUNT_DISABLED', async () => {
    session();
    queryAsAppBackend.mockResolvedValue([]);
    expect((await call(null)).body).toMatchObject({ error: { code: 'ACCOUNT_DISABLED' } });
  });

  it('rol desconocido en la base → 403 (falla cerrado)', async () => {
    session();
    profile({ role: 'superuser' });
    expect((await call(null)).status).toBe(403);
  });

  it('rol sin el permiso → 403 FORBIDDEN', async () => {
    session();
    profile({ role: 'director' });
    const { status, body } = await call('users:manage');
    expect(status).toBe(403);
    expect(body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('con permiso: el handler recibe el rol de la base, no del token', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'u', user_metadata: { role: 'admin' } } }, error: null });
    profile({ role: 'medic' });
    const { status, body } = await call('agent:query');
    expect(status).toBe(200);
    expect(body).toEqual({ role: 'medic' });
    expect(queryAsAppBackend).toHaveBeenCalledWith(expect.stringContaining('core.user_profiles'), ['u']);
  });

  it('permiso null exige solo sesión', async () => {
    session();
    profile({ role: 'director' });
    expect((await call(null)).status).toBe(200);
  });

  it('un error de la base no se filtra: 500 genérico', async () => {
    session();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    queryAsAppBackend.mockRejectedValue(new Error('relation "core.user_profiles" does not exist'));
    const { status, body } = await call(null);
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('user_profiles');
  });
});

describe('withAuth: AUTH_STUB', () => {
  it('con AUTH_STUB=true fuera de producción usa el usuario falso', async () => {
    vi.stubEnv('AUTH_STUB', 'true');
    vi.stubEnv('AUTH_STUB_ROLE', 'admin');
    vi.stubEnv('NODE_ENV', 'development');
    expect((await call('users:manage')).status).toBe(200);
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('en producción se ignora y exige sesión', async () => {
    vi.stubEnv('AUTH_STUB', 'true');
    vi.stubEnv('AUTH_STUB_ROLE', 'admin');
    vi.stubEnv('NODE_ENV', 'production');
    getClaims.mockResolvedValue({ data: null, error: null });
    expect((await call('users:manage')).status).toBe(401);
  });

  it('con rol de stub inválido falla cerrado', async () => {
    vi.stubEnv('AUTH_STUB', 'true');
    vi.stubEnv('AUTH_STUB_ROLE', 'root');
    vi.stubEnv('NODE_ENV', 'development');
    expect((await call(null)).status).toBe(401);
  });
});
