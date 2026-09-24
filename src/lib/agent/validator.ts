// Validador de SQL del agente (AGE-03, SEG-01, SEG-02, SEG-03). FALLA CERRADO.
//
// Capas:
//   1. Parser real de Postgres (libpg-query compilado a WASM): una sola sentencia SELECT.
//   2. Recorrido del árbol con lista blanca de nodos, vistas del esquema agent y funciones.
//   3. LIMIT forzado a 200 modificando el árbol (sin envolver la consulta, para no perder ORDER BY).
//   4. Revisión por expresiones regulares sobre el texto original (defensa en profundidad).
// El motivo del rechazo (`reason`) es solo para el log del servidor: nunca sale al cliente.

import { deparseSync, loadModule, parseSync } from '@libpg-query/parser';
import { AGENT_VIEWS, type AgentView } from '../types/api';

export const MAX_LIMIT = 200;

export type ValidationResult =
  { ok: true; sql: string; viewsUsed: AgentView[]; limitApplied: boolean } | { ok: false; reason: string };

type Json = unknown;
type JsonObject = Record<string, Json>;

const VIEW_SET: ReadonlySet<string> = new Set(AGENT_VIEWS);

// ------------------------------------------------------------------ Listas blancas

// Nodos del árbol que una consulta de solo lectura del agente puede contener.
// Cualquier otro (InsertStmt, CopyStmt, RangeFunction, SQLValueFunction, LockingClause...) se rechaza.
const ALLOWED_NODES: ReadonlySet<string> = new Set([
  'SelectStmt',
  'ResTarget',
  'ColumnRef',
  'A_Const',
  'A_Expr',
  'A_Star',
  'A_ArrayExpr',
  'BoolExpr',
  'RowExpr',
  'FuncCall',
  'TypeCast',
  'TypeName',
  'CaseExpr',
  'CaseWhen',
  'CoalesceExpr',
  'MinMaxExpr',
  'NullTest',
  'BooleanTest',
  'SubLink',
  'RangeVar',
  'RangeSubselect',
  'JoinExpr',
  'Alias',
  'SortBy',
  'WindowDef',
  'WithClause',
  'CommonTableExpr',
  'GroupingSet',
  'GroupingFunc',
  'String',
  'Integer',
  'Float',
  'Boolean',
  'BitString',
  'List',
]);

// Funciones integradas permitidas (agregaciones, ventanas, fechas, texto y matemáticas básicas).
// El analizador de Postgres reescribe EXTRACT, TRIM, POSITION, etc. como pg_catalog.<nombre>.
const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  // agregaciones
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'stddev',
  'variance',
  'bool_and',
  'bool_or',
  'every',
  'string_agg',
  'array_agg',
  'percentile_cont',
  'percentile_disc',
  'mode',
  // ventanas
  'row_number',
  'rank',
  'dense_rank',
  'percent_rank',
  'ntile',
  'lag',
  'lead',
  'first_value',
  'last_value',
  'nth_value',
  // fechas
  'date_trunc',
  'date_part',
  'extract',
  'age',
  'to_char',
  'to_date',
  'make_date',
  'timezone',
  // texto
  'lower',
  'upper',
  'initcap',
  'length',
  'char_length',
  'substr',
  'substring',
  'trim',
  'btrim',
  'ltrim',
  'rtrim',
  'replace',
  'concat',
  'concat_ws',
  'left',
  'right',
  'split_part',
  'position',
  'strpos',
  'lpad',
  'rpad',
  'translate',
  'overlay',
  // matemáticas
  'round',
  'ceil',
  'ceiling',
  'floor',
  'abs',
  'trunc',
  'sign',
  'mod',
  'power',
  'sqrt',
  'ln',
  'log',
  'exp',
  'div',
]);

const REFERENCE_DATE_FN = ['agent', 'reference_date'] as const;

// Tipos a los que se puede convertir con ::tipo (excluye regclass, oid, regproc, etc.).
const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'int',
  'int2',
  'int4',
  'int8',
  'integer',
  'smallint',
  'bigint',
  'numeric',
  'decimal',
  'float',
  'float4',
  'float8',
  'real',
  'double precision',
  'text',
  'varchar',
  'bpchar',
  'char',
  'character varying',
  'character',
  'date',
  'timestamp',
  'timestamptz',
  'time',
  'interval',
  'bool',
  'boolean',
]);

// ------------------------------------------------------------------ Revisión por regex

interface DenyRule {
  pattern: RegExp;
  reason: string;
}

