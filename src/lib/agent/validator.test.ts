import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAN_B } from './plan-b';
import { validateAstOnlyForTests, validateSql } from './validator';

const OK_BASE = 'SELECT service FROM agent.v_admissions';

async function expectRejected(sql: string) {
  const result = await validateSql(sql);
  expect(result.ok, `debía rechazarse: ${sql}`).toBe(false);
}

// Las mismas consultas, solo con el parser (sin la regex): la segunda capa no debe ser la única defensa.
async function expectRejectedByParser(sql: string) {
  const result = await validateAstOnlyForTests(sql);
  expect(result.ok, `el parser debía rechazar: ${sql}`).toBe(false);
}

describe('validateSql: rechazos (SEG-01, SEG-03)', () => {
  const cases: Record<string, string> = {
    'dos sentencias con punto y coma': `${OK_BASE}; SELECT 1`,
    'punto y coma escondido en un comentario': `${OK_BASE} /* ; DROP TABLE core.patients */ LIMIT 5`,
    'punto y coma en comentario de línea': `${OK_BASE} -- ; DELETE\nLIMIT 5`,
    'DELETE dentro de un CTE': `WITH d AS (DELETE FROM core.patients RETURNING *) SELECT * FROM d`,
    'INSERT dentro de un CTE': `WITH i AS (INSERT INTO core.patients DEFAULT VALUES RETURNING *) SELECT * FROM i`,
    'SELECT INTO': `SELECT service INTO tmp_copy FROM agent.v_admissions`,
    pg_sleep: `SELECT pg_sleep(10) FROM agent.v_admissions`,
    'pg_catalog.pg_tables': `SELECT * FROM pg_catalog.pg_tables`,
    'information_schema.columns': `SELECT * FROM information_schema.columns`,
    'core.patients': `SELECT * FROM core.patients`,
    set_config: `SELECT set_config('statement_timeout', '0', false) FROM agent.v_admissions`,
    current_setting: `SELECT current_setting('server_version') FROM agent.v_admissions`,
    COPY: `COPY agent.v_admissions TO STDOUT`,
    'FOR UPDATE': `${OK_BASE} FOR UPDATE`,
    'FOR SHARE': `${OK_BASE} FOR SHARE`,
    CURRENT_DATE: `SELECT service FROM agent.v_admissions WHERE admitted_at >= CURRENT_DATE`,
    'now()': `SELECT service FROM agent.v_admissions WHERE admitted_at >= now()`,
    current_timestamp: `SELECT service FROM agent.v_admissions WHERE admitted_at >= current_timestamp`,
    dblink: `SELECT * FROM dblink('host=x', 'select 1') AS t(a int)`,
    lo_import: `SELECT lo_import('/etc/passwd') FROM agent.v_admissions`,
    UPDATE: `UPDATE agent.v_admissions SET service = 'x'`,
    'DROP TABLE': `DROP TABLE core.patients`,
    'tabla sin esquema': `SELECT * FROM v_admissions`,
    'otra vista de agent no listada': `SELECT * FROM agent.v_secret`,
    'sintaxis inválida (falla cerrado)': `SELEC service FRM agent.v_admissions`,
    'consulta vacía': `   `,
    'función fuera de la lista blanca': `SELECT upper(service), md5(service) FROM agent.v_admissions`,
    'función de sistema sin prefijo pg_': `SELECT txid_current() FROM agent.v_admissions`,
    'función en FROM': `SELECT * FROM generate_series(1, 10)`,
    'cast a regclass': `SELECT 'core.patients'::regclass FROM agent.v_admissions`,
    'patient_key con alias': `SELECT patient_key AS id FROM agent.v_admissions`,
    parámetros: `SELECT service FROM agent.v_admissions WHERE service = $1`,
  };
  for (const [name, sql] of Object.entries(cases)) {
    it(name, () => expectRejected(sql));
  }

  // Casos que la segunda capa (regex) cubre y el parser también debe cubrir por sí solo.
  const parserOnly: Record<string, string> = {
    'dos sentencias': `${OK_BASE}; SELECT 1`,
    'DELETE dentro de un CTE': `WITH d AS (DELETE FROM core.patients RETURNING *) SELECT * FROM d`,
    'SELECT INTO': `SELECT service INTO tmp_copy FROM agent.v_admissions`,
    pg_sleep: `SELECT pg_sleep(10) FROM agent.v_admissions`,
    'pg_catalog.pg_tables': `SELECT * FROM pg_catalog.pg_tables`,
    'information_schema.columns': `SELECT * FROM information_schema.columns`,
    'core.patients': `SELECT * FROM core.patients`,
    set_config: `SELECT set_config('statement_timeout', '0', false) FROM agent.v_admissions`,
    COPY: `COPY agent.v_admissions TO STDOUT`,
    'FOR UPDATE': `${OK_BASE} FOR UPDATE`,
    CURRENT_DATE: `SELECT service FROM agent.v_admissions WHERE admitted_at >= CURRENT_DATE`,
    'now()': `SELECT service FROM agent.v_admissions WHERE admitted_at >= now()`,
  };
  for (const [name, sql] of Object.entries(parserOnly)) {
    it(`solo parser: ${name}`, () => expectRejectedByParser(sql));
  }
});

