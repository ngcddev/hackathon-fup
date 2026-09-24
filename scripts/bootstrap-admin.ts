// Crea (o recrea) el primer usuario admin desde .env (AUT-06). Idempotente: se puede correr las veces
// que haga falta, también para recuperar el acceso si el admin queda bloqueado.
//
// Uso: npx tsx scripts/bootstrap-admin.ts
// Variables (.env.local, solo servidor; nunca NEXT_PUBLIC_):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   proyecto de Supabase
//   DATABASE_URL_APP_BACKEND                              conexión pg del rol app_backend
//   BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ADMIN_NAME
//
// Qué hace:
//   1. Si la cuenta de Auth no existe, la crea con el correo confirmado; si existe, le pone la contraseña del .env.
//   2. Deja su fila en core.user_profiles con rol admin y is_active = true.
//   3. Si el perfil es nuevo, registra la acción 'create' en audit.user_admin_log.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';

try {
  process.loadEnvFile('.env.local');
} catch {
  // sin .env.local: se usan las variables del entorno
}

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
  const email = required('BOOTSTRAP_ADMIN_EMAIL').trim().toLowerCase();
  const password = required('BOOTSTRAP_ADMIN_PASSWORD');
  const fullName = required('BOOTSTRAP_ADMIN_NAME').trim();
  const databaseUrl = required('DATABASE_URL_APP_BACKEND');

  if (password.length < 8) {
    console.error('BOOTSTRAP_ADMIN_PASSWORD debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let userId = await findUserIdByEmail(admin, email);
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (error) throw new Error(`No se pudo actualizar la cuenta: ${error.message}`);
    console.log(`Cuenta de Auth existente (${email}): contraseña restablecida desde .env.`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear la cuenta: ${error?.message ?? 'sin usuario'}`);
    userId = data.user.id;
    console.log(`Cuenta de Auth creada (${email}).`);
  }

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
    await db.query('BEGIN');
    const existing = await db.query('SELECT 1 FROM core.user_profiles WHERE user_id = $1', [userId]);
    await db.query(
      `INSERT INTO core.user_profiles (user_id, full_name, role, is_active, must_change_password)
       VALUES ($1, $2, 'admin', true, false)
       ON CONFLICT (user_id) DO UPDATE
         SET full_name = EXCLUDED.full_name, role = 'admin', is_active = true`,
      [userId, fullName],
    );
    if (existing.rowCount === 0) {
      await db.query(
        `INSERT INTO audit.user_admin_log (actor_user_id, target_user_id, action, new_value)
         VALUES ($1, $1, 'create', 'admin')`,
        [userId],
      );
    }
    await db.query('COMMIT');
    console.log(`Perfil admin ${existing.rowCount === 0 ? 'creado' : 'actualizado'} en core.user_profiles.`);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
  console.log('Listo. Inicia sesión con ese correo y contraseña.');
}

main().catch((error) => {
  console.error('FALLO:', error instanceof Error ? error.message : error);
  process.exit(1);
});