// Se aplica al texto original, comentarios incluidos: ante la duda, se rechaza.
const DENY_RULES: DenyRule[] = [
  { pattern: /;/, reason: 'punto y coma dentro de la consulta' },
  { pattern: /\bpg_\w*/i, reason: 'función o catálogo pg_*' },
  { pattern: /\binformation_schema\b/i, reason: 'information_schema' },
  { pattern: /\b(set_config|current_setting)\b/i, reason: 'set_config/current_setting' },
  { pattern: /\bdblink\w*/i, reason: 'dblink' },
  { pattern: /\blo_\w+/i, reason: 'funciones lo_*' },
  { pattern: /\bcopy\b/i, reason: 'COPY' },
  { pattern: /\binto\b/i, reason: 'SELECT INTO' },
  { pattern: /\bfor\s+(no\s+key\s+update|key\s+share|update|share)\b/i, reason: 'FOR UPDATE/SHARE' },
  {
    pattern: /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|vacuum)\b/i,
    reason: 'sentencia que no es SELECT',
  },
  {
    pattern:
      /\b(current_date|current_time|current_timestamp|localtime|localtimestamp|now|clock_timestamp|statement_timestamp|transaction_timestamp|timeofday)\b/i,
    reason: 'fecha del sistema: debe usarse agent.reference_date()',
  },
  {
    pattern: /\b(current_user|current_role|current_schema|current_catalog|session_user)\b|\bversion\s*\(/i,
    reason: 'funciones de sesión',
  },
  { pattern: /\b(core|audit|staging|auth)\s*\./i, reason: 'esquema distinto de agent' },
];

// ------------------------------------------------------------------ Recorrido del árbol

class Rejection extends Error {}
function reject(reason: string): never {
  throw new Rejection(reason);
}

function isObject(value: Json): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(nodes: Json): string[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((n) => {
    const s = isObject(n) && isObject(n.String) ? n.String.sval : undefined;
    return typeof s === 'string' ? s.toLowerCase() : '';
  });
}

interface WalkState {
  views: Set<AgentView>;
}

function checkFuncCall(node: JsonObject): void {
  const name = stringList(node.funcname);
  if (name.length === 0 || name.includes('')) reject('función sin nombre reconocible');
  if (name.length === 2 && name[0] === REFERENCE_DATE_FN[0] && name[1] === REFERENCE_DATE_FN[1]) {
    return;
  }
  const bare = name.length === 1 ? name[0] : name.length === 2 && name[0] === 'pg_catalog' ? name[1] : null;
  if (bare === null || !ALLOWED_FUNCTIONS.has(bare)) {
    reject(`función no permitida: ${name.join('.')}`);
  }
}

function checkTypeName(node: JsonObject): void {
  const names = stringList(node.names);
  const last = names[names.length - 1];
  if (!last || !ALLOWED_TYPES.has(last)) reject(`tipo no permitido: ${names.join('.')}`);
  if (node.setof) reject('tipo SETOF');
}

function checkRangeVar(node: JsonObject, scope: ReadonlySet<string>, state: WalkState): void {
  const relname = typeof node.relname === 'string' ? node.relname : '';
  if (node.catalogname) reject('catálogo explícito en la tabla');
  if (node.schemaname === undefined) {
    // Sin esquema solo se admite el nombre de un CTE visible en este punto.
    if (!scope.has(relname)) reject(`tabla sin esquema que no es un CTE: ${relname}`);
    return;
  }
  if (node.schemaname !== 'agent') reject(`esquema no permitido: ${String(node.schemaname)}`);
  if (!VIEW_SET.has(relname)) reject(`vista fuera de la lista blanca: agent.${relname}`);
  state.views.add(relname as AgentView);
}

function checkResTarget(node: JsonObject): void {
  // patient_key con otro alias escaparía del filtro por nombre de columna.
  const val = node.val;
  if (isObject(val) && isObject(val.ColumnRef) && typeof node.name === 'string') {
    const fields = stringList(val.ColumnRef.fields);
    if (fields[fields.length - 1] === 'patient_key' && node.name.toLowerCase() !== 'patient_key') {
      reject('patient_key con alias');
    }
  }
}

// Campos que el parser entrega como estructura sin envoltorio { Nodo: {...} }.
const FIELD_KIND: Readonly<Record<string, string>> = {
  larg: 'SelectStmt',
  rarg: 'SelectStmt',
  typeName: 'TypeName',
};

