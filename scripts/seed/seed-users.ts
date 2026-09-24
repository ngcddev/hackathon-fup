// Crea (o actualiza) un usuario demo por rol: director, service_head y medic. El admin sale de
// scripts/bootstrap-admin.ts. Idempotente: se puede correr las veces que haga falta.
//
// Uso: npx tsx scripts/seed/seed-users.ts
// Variables (.env.local, solo servidor; nunca NEXT_PUBLIC_):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   proyecto de Supabase
//   DATABASE_URL_APP_BACKEND                              conexión pg del rol app_backend
//   SEED_<ROL>_EMAIL, SEED_<ROL>_PASSWORD, SEED_<ROL>_NAME   con <ROL> = DIRECTOR, SERVICE_HEAD o MEDIC
//
// Qué hace, por cada rol:
//   1. Si la cuenta de Auth no existe, la crea con el correo confirmado; si existe, le pone la contraseña del .env.
//   2. Deja su fila en core.user_profiles con ese rol, is_active = true y must_change_password = false.
//   3. Si el perfil es nuevo, registra la acción 'create' en audit.user_admin_log.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';

try {
  process.loadEnvFile('.env.local');
} catch {
  // sin .env.local: se usan las variables del entorno
}

const SEED_ROLES = ['director', 'service_head', 'medic'] as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta la variable ${name} en .env.local.`);
    process.exit(1);
  }
  return value;
}

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`No se pudo listar usuarios: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  const url = required('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const databaseUrl = required('DATABASE_URL_APP_BACKEND');

  const accounts = SEED_ROLES.map((role) => {
    const prefix = `SEED_${role.toUpperCase()}`;
    return {
      role,
      email: required(`${prefix}_EMAIL`).trim().toLowerCase(),
      password: required(`${prefix}_PASSWORD`),
      fullName: required(`${prefix}_NAME`).trim(),
    };
  });
  for (const { role, password } of accounts) {
    if (password.length < 8) {
      console.error(`SEED_${role.toUpperCase()}_PASSWORD debe tener al menos 8 caracteres.`);
      process.exit(1);
    }
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = new Client({
    connectionString: (() => {
      const u = new URL(databaseUrl);
      u.searchParams.delete('sslmode');
      return u.toString();
    })(),
    ssl: ['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname) ? false : { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    for (const { role, email, password, fullName } of accounts) {
      let userId = await findUserIdByEmail(admin, email);
      if (userId) {
        const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
        if (error) throw new Error(`No se pudo actualizar la cuenta ${email}: ${error.message}`);
        console.log(`[${role}] Cuenta de Auth existente (${email}): contraseña restablecida desde .env.`);
      } else {
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error || !data.user)
          throw new Error(`No se pudo crear la cuenta ${email}: ${error?.message ?? 'sin usuario'}`);
        userId = data.user.id;
        console.log(`[${role}] Cuenta de Auth creada (${email}).`);
      }

      try {
        await db.query('BEGIN');
        const existing = await db.query('SELECT 1 FROM core.user_profiles WHERE user_id = $1', [userId]);
        await db.query(
          `INSERT INTO core.user_profiles (user_id, full_name, role, is_active, must_change_password)
           VALUES ($1, $2, $3, true, false)
           ON CONFLICT (user_id) DO UPDATE
             SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, is_active = true`,
          [userId, fullName, role],
        );
        if (existing.rowCount === 0) {
          await db.query(
            `INSERT INTO audit.user_admin_log (actor_user_id, target_user_id, action, new_value)
             VALUES ($1, $1, 'create', $2)`,
            [userId, role],
          );
        }
        await db.query('COMMIT');
        console.log(`[${role}] Perfil ${existing.rowCount === 0 ? 'creado' : 'actualizado'} en core.user_profiles.`);
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await db.end();
  }
  console.log('Listo. Cada usuario inicia sesión con su correo y contraseña.');
}

main().catch((error) => {
  console.error('FALLO:', error instanceof Error ? error.message : error);
  process.exit(1);
});
