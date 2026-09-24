import 'server-only';
import type { PoolClient } from 'pg';
import { ApiError } from '@/lib/api/errors';
import { getAuthAdmin } from '@/lib/auth/admin-client';
import { isRole, type Role } from '@/lib/auth/permissions';
import { queryAsAppBackend } from '@/lib/db';
import { toInternalError } from '@/lib/db/errors';
import { getPool } from '@/lib/db/pools';
import type { AdminLogAction, UserSummary } from '@/lib/types/api';

interface ProfileRow {
  user_id: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: Date;
  created_by: string | null;
}

const PROFILE_COLUMNS = 'user_id, full_name, role, is_active, must_change_password, created_at, created_by';
const MIN_PASSWORD_LENGTH = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toSummary(profile: ProfileRow, email: string): UserSummary {
  return {
    user_id: profile.user_id,
    email,
    full_name: profile.full_name,
    role: profile.role,
    is_active: profile.is_active,
    must_change_password: profile.must_change_password,
    created_at: profile.created_at.toISOString(),
    created_by: profile.created_by,
  };
}

export function assertUserId(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new ApiError('VALIDATION_ERROR', 'El identificador de la cuenta no es válido.');
}

export function assertPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError('VALIDATION_ERROR', `La contraseña temporal debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  return value;
}

export function parseCreateUser(body: unknown): { full_name: string; email: string; role: Role; password: string } {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const fullName = typeof b.full_name === 'string' ? b.full_name.trim() : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (fullName.length === 0 || fullName.length > 120) {
    throw new ApiError('VALIDATION_ERROR', 'El nombre es obligatorio y debe tener máximo 120 caracteres.');
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new ApiError('VALIDATION_ERROR', 'El correo no es válido.');
  }
  if (!isRole(b.role)) throw new ApiError('VALIDATION_ERROR', 'El rol no es válido.');
  return { full_name: fullName, email, role: b.role, password: assertPassword(b.temporary_password) };
}

export function parseUpdateUser(body: unknown): { role?: Role; is_active?: boolean } {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const result: { role?: Role; is_active?: boolean } = {};
  if (b.role !== undefined) {
    if (!isRole(b.role)) throw new ApiError('VALIDATION_ERROR', 'El rol no es válido.');
    result.role = b.role;
  }
  if (b.is_active !== undefined) {
    if (typeof b.is_active !== 'boolean') throw new ApiError('VALIDATION_ERROR', 'is_active debe ser verdadero o falso.');
    result.is_active = b.is_active;
  }
  if (result.role === undefined && result.is_active === undefined) {
    throw new ApiError('VALIDATION_ERROR', 'Envía al menos un campo: role o is_active.');
  }
  return result;
}

async function emailsById(): Promise<Map<string, string>> {
  const admin = getAuthAdmin();
  const emails = new Map<string, string>();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw toInternalError('auth.listUsers', error);
    for (const u of data.users) if (u.email) emails.set(u.id, u.email);
    if (data.users.length < 200) break;
  }
  return emails;
}

async function emailOf(userId: string): Promise<string> {
  const { data, error } = await getAuthAdmin().auth.admin.getUserById(userId);
  if (error || !data.user) throw toInternalError('auth.getUserById', error);
  return data.user.email ?? '';
}

export async function listUsers(): Promise<UserSummary[]> {
  const [profiles, emails] = await Promise.all([
    queryAsAppBackend<ProfileRow>(`SELECT ${PROFILE_COLUMNS} FROM core.user_profiles ORDER BY created_at ASC`),
    emailsById(),
  ]);
  return profiles.map((p) => toSummary(p, emails.get(p.user_id) ?? ''));
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool('app_backend').connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    if (error instanceof ApiError) throw error;
    // El trigger de core.user_profiles avisa con P0001 cuando el cambio dejaría cero admins activos.
    if ((error as { code?: string }).code === 'P0001') throw new ApiError('LAST_ADMIN_REQUIRED');
    throw toInternalError('users.transaction', error);
  } finally {
    client.release(broken || undefined);
  }
}

function logAction(
  client: PoolClient,
  actorId: string,
  targetId: string,
  action: AdminLogAction,
  oldValue: string | null,
  newValue: string | null,
) {
  return client.query(
    `INSERT INTO audit.user_admin_log (actor_user_id, target_user_id, action, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, targetId, action, oldValue, newValue],
  );
}