describe('validateSql: LIMIT (SEG-02)', () => {
  it('LIMIT 10000 queda en 200', async () => {
    const result = await validateSql(`${OK_BASE} ORDER BY service LIMIT 10000`);
    expect(result).toMatchObject({ ok: true, limitApplied: true });
    if (result.ok) {
      expect(result.sql).toMatch(/LIMIT 200\b/i);
      expect(result.sql).toMatch(/ORDER BY/i); // no se envolvió la consulta
      expect(result.sql).not.toMatch(/10000/);
    }
  });

  it('sin LIMIT queda en 200', async () => {
    const result = await validateSql(`${OK_BASE} ORDER BY service`);
    expect(result).toMatchObject({ ok: true, limitApplied: true });
    if (result.ok) expect(result.sql).toMatch(/ORDER BY[\s\S]*LIMIT 200\b/i);
  });

  it('LIMIT ALL queda en 200', async () => {
    const result = await validateSql(`${OK_BASE} LIMIT ALL`);
    expect(result).toMatchObject({ ok: true, limitApplied: true });
  });

  it('FETCH FIRST ... WITH TIES queda en 200 sin empates', async () => {
    const result = await validateSql(`${OK_BASE} ORDER BY service FETCH FIRST 5 ROWS WITH TIES`);
    expect(result).toMatchObject({ ok: true, limitApplied: true });
    if (result.ok) expect(result.sql).not.toMatch(/WITH TIES/i);
  });

  it('LIMIT válido no se toca', async () => {
    const sql = `${OK_BASE} ORDER BY service LIMIT 10`;
    const result = await validateSql(sql);
    expect(result).toEqual({ ok: true, sql, viewsUsed: ['v_admissions'], limitApplied: false });
  });

  it('un punto y coma final se acepta y se quita', async () => {
    const result = await validateSql(`${OK_BASE} LIMIT 5;`);
    expect(result).toMatchObject({ ok: true, sql: `${OK_BASE} LIMIT 5` });
  });

  it('el SQL regenerado sigue siendo válido con funciones y CTE', async () => {
    const sql = `WITH t AS (SELECT service, EXTRACT(DAY FROM agent.reference_date())::int AS d FROM agent.v_admissions)
                 SELECT service, COUNT(*) FILTER (WHERE d > 1) AS n FROM t GROUP BY service ORDER BY n DESC`;
    const result = await validateSql(sql);
    expect(result).toMatchObject({ ok: true, limitApplied: true, viewsUsed: ['v_admissions'] });
  });
});

describe('validateSql: consultas permitidas', () => {
  it('CTE WITH ... SELECT sobre una vista de agent', async () => {
    const result = await validateSql(
      `WITH a AS (SELECT service FROM agent.v_admissions) SELECT service FROM a LIMIT 5`,
    );
    expect(result).toMatchObject({ ok: true, viewsUsed: ['v_admissions'] });
  });

  it('UNION entre vistas de agent', async () => {
    const result = await validateSql(
      `SELECT service FROM agent.v_admissions UNION ALL SELECT service FROM agent.v_bed_occupancy LIMIT 5`,
    );
    expect(result).toMatchObject({ ok: true });
  });

  it('un CTE no puede colarse fuera de su alcance', async () => {
    await expectRejected(`SELECT * FROM (WITH t AS (SELECT service FROM agent.v_admissions) SELECT * FROM t) x, t`);
  });

  it('un CTE con el nombre de una tabla del sistema no da acceso a ella', async () => {
    await expectRejected(`SELECT * FROM agent.v_admissions a, pg_class`);
  });
});

describe('las 4 consultas de demo_reference.sql (y las del plan B) pasan sin cambios', () => {
  const file = readFileSync(join(process.cwd(), 'supabase/tests/demo_reference.sql'), 'utf8');
  const blocks = file
    .split(/^-- Q\d.*$/m)
    .slice(1)
    .map((b) =>
      b
        .replace(/^--.*$/gm, '')
        .trim()
        .replace(/;\s*$/, ''),
    );

  it('el archivo trae 4 consultas', () => expect(blocks).toHaveLength(4));

  blocks.forEach((sql, i) => {
    it(`Q${i + 1} pasa y no se modifica`, async () => {
      const result = await validateSql(sql);
      expect(result).toMatchObject({ ok: true, limitApplied: false });
      if (result.ok) expect(result.sql).toBe(sql);
    });
  });

  it('el SQL de las 4 primeras entradas del plan B es idéntico al de demo_reference.sql', () => {
    const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
    PLAN_B.slice(0, 4).forEach((entry, i) => {
      expect(squash(entry.sql)).toBe(squash(blocks[i]));
    });
  });

  PLAN_B.forEach((entry) => {
    it(`plan B "${entry.id}" pasa el validador y declara sus vistas`, async () => {
      const result = await validateSql(entry.sql);
      expect(result).toMatchObject({ ok: true, limitApplied: false });
      if (result.ok) expect([...result.viewsUsed].sort()).toEqual([...entry.views_used].sort());
    });
  });
});