function walk(value: Json, scope: ReadonlySet<string>, state: WalkState): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, scope, state);
    return;
  }
  if (!isObject(value)) return;

  for (const [field, child] of Object.entries(value)) {
    // Los nodos vienen como { NombreDelNodo: {...} }; los campos empiezan en minúscula.
    const wrapped = /^[A-Z]/.test(field) && isObject(child);
    const key = wrapped ? field : FIELD_KIND[field];
    if (key === undefined || !isObject(child)) {
      walk(child, scope, state);
      continue;
    }
    if (!ALLOWED_NODES.has(key)) reject(`nodo no permitido: ${key}`);

    let childScope = scope;
    switch (key) {
      case 'SelectStmt': {
        if (child.intoClause) reject('SELECT INTO');
        if (child.lockingClause) reject('FOR UPDATE/SHARE');
        const withClause = child.withClause;
        if (isObject(withClause) && Array.isArray(withClause.ctes)) {
          const names = new Set(scope);
          for (const cte of withClause.ctes) {
            const body = isObject(cte) ? cte.CommonTableExpr : undefined;
            if (isObject(body) && typeof body.ctename === 'string') names.add(body.ctename);
          }
          childScope = names;
        }
        break;
      }
      case 'CommonTableExpr': {
        const query = child.ctequery;
        if (!isObject(query) || !isObject(query.SelectStmt)) reject('CTE que no es SELECT');
        break;
      }
      case 'RangeVar':
        checkRangeVar(child, scope, state);
        break;
      case 'FuncCall':
        checkFuncCall(child);
        break;
      case 'TypeName':
        checkTypeName(child);
        break;
      case 'A_Expr': {
        // OPERATOR(pg_catalog.+) y similares traen el nombre calificado.
        if (Array.isArray(child.name) && child.name.length > 1) reject('operador calificado');
        break;
      }
      case 'ResTarget':
        checkResTarget(child);
        break;
      default:
        break;
    }
    walk(child, childScope, state);
  }
}

// ------------------------------------------------------------------ LIMIT

function limitConstant(limitCount: Json): number | null {
  if (!isObject(limitCount) || !isObject(limitCount.A_Const)) return null;
  const ival = limitCount.A_Const.ival;
  if (isObject(ival) && typeof ival.ival === 'number') return ival.ival;
  // LIMIT 0: el parser omite el campo ival
  if (isObject(ival)) return 0;
  return null;
}

// Fija el LIMIT del SELECT de nivel superior. Devuelve true si tuvo que modificarlo.
function enforceLimit(select: JsonObject): boolean {
  const current = limitConstant(select.limitCount);
  const withTies = select.limitOption === 'LIMIT_OPTION_WITH_TIES';
  if (current !== null && current <= MAX_LIMIT && !withTies) return false;
  select.limitCount = { A_Const: { ival: { ival: MAX_LIMIT }, location: 0 } };
  select.limitOption = 'LIMIT_OPTION_COUNT';
  return true;
}

// ------------------------------------------------------------------ Punto de entrada

let moduleReady: Promise<void> | undefined;
function ensureParser(): Promise<void> {
  moduleReady ??= loadModule();
  return moduleReady;
}

function parseSingleSelect(sql: string): { tree: ReturnType<typeof parseSync>; select: JsonObject } {
  const tree = parseSync(sql);
  const stmts = tree.stmts ?? [];
  if (stmts.length !== 1) reject('la consulta no tiene exactamente una sentencia');
  const stmt: Json = stmts[0].stmt;
  if (!isObject(stmt) || !isObject(stmt.SelectStmt)) reject('la sentencia no es SELECT');
  return { tree, select: (stmt as JsonObject).SelectStmt as JsonObject };
}

function checkTree(tree: ReturnType<typeof parseSync>): Set<AgentView> {
  const state: WalkState = { views: new Set() };
  walk(
    (tree.stmts ?? []).map((s) => s.stmt),
    new Set(),
    state,
  );
  return state.views;
}

export async function validateSql(input: string): Promise<ValidationResult> {
  return validate(input, true);
}

// Solo para pruebas: ejecuta únicamente las capas del parser para comprobar que no dependen de la regex.
export async function validateAstOnlyForTests(input: string): Promise<ValidationResult> {
  return validate(input, false);
}

async function validate(input: string, useRegex: boolean): Promise<ValidationResult> {
  try {
    const trimmed = input.trim().replace(/;\s*$/, '');
    if (trimmed === '') reject('consulta vacía');
    // Regex sobre el texto original: se quita solo el punto y coma final.
    if (useRegex) {
      for (const rule of DENY_RULES) {
        if (rule.pattern.test(trimmed)) reject(rule.reason);
      }
    }

    await ensureParser();
    const { tree, select } = parseSingleSelect(trimmed);
    const views = checkTree(tree);
    if (views.size === 0) reject('la consulta no usa ninguna vista del esquema agent');

    const limitApplied = enforceLimit(select);
    let sql = trimmed;
    if (limitApplied) {
      // El SQL que se ejecuta es el regenerado desde el árbol: se vuelve a parsear y validar.
      sql = deparseSync(tree);
      const again = parseSingleSelect(sql);
      const viewsAgain = checkTree(again.tree);
      if (viewsAgain.size !== views.size) reject('el SQL regenerado cambió las vistas usadas');
      if (limitConstant(again.select.limitCount) !== MAX_LIMIT) reject('no se pudo fijar el LIMIT');
    }
    return { ok: true, sql, viewsUsed: [...views], limitApplied };
  } catch (error) {
    if (error instanceof Rejection) return { ok: false, reason: error.message };
    // Error del parser (sintaxis no reconocida): falla cerrado.
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `no se pudo interpretar la consulta: ${detail}` };
  }
}