export async function createUser(
  actorId: string,
  input: { full_name: string; email: string; role: Role; password: string },
): Promise<UserSummary> {
  const admin = getAuthAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !data.user) {
    if (error?.code === 'email_exists' || /already|registered/i.test(error?.message ?? '')) {
      throw new ApiError('VALIDATION_ERROR', 'Ya existe una cuenta con ese correo.');
    }
    throw toInternalError('auth.createUser', error);
  }
  const userId = data.user.id;
  try {
    const profile = await withTransaction(async (client) => {
      const { rows } = await client.query<ProfileRow>(
        `INSERT INTO core.user_profiles (user_id, full_name, role, is_active, must_change_password, created_by)
         VALUES ($1, $2, $3, true, true, $4)
         RETURNING ${PROFILE_COLUMNS}`,
        [userId, input.full_name, input.role, actorId],
      );
      await logAction(client, actorId, userId, 'create', null, input.role);
      return rows[0];
    });
    return toSummary(profile, input.email);
  } catch (err) {
    // Sin perfil la cuenta de Auth queda huérfana: se borra para poder reintentar con el mismo correo.
    await admin.auth.admin.deleteUser(userId).catch((e) => console.error('[users] No se pudo deshacer la cuenta de Auth:', e));
    throw err;
  }
}

export async function updateUser(
  actorId: string,
  userId: string,
  changes: { role?: Role; is_active?: boolean },
): Promise<UserSummary> {
  const profile = await withTransaction(async (client) => {
    const { rows } = await client.query<ProfileRow>(
      `SELECT ${PROFILE_COLUMNS} FROM core.user_profiles WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const current = rows[0];
    if (!current) throw new ApiError('NOT_FOUND', 'La cuenta no existe.');

    const newRole = changes.role ?? current.role;
    const newActive = changes.is_active ?? current.is_active;
    const losesAdmin = current.role === 'admin' && current.is_active && (newRole !== 'admin' || !newActive);
    if (userId === actorId && losesAdmin) throw new ApiError('SELF_MODIFICATION_NOT_ALLOWED');

    const { rows: updated } = await client.query<ProfileRow>(
      `UPDATE core.user_profiles SET role = $2, is_active = $3 WHERE user_id = $1 RETURNING ${PROFILE_COLUMNS}`,
      [userId, newRole, newActive],
    );
    if (newRole !== current.role) await logAction(client, actorId, userId, 'role_change', current.role, newRole);
    if (newActive !== current.is_active) {
      await logAction(client, actorId, userId, newActive ? 'reactivate' : 'deactivate', null, null);
    }
    return updated[0];
  });
  return toSummary(profile, await emailOf(userId));
}

export async function resetPassword(actorId: string, userId: string, password: string): Promise<UserSummary> {
  const profile = await withTransaction(async (client) => {
    const { rows } = await client.query<ProfileRow>(
      `UPDATE core.user_profiles SET must_change_password = true WHERE user_id = $1 RETURNING ${PROFILE_COLUMNS}`,
      [userId],
    );
    if (!rows[0]) throw new ApiError('NOT_FOUND', 'La cuenta no existe.');
    const { error } = await getAuthAdmin().auth.admin.updateUserById(userId, { password });
    if (error) throw toInternalError('auth.updateUserById', error);
    await logAction(client, actorId, userId, 'password_reset', null, null);
    return rows[0];
  });
  return toSummary(profile, await emailOf(userId));
}
