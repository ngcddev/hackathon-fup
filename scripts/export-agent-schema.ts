// Genera src/lib/agent/schema.generated.ts con el esquema que ve el LLM (AGE-02):
// vistas del esquema agent (columnas, tipos, COMMENT ON) y la lista real de servicios.
// El prompt nunca consulta la base en tiempo de ejecución: corre este script cuando cambien las vistas.
//
// Uso: npx tsx scripts/export-agent-schema.ts   (lee .env.local; usa DATABASE_URL_AGENT_RO)
// Con agent_ro el archivo solo contiene lo que el agente puede consultar de verdad.
// No importa src/lib/db (lleva 'server-only'): conecta con pg directo.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

try {
  process.loadEnvFile('.env.local');
} catch {
  // sin .env.local: se usan las variables del entorno
}

// Misma lista que AGENT_VIEWS de src/lib/types/api.ts (no se importa para no acoplar el script).
const VIEWS = [
  'v_admissions',
  'v_bed_occupancy',
  'v_emergency_wait_times',
  'v_drug_inventory',
  'v_drug_consumption_daily',
  'v_service_demand_daily',
  'v_surgeries',
  'v_diagnosis_monthly',
];

// Columnas categóricas de baja cardinalidad: se listan sus valores para que el LLM no los invente.
// Son dimensiones agregadas (clase de ingreso, grupo de edad...), nunca datos de una persona.
// Si una columna tiene más de MAX_VALUES valores distintos, no se incluye la lista.
const CATEGORICAL: Record<string, string[]> = {
  v_admissions: ['admission_class', 'admission_route', 'age_group', 'sex', 'regime', 'zone'],
  v_bed_occupancy: ['subservice'],
  v_emergency_wait_times: ['triage_classification', 'shift'],
  v_drug_inventory: ['item_type'],
  v_surgeries: ['data_origin'],
};
const MAX_VALUES = 15;

interface ColumnRow {
  view_name: string;
  view_comment: string | null;
  column_name: string;
  data_type: string;
  column_comment: string | null;
}

async function main() {
  const raw = process.env.DATABASE_URL_AGENT_RO;
  if (!raw) throw new Error('falta DATABASE_URL_AGENT_RO');
  const url = new URL(raw);
  url.searchParams.delete('sslmode');
  const client = new Client({
    connectionString: url.toString(),
    ssl: ['localhost', '127.0.0.1'].includes(url.hostname) ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  await client.connect();

  try {
    const { rows } = await client.query<ColumnRow>(
      `SELECT c.relname AS view_name,
              obj_description(c.oid, 'pg_class') AS view_comment,
              a.attname AS column_name,
              format_type(a.atttypid, a.atttypmod) AS data_type,
              col_description(c.oid, a.attnum) AS column_comment
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE n.nspname = 'agent' AND c.relkind IN ('v', 'm') AND c.relname = ANY($1)
       ORDER BY c.relname, a.attnum`,
      [VIEWS],
    );

    const views = [];
    for (const name of VIEWS) {
      const cols = rows.filter((r) => r.view_name === name);
      if (cols.length === 0) throw new Error(`la vista agent.${name} no existe o agent_ro no la ve`);
      const columns = [];
      for (const c of cols) {
        let values: string[] | undefined;
        if (CATEGORICAL[name]?.includes(c.column_name)) {
          try {
            const res = await client.query<{ v: string | null }>(
              `SELECT DISTINCT ${c.column_name}::text AS v FROM agent.${name} WHERE ${c.column_name} IS NOT NULL ORDER BY 1 LIMIT ${MAX_VALUES + 1}`,
            );
            if (res.rows.length <= MAX_VALUES) values = res.rows.map((r) => String(r.v));
          } catch (error) {
            console.warn(
              `AVISO  sin valores para ${name}.${c.column_name}:`,
              error instanceof Error ? error.message : error,
            );
          }
        }
        columns.push({
          name: c.column_name,
          type: c.data_type,
          comment: c.column_comment,
          ...(values ? { values } : {}),
        });
      }
      views.push({ name, comment: cols[0].view_comment, columns });
    }

    const services = await client.query<{ service: string }>(
      'SELECT DISTINCT service FROM agent.v_bed_occupancy WHERE service IS NOT NULL ORDER BY service',
    );

    const file =
      `// GENERADO por scripts/export-agent-schema.ts. No editar a mano: vuelve a correr el script.\n` +
      `// Fuente: vistas del esquema agent y COMMENT ON (rol agent_ro).\n\n` +
      `export interface SchemaColumn {\n  name: string;\n  type: string;\n  comment: string | null;\n  values?: string[];\n}\n\n` +
      `export interface SchemaView {\n  name: string;\n  comment: string | null;\n  columns: SchemaColumn[];\n}\n\n` +
      `export const AGENT_SCHEMA_VIEWS: SchemaView[] = [\n${views
        .map(
          (v) =>
            `  {\n    name: ${JSON.stringify(v.name)},\n    comment: ${JSON.stringify(v.comment)},\n    columns: [\n${v.columns
              .map((c) => `      ${JSON.stringify(c)},`)
              .join('\n')}\n    ],\n  },`,
        )
        .join('\n')}\n];\n\n` +
      `export const AGENT_SERVICES: string[] = ${JSON.stringify(services.rows.map((r) => r.service))};\n`;

    const target = resolve('src/lib/agent/schema.generated.ts');
    writeFileSync(target, file, 'utf8');
    console.log(
      `OK   ${views.length} vistas, ${views.reduce((n, v) => n + v.columns.length, 0)} columnas, ${services.rows.length} servicios → ${target}`,
    );
    console.log('Servicios:', services.rows.map((r) => r.service).join(' | '));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('FALLO  ', error instanceof Error ? error.message : error);
  process.exit(1);
});
