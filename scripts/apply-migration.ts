export {};
// Aplica un archivo de supabase/migrations con la conexión de la carga histórica
// (HIS_LOAD_DATABASE_URL, solo en tu máquina), dentro de una transacción.
// Uso: npx tsx scripts/apply-migration.ts supabase/migrations/<archivo>.sql
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

try {
  process.loadEnvFile('.env.local');
} catch {
  // sin .env.local: se usan las variables del entorno
}

async function main() {
  const file = process.argv[2];
  const url = process.env.HIS_LOAD_DATABASE_URL;
  if (!file || !url) {
    console.error('Uso: npx tsx scripts/apply-migration.ts <archivo.sql> (requiere HIS_LOAD_DATABASE_URL)');
    process.exit(1);
  }
  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');
  const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  const client = new Client({
    connectionString: parsed.toString(),
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(readFileSync(file, 'utf8'));
    await client.query('COMMIT');
    console.log(`Migración aplicada: ${file}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
