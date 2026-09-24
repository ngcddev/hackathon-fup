// Verifica los puntos de la ola 3 (ALE-04, D2, DAS-08/09, IMP-08, D6, D7) contra la base real.
// Uso: npx tsx --conditions=react-server scripts/insights-check.ts
// (la condición react-server evita que 'server-only' falle fuera de Next.js)
try {
  process.loadEnvFile('.env.local');
} catch {
  // sin .env.local: se usan las variables del entorno
}

export {};

let failures = 0;
const report = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK   ' : 'FALLO'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Ningún resultado lleva patient_key ni columnas identificables.
const FORBIDDEN = /patient|document|birth|reason|diagnosis_code|triage_code|^name$|^full_name$/i;
function leaks(value: unknown, path = 'root'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leaks(v, `${path}[${i}]`));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => [
      ...(FORBIDDEN.test(k) ? [`${path}.${k}`] : []),
      ...leaks(v, `${path}.${k}`),
    ]);
  return [];
}

async function checkEmergencyWaitAlerts() {
  const { getKpis } = await import('@/lib/queries/kpis');
  const kpis = await getKpis(null);
  const alerts = kpis.alerts.filter((a) => a.type === 'emergency_wait');
  const t1 = alerts.find((a) => a.id === 'emergency_wait:triage-1');
  const t2 = alerts.find((a) => a.id === 'emergency_wait:triage-2');
  const wait = Object.fromEntries(kpis.emergency_wait.by_triage_level.map((l) => [l.triage_level, l.avg_wait_minutes]));
  report('ALE-04 triage 1 (30,5 min > 10) es crítica', t1?.severity === 'critical', t1?.message);
  report('ALE-04 triage 2 (47,1 min > 30) es crítica', t2?.severity === 'critical', t2?.message);
  report(
    'ALE-04 recomendación de triage 1 nombra el turno noche',
    t1?.recommendation === 'Reforzar la atención de triage 1 en el turno noche.',
    t1?.recommendation,
  );
  report(
    'ALE-04 recomendación de triage 2 nombra el turno día',
    t2?.recommendation === 'Reforzar la atención de triage 2 en el turno día.',
    t2?.recommendation,
  );
  report(
    'ALE-04 triage 3 y 4 no alertan (59,7 y 60,6 min bajo 120 y 240)',
    !alerts.some((a) => /triage-[34]/.test(a.id)),
    `t3=${wait[3]} t4=${wait[4]}`,
  );
  const first = kpis.alerts.findIndex((a) => a.severity === 'warning');
  const lastCritical = kpis.alerts.map((a) => a.severity).lastIndexOf('critical');
  report('ALE-03 las críticas siguen antes que las advertencias', first === -1 || lastCritical < first);
  report('ALE-04 sin datos identificables', leaks(alerts).length === 0);

  const { buildEmergencyWaitAlerts } = await import('@/lib/alerts/emergency-wait');
  const card = {
    ...kpis.emergency_wait,
    by_triage_level: [
      { triage_level: 3, avg_wait_minutes: 130, admissions_count: 5 },
      { triage_level: 4, avg_wait_minutes: 100, admissions_count: 5 },
    ],
  };
  const synthetic = buildEmergencyWaitAlerts(card, [
    { triage_level: 3, shift: 'dia', avg_wait_minutes: 120, admissions_count: 3 },
    { triage_level: 3, shift: 'noche', avg_wait_minutes: 150, admissions_count: 2 },
  ]);
  report(
    'ALE-04 triage 3 sobre 120 min es advertencia con el turno de mayor espera',
    synthetic.length === 1 &&
      synthetic[0].alert.severity === 'warning' &&
      synthetic[0].alert.recommendation.endsWith('turno noche.'),
  );
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function checkDepletionForecast() {
  const { getKpis } = await import('@/lib/queries/kpis');
  const kpis = await getKpis(null);
  const card = kpis.critical_drugs;
  report('D2 la tarjeta muestra los días objetivo usados (15)', card.target_days === 15, String(card.target_days));
  const bad = card.items.filter((d) => {
    const expectedDate = addDays(kpis.reference_date, Math.floor(d.days_of_inventory));
    const expectedQty = Math.max(Math.ceil(d.avg_daily_consumption * 15 - d.current_stock), 0);
    return d.estimated_stockout_date !== expectedDate || d.suggested_order_quantity !== expectedQty;
  });
  report(
    'D2 fecha de quiebre = referencia + días (hacia abajo) y cantidad = ceil(consumo × N − stock)',
    card.items.length > 0 && bad.length === 0,
    bad.map((d) => d.item_code).join(', '),
  );
  const sample = card.items[0];
  console.log(
    `      ${sample.item_name}: ${sample.days_of_inventory} días → quiebre ${sample.estimated_stockout_date}, pedir ${sample.suggested_order_quantity}`,
  );
  const alert = kpis.alerts.find((a) => a.id === `stockout:${sample.item_code}`);
  report(
    'D2 ALE-01 incluye la fecha de quiebre y la cantidad sugerida',
    !!alert &&
      alert.message.includes(sample.estimated_stockout_date ?? '?') &&
      alert.recommendation.includes('para cubrir 15 días'),
    alert?.message,
  );
  report('D2 sin datos identificables', leaks(card).length === 0);
}

async function checkTrendAndStay() {
  const { getKpis } = await import('@/lib/queries/kpis');
  const kpis = await getKpis(null);
  const trend = kpis.occupancy_trend;
  const stay = kpis.avg_stay;
  report(
    'DAS-08 30 días hasta la fecha de referencia con scope service',
    trend?.scope === 'service' &&
      trend.days.length === 30 &&
      trend.days[0].day === addDays(kpis.reference_date, -29) &&
      trend.days[29].day === kpis.reference_date,
    `${trend?.days[0]?.day} a ${trend?.days.at(-1)?.day}`,
  );
  const last = trend?.days.at(-1);
  report(
    'DAS-08 el último día coincide con la tarjeta de ocupación (DAS-01)',
    last?.occupied_beds === kpis.occupancy.total.occupied_beds &&
      last?.capacity === kpis.occupancy.total.capacity &&
      last?.occupancy_pct === kpis.occupancy.total.occupancy_pct,
    JSON.stringify(last),
  );
  report(
    'DAS-08 cada día = ocupadas ÷ capacidad',
    !!trend &&
      trend.days.every(
        (d) => d.capacity > 0 && d.occupancy_pct === Math.round((1000 * d.occupied_beds) / d.capacity) / 10,
      ),
  );
  const uci = await getKpis('UNIDAD DE CUIDADO INTENSIVO');
  report(
    'DAS-08 con filtro UCI el último día es 30/46 (65,2 %)',
    uci.occupancy_trend?.days.at(-1)?.occupied_beds === 30 && uci.occupancy_trend?.days.at(-1)?.capacity === 46,
  );
  report(
    'DAS-09 estancia por servicio, scope service, valores plausibles',
    stay?.scope === 'service' &&
      stay.by_service.length > 0 &&
      stay.by_service.every((s) => s.avg_stay_days >= 0 && s.avg_stay_days < 60 && s.admissions_count > 0),
    stay?.by_service.map((s) => `${s.service}: ${s.avg_stay_days} d (${s.admissions_count})`).join('; '),
  );
  report(
    'DAS-09 con filtro UCI solo trae el servicio UCI',
    uci.avg_stay?.by_service.length === 1 && uci.avg_stay.by_service[0].service === 'UNIDAD DE CUIDADO INTENSIVO',
    JSON.stringify(uci.avg_stay?.by_service),
  );
  report('DAS-08/09 sin datos identificables', leaks([trend, stay]).length === 0);

  const times: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = performance.now();
    await getKpis(null);
    times.push(Math.round(performance.now() - t));
  }
  console.log(`      GET /api/kpis, 6 corridas seguidas (ms, medidas desde esta máquina): ${times.join(', ')}`);
}

// IMP-08. Corre dentro de una transacción que SIEMPRE termina en ROLLBACK: no deja lotes,
// filas ni el admin de prueba en la base. Usa los roles reales (importer y app_backend) con
// SET LOCAL ROLE, sobre la conexión de HIS_LOAD_DATABASE_URL (solo en tu máquina).
async function checkRevert() {
  const url = process.env.HIS_LOAD_DATABASE_URL;
  if (!url) {
    console.log('SALTA  IMP-08 (falta HIS_LOAD_DATABASE_URL)');
    return;
  }
  const { Client } = await import('pg');
  const { getDrugRiskRows } = await import('@/lib/queries/kpis/critical-drugs');
  const { buildStockoutAlerts } = await import('@/lib/alerts/stockout');
  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');
  const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  const client = new Client({
    connectionString: parsed.toString(),
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  const q = async <T>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
  // La conexión de la carga histórica no puede hacer SET ROLE importer/app_backend, así que las
  // funciones corren con su dueño. Los permisos de EXECUTE por rol se comprueban aparte (has_function_privilege).
  const asRole = async <T>(_role: 'importer' | 'app_backend', fn: () => Promise<T>): Promise<T> => fn();
  // Un error de Postgres aborta la transacción: cada intento negativo va en un savepoint.
  const failsWith = async (sqlstate: string, fn: () => Promise<unknown>) => {
    await client.query('SAVEPOINT neg');
    try {
      await fn();
      await client.query('RELEASE SAVEPOINT neg');
      return false;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT neg');
      return (error as { code?: string }).code === sqlstate;
    }
  };
  const critical = async () =>
    buildStockoutAlerts(await getDrugRiskRows(q))
      .filter((r) => r.alert.severity === 'critical')
      .map((r) => r.alert.id)
      .sort();

  try {
    await client.query('BEGIN');
    const [grants] = await q<{ app: boolean; importer: boolean; agent: boolean; pub: boolean }>(
      `SELECT has_function_privilege('app_backend', 'core.revert_batch(uuid, uuid)', 'EXECUTE') AS app,
              has_function_privilege('importer', 'core.revert_batch(uuid, uuid)', 'EXECUTE') AS importer,
              has_function_privilege('agent_ro', 'core.revert_batch(uuid, uuid)', 'EXECUTE') AS agent,
              has_function_privilege('anon', 'core.revert_batch(uuid, uuid)', 'EXECUTE') AS pub`,
    );
    report(
      'IMP-08 EXECUTE de core.revert_batch solo para app_backend',
      grants.app && !grants.importer && !grants.agent && !grants.pub,
      JSON.stringify(grants),
    );
    const [fn] = await q<{ prosecdef: boolean; proconfig: string[] }>(
      "SELECT prosecdef, proconfig FROM pg_proc WHERE oid = 'core.revert_batch(uuid, uuid)'::regprocedure",
    );
    report(
      'IMP-08 core.revert_batch es SECURITY DEFINER con search_path fijo',
      fn.prosecdef && fn.proconfig.some((c) => c.startsWith('search_path=')),
      fn.proconfig.join(' '),
    );
    const adminId = '11111111-1111-4111-8111-111111111111';
    const pharmacyId = '22222222-2222-4222-8222-222222222222';
    for (const [id, role] of [
      [adminId, 'admin'],
      [pharmacyId, 'pharmacy'],
    ]) {
      await q('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `${role}.prueba@example.invalid`]);
      await q('INSERT INTO core.user_profiles (user_id, full_name, role) VALUES ($1, $2, $3)', [
        id,
        `Prueba ${role}`,
        role,
      ]);
    }
    const newBatch = async (target: string, file: string) =>
      (
        await asRole('importer', () =>
          q<{ batch_id: string }>(
            `INSERT INTO audit.import_batches (load_type, target_table, file_name, source_system, imported_by_user_id)
             VALUES ('ui_import', $1, $2, 'Prueba', $3) RETURNING batch_id`,
            [target, file, adminId],
          ),
        )
      )[0].batch_id;
    const apply = (batchId: string) =>
      asRole('importer', async () => (await q<{ s: string }>('SELECT core.apply_batch($1) AS s', [batchId]))[0].s);
    const revert = (batchId: string, actor = adminId) =>
      asRole(
        'app_backend',
        async () => (await q<{ n: number }>('SELECT core.revert_batch($1, $2) AS n', [batchId, actor]))[0].n,
      );

    // --- drug_stock: importar una foto nueva de los medicamentos críticos y revertirla.
    const before = await critical();
    const drugs = await q<{ item_code: string; item_name: string; avg_daily_consumption: number }>(
      `SELECT item_code, item_name, avg_daily_consumption::float8 AS avg_daily_consumption FROM agent.v_drug_inventory
        WHERE item_type = 'medicamento' AND days_of_inventory < 5`,
    );
    const stockBatch = await newBatch('drug_stock', 'drug_stock_valido.csv');
    await asRole('importer', async () => {
      for (const [i, d] of drugs.entries()) {
        await q(
          `INSERT INTO staging.stg_drug_stock (batch_id, source_row_number, item_code, item_name, current_stock, unit, stock_date, expiration_date)
           VALUES ($1, $2, $3, $4, $5, 'UND', '2026-09-22', '2027-12-31')`,
          [stockBatch, i + 1, d.item_code, d.item_name, String(Math.ceil(d.avg_daily_consumption * 20))],
        );
      }
    });
    report('IMP-08 el lote de inventario se aplica', (await apply(stockBatch)) === 'applied');
    const during = await critical();
    report(
      'IMP-08 con la foto nueva salen las alertas críticas de esos medicamentos',
      before.length > 0 && during.length < before.length,
      `antes ${before.length}, durante ${during.length}`,
    );
    const removed = await revert(stockBatch);
    report('IMP-08 revertir devuelve las filas borradas', removed === drugs.length, `rows_reverted=${removed}`);
    const after = await critical();
    report(
      'IMP-08 tras revertir las alertas críticas vuelven a ser las de antes',
      JSON.stringify(after) === JSON.stringify(before),
      `antes ${before.length}, después ${after.length}`,
    );
    const [row] = await q<{ status: string; reverted_by_user_id: string; reverted_at: string | null }>(
      'SELECT status, reverted_by_user_id, reverted_at FROM audit.import_batches WHERE batch_id = $1',
      [stockBatch],
    );
    report(
      'IMP-08 el lote queda reverted con quién y cuándo',
      row.status === 'reverted' && row.reverted_by_user_id === adminId && row.reverted_at !== null,
    );
    report(
      'IMP-08 un lote ya revertido no se revierte de nuevo (55000)',
      await failsWith('55000', () => revert(stockBatch)),
    );
    report(
      'IMP-08 un no admin no puede revertir (42501)',
      await failsWith('42501', () => revert(stockBatch, pharmacyId)),
    );
    report(
      'IMP-08 un lote inexistente responde P0002',
      await failsWith('P0002', () => revert('33333333-3333-4333-8333-333333333333')),
    );
    const [hist] = await q<{ batch_id: string; rows_loaded: number }>(
      "SELECT batch_id, rows_loaded FROM audit.import_batches WHERE load_type = 'historical' AND target_table = 'bed_inventory'",
    );
    report('IMP-08 un lote histórico no se revierte (55000)', await failsWith('55000', () => revert(hist.batch_id)));

    // --- bed_inventory: las camas importadas reemplazan camas derived; al revertir vuelven a derivarse.
    const capacity = async () =>
      (await q<{ n: number }>('SELECT count(*)::int AS n FROM core.bed_inventory WHERE is_active'))[0].n;
    const beds = await q<{ bed_code: string; bed_name: string; bed_group: string; bed_subgroup: string }>(
      'SELECT bed_code, bed_name, bed_group, bed_subgroup FROM core.bed_inventory ORDER BY bed_code LIMIT 3',
    );
    const cap0 = await capacity();
    const bedBatch = await newBatch('bed_inventory', 'camas_prueba.csv');
    await asRole('importer', async () => {
      for (const [i, b] of beds.entries()) {
        await q(
          `INSERT INTO staging.stg_bed_inventory (batch_id, source_row_number, bed_code, bed_name, bed_group, bed_subgroup, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, 'false')`,
          [bedBatch, i + 1, b.bed_code, b.bed_name, b.bed_group, b.bed_subgroup],
        );
      }
    });
    const bedStatus = await apply(bedBatch);
    const capDuring = await capacity();
    report(
      'IMP-08 el lote de camas se aplica y reemplaza camas derived',
      bedStatus === 'applied' && capDuring === cap0 - 3,
      `capacidad ${cap0} → ${capDuring}`,
    );
    const removedBeds = await revert(bedBatch);
    const restored = await q<{ bed_code: string; data_origin: string; batch_id: string }>(
      'SELECT bed_code, data_origin, batch_id FROM core.bed_inventory WHERE bed_code = ANY($1)',
      [beds.map((b) => b.bed_code)],
    );
    const capAfter = await capacity();
    report(
      'IMP-08 las camas vuelven a derivarse y la capacidad no queda en cero',
      removedBeds === 3 &&
        capAfter === cap0 &&
        restored.length === 3 &&
        restored.every((r) => r.data_origin === 'derived' && r.batch_id === hist.batch_id),
      `capacidad ${capAfter}, rows_reverted=${removedBeds}`,
    );
    const [hist2] = await q<{ rows_loaded: number; status: string }>(
      'SELECT rows_loaded, status FROM audit.import_batches WHERE batch_id = $1',
      [hist.batch_id],
    );
    report(
      'IMP-08 el lote histórico de camas queda intacto',
      hist2.rows_loaded === hist.rows_loaded && hist2.status === 'applied',
      `rows_loaded ${hist.rows_loaded} → ${hist2.rows_loaded}`,
    );
    const [occ] = await q<{ cap: number }>(
      'SELECT sum(capacity)::int AS cap FROM agent.v_bed_occupancy WHERE day = agent.reference_date()',
    );
    report('IMP-08 la capacidad diaria vuelve a la de antes (712)', occ.cap === 712, String(occ.cap));

    // --- surgery_schedules
    const surgeryBatch = await newBatch('surgery_schedules', 'cirugias_prueba.csv');
    await asRole('importer', () =>
      q(
        `INSERT INTO staging.stg_surgery_schedule (batch_id, source_row_number, schedule_number, patient_id, admission_id, service_code, scheduled_date, operating_room)
         VALUES ($1, 1, 'PRUEBA-REVERT-1', '1', NULL, 'PRUEBA', '2026-09-01', 'Q1')`,
        [surgeryBatch],
      ),
    );
    const surgeryStatus = await apply(surgeryBatch);
    const countSurgery = async () =>
      (
        await q<{ n: number }>(
          "SELECT count(*)::int AS n FROM core.surgery_schedules WHERE schedule_number = 'PRUEBA-REVERT-1'",
        )
      )[0].n;
    const inserted = await countSurgery();
    const removedSurgeries = await revert(surgeryBatch);
    const left = await countSurgery();
    report(
      'IMP-08 la programación quirúrgica importada se borra al revertir',
      surgeryStatus === 'applied' && inserted === 1 && removedSurgeries === 1 && left === 0,
      `${surgeryStatus}, ${inserted} → ${left}`,
    );
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

// revertBatch con el rol real app_backend: solo caminos de error, no escribe nada.
async function checkRevertErrors(batchesBefore: number) {
  const { revertBatch } = await import('@/lib/import/revert');
  const { ApiError } = await import('@/lib/api/errors');
  const { queryAsAppBackend } = await import('@/lib/db');
  const codeOf = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return 'sin error';
    } catch (error) {
      return error instanceof ApiError ? error.code : String(error);
    }
  };
  const ghost = '33333333-3333-4333-8333-333333333333';
  report(
    'IMP-08 id mal formado -> VALIDATION_ERROR',
    (await codeOf(() => revertBatch('no-es-uuid', ghost))) === 'VALIDATION_ERROR',
  );
  report('IMP-08 actor que no es admin -> FORBIDDEN', (await codeOf(() => revertBatch(ghost, ghost))) === 'FORBIDDEN');
  const [b] = await queryAsAppBackend<{ n: number }>('SELECT count(*)::int AS n FROM audit.import_batches');
  const [u] = await queryAsAppBackend<{ n: number }>('SELECT count(*)::int AS n FROM core.user_profiles');
  report(
    'IMP-08 la prueba no dejó lotes ni usuarios en la base (ROLLBACK)',
    b.n === batchesBefore && u.n === 0,
    `lotes ${batchesBefore} → ${b.n}, perfiles ${u.n}`,
  );
}

async function checkArrivals() {
  const { buildArrivals, getArrivalsInsight } = await import('@/lib/queries/insights/arrivals');
  const { queryAsAppBackend } = await import('@/lib/db');

  // Datos sintéticos con resultado calculado a mano: 1 llegada por celda y día de la semana (una
  // aparición de cada día), salvo martes 10 y 11 h con 2. Franja martes 10-12 = 4, las otras 83 = 2.
  const rows = [];
  for (let weekday = 1; weekday <= 7; weekday++)
    for (let hour = 0; hour < 24; hour++)
      rows.push({ weekday, hour, arrivals: weekday === 2 && (hour === 10 || hour === 11) ? 2 : 1 });
  const occurrences = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, 1]));
  const synthetic = buildArrivals(
    rows,
    { period_start: '2026-09-15', period_end: '2026-09-21', days_count: 7, occurrences },
    '2026-09-21',
  );
  const top = synthetic.top_slots[0];
  const baseline = (83 * 2 + 4) / 84;
  report(
    'D6 (sintético) la franja pico es martes 10 a 12 con 98 % sobre el promedio',
    top.weekday === 2 &&
      top.hour_start === 10 &&
      top.hour_end === 12 &&
      top.pct_above_average === Math.round(100 * (4 / baseline - 1)),
    top.recommendation,
  );
  report(
    'D6 (sintético) la recomendación sigue la plantilla',
    top.recommendation === 'Martes de 10 a 12: 98 % por encima del promedio; reforzar el turno día.',
    top.recommendation,
  );
  report(
    'D6 (sintético) 168 celdas y promedio de franjas',
    synthetic.cells.length === 168 && synthetic.avg_arrivals_per_slot === Math.round(baseline * 100) / 100,
  );

  const real = await getArrivalsInsight();
  const [truth] = await queryAsAppBackend<{ total: number; d0: string }>(
    `SELECT COUNT(*)::int AS total, MIN(admitted_at)::date::text AS d0 FROM agent.v_admissions
      WHERE admission_route = 'Urgencias' AND admitted_at < (SELECT agent.reference_date()) + 1`,
  );
  report(
    'D6 total de llegadas y periodo coinciden con la base',
    real.arrivals_total === truth.total &&
      real.period_start === truth.d0 &&
      real.period_end === real.reference_date &&
      real.days_count === 144,
    `${real.arrivals_total} llegadas, ${real.period_start} a ${real.period_end}, ${real.days_count} días`,
  );
  report('D6 168 celdas (7 días × 24 horas)', real.cells.length === 168);
  // Verificación independiente de la franja pico: llegadas ÷ veces que aparece ese día de la semana.
  const p = real.top_slots[0];
  const [slot] = await queryAsAppBackend<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM agent.v_admissions
      WHERE admission_route = 'Urgencias' AND admitted_at < (SELECT agent.reference_date()) + 1
        AND EXTRACT(ISODOW FROM admitted_at)::int = $1 AND EXTRACT(HOUR FROM admitted_at)::int >= $2 AND EXTRACT(HOUR FROM admitted_at)::int < $3`,
    [p.weekday, p.hour_start, p.hour_end],
  );
  let occ = 0;
  for (
    let d = new Date(`${real.period_start}T00:00:00Z`);
    d <= new Date(`${real.period_end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  )
    if (((d.getUTCDay() + 6) % 7) + 1 === p.weekday) occ++;
  report(
    'D6 promedio de la franja pico = llegadas ÷ apariciones del día (cálculo independiente)',
    p.avg_arrivals === Math.round((10 * slot.n) / occ) / 10,
    `${slot.n} llegadas ÷ ${occ} = ${(slot.n / occ).toFixed(2)}`,
  );
  report(
    'D6 3 franjas, de mayor a menor, todas sobre el promedio',
    real.top_slots.length === 3 &&
      real.top_slots.every(
        (s, i, a) => s.pct_above_average > 0 && (i === 0 || a[i - 1].avg_arrivals >= s.avg_arrivals),
      ),
  );
  report(
    'D6 recomendaciones con la plantilla',
    real.top_slots.every((s) =>
      /^\p{Lu}\p{L}+ de \d+ a \d+: \d+ % por encima del promedio; reforzar el turno (día|noche)\.$/u.test(
        s.recommendation,
      ),
    ),
  );
  report('D6 sin datos identificables', leaks(real).length === 0);
  for (const s of real.top_slots)
    console.log(
      `      ${s.recommendation} (${s.avg_arrivals} llegadas por franja; promedio ${real.avg_arrivals_per_slot})`,
    );
}

async function checkWaitRootCause() {
  const { buildWaitRootCause, getWaitRootCause, MIN_SEGMENT_VOLUME } =
    await import('@/lib/queries/insights/wait-root-cause');
  const { queryAsAppBackend } = await import('@/lib/db');
  const periods = {
    current: { start: '2026-09-15', end: '2026-09-21' },
    baseline: { start: '2026-08-18', end: '2026-09-14' },
  };
  type Row = {
    period: 'current' | 'baseline';
    shift: 'dia' | 'noche';
    weekday: number;
    triage_level: number | null;
    n: number;
    total_minutes: number;
  };
  const seg = (
    shift: 'dia' | 'noche',
    weekday: number,
    triage_level: number | null,
    cur: [number, number],
    base: [number, number],
  ): Row[] => [
    { period: 'current', shift, weekday, triage_level, n: cur[0], total_minutes: cur[0] * cur[1] },
    { period: 'baseline', shift, weekday, triage_level, n: base[0], total_minutes: base[0] * base[1] },
  ];

  // Aumento: triage 3, noche, martes pasa de 51 a 74 min con 20 ingresos. El segmento de triage 1
  // (9 ingresos, salto de 10 a 100 min) NO se reporta por tener menos de 10.
  const up = buildWaitRootCause(
    [
      ...seg('noche', 2, 3, [20, 74], [40, 51]),
      ...seg('dia', 1, 2, [20, 30], [40, 30]),
      ...seg('noche', 3, 1, [9, 100], [50, 10]),
    ],
    periods,
    '2026-09-21',
  );
  report(
    'D7 (sintético) el segmento principal es triage 3 / noche / martes, sin el de 9 ingresos',
    up.top_segments.length === 2 &&
      up.top_segments[0].triage_level === 3 &&
      up.top_segments[0].shift === 'noche' &&
      up.top_segments[0].weekday === 2 &&
      !up.top_segments.some((s) => s.triage_level === 1),
    JSON.stringify(up.top_segments.map((s) => [s.triage_level, s.shift, s.weekday])),
  );
  report(
    'D7 (sintético) espera 74 vs 51, cambio 23 y aporte 23 × 20 = 460',
    up.top_segments[0].current_avg_wait_minutes === 74 &&
      up.top_segments[0].baseline_avg_wait_minutes === 51 &&
      up.top_segments[0].change_minutes === 23 &&
      up.top_segments[0].contribution_minutes === 460,
  );
  report(
    'D7 (sintético) frase de aumento',
    up.summary ===
      'El aumento de la espera se concentra en triage 3 del turno noche de los martes: 74 min frente a 51 min en las 4 semanas anteriores.',
    up.summary,
  );
  const edge = buildWaitRootCause(
    seg('noche', 2, 3, [MIN_SEGMENT_VOLUME, 74], [MIN_SEGMENT_VOLUME, 51]),
    periods,
    '2026-09-21',
  );
  const below = buildWaitRootCause(seg('noche', 2, 3, [MIN_SEGMENT_VOLUME - 1, 74], [40, 51]), periods, '2026-09-21');
  report(
    'D7 (sintético) 10 ingresos se reportan y 9 no',
    edge.top_segments.length === 1 && below.top_segments.length === 0,
  );
  const flat = buildWaitRootCause(seg('dia', 1, 3, [50, 105], [100, 100]), periods, '2026-09-21');
  report(
    'D7 (sintético) un cambio de 5 % se reporta como sin cambio relevante',
    flat.summary.startsWith('La espera promedio no cambió de forma relevante') && flat.overall.change_pct === 5,
    flat.summary,
  );
  const down = buildWaitRootCause(seg('dia', 1, 3, [50, 60], [100, 80]), periods, '2026-09-21');
  report(
    'D7 (sintético) si bajó, la frase dice que bajó',
    down.summary.startsWith('La espera bajó 25 %') && down.top_segments[0].contribution_minutes === -1000,
    down.summary,
  );

  const real = await getWaitRootCause();
  const [truth] = await queryAsAppBackend<{ cur_n: number; cur_avg: number; base_n: number; base_avg: number }>(
    `SELECT COUNT(*) FILTER (WHERE admitted_at >= r.d - 6)::int AS cur_n,
            ROUND(AVG(wait_minutes) FILTER (WHERE admitted_at >= r.d - 6), 1)::float8 AS cur_avg,
            COUNT(*) FILTER (WHERE admitted_at < r.d - 6)::int AS base_n,
            ROUND(AVG(wait_minutes) FILTER (WHERE admitted_at < r.d - 6), 1)::float8 AS base_avg
       FROM agent.v_emergency_wait_times w CROSS JOIN (SELECT agent.reference_date() AS d) r
      WHERE w.admitted_at >= r.d - 34 AND w.admitted_at < r.d + 1`,
  );
  report(
    'D7 la espera global coincide con DAS-02 y con el cálculo independiente',
    real.overall.current_avg_wait_minutes === truth.cur_avg &&
      real.overall.current_volume === truth.cur_n &&
      real.overall.baseline_avg_wait_minutes === truth.base_avg &&
      real.overall.baseline_volume === truth.base_n &&
      truth.cur_avg === 62.1 &&
      truth.cur_n === 796,
    JSON.stringify(real.overall),
  );
  report(
    'D7 periodos: última semana y 28 días anteriores',
    real.current_period.start === '2026-09-15' &&
      real.current_period.end === '2026-09-21' &&
      real.baseline_period.start === '2026-08-18' &&
      real.baseline_period.end === '2026-09-14',
  );
  const t = real.top_segments[0];
  const [check] = await queryAsAppBackend<{ cur_avg: number; base_avg: number; cur_n: number }>(
    `SELECT ROUND(AVG(wait_minutes) FILTER (WHERE admitted_at >= r.d - 6), 1)::float8 AS cur_avg,
            ROUND(AVG(wait_minutes) FILTER (WHERE admitted_at < r.d - 6), 1)::float8 AS base_avg,
            COUNT(*) FILTER (WHERE admitted_at >= r.d - 6)::int AS cur_n
       FROM agent.v_emergency_wait_times w CROSS JOIN (SELECT agent.reference_date() AS d) r
      WHERE w.admitted_at >= r.d - 34 AND w.admitted_at < r.d + 1
        AND w.shift = $1 AND w.weekday = $2 AND w.triage_level IS NOT DISTINCT FROM $3`,
    [t.shift, t.weekday, t.triage_level],
  );
  report(
    'D7 el segmento principal coincide con el cálculo independiente',
    check.cur_avg === t.current_avg_wait_minutes &&
      check.base_avg === t.baseline_avg_wait_minutes &&
      check.cur_n === t.current_volume,
    `${t.weekday_name} ${t.shift} triage ${t.triage_level}: ${check.cur_avg} vs ${check.base_avg}`,
  );
  report(
    'D7 hasta 3 segmentos, ordenados por aporte y con al menos 10 ingresos',
    real.top_segments.length <= 3 &&
      real.top_segments.length > 0 &&
      real.top_segments.every(
        (s, i, a) =>
          s.current_volume >= 10 &&
          s.baseline_volume >= 10 &&
          (i === 0 || Math.abs(a[i - 1].contribution_minutes) >= Math.abs(s.contribution_minutes)),
      ),
  );
  report(
    'D7 aporte = cambio × volumen actual',
    real.top_segments.every(
      (s) => Math.abs(s.contribution_minutes - s.change_minutes * s.current_volume) < s.current_volume * 0.1 + 0.1,
    ),
  );
  report(
    'D7 la frase es coherente con el sentido del cambio',
    (real.overall.change_pct ?? 0) < -5
      ? real.summary.startsWith('La espera bajó')
      : (real.overall.change_pct ?? 0) > 5
        ? real.summary.startsWith('El aumento')
        : real.summary.startsWith('La espera promedio no cambió'),
    real.summary,
  );
  report('D7 sin datos identificables', leaks(real).length === 0);
  console.log(`      ${real.summary}`);
}

async function main() {
  await checkEmergencyWaitAlerts();
  await checkDepletionForecast();
  await checkTrendAndStay();
  const { queryAsAppBackend } = await import('@/lib/db');
  const [{ n: batchesBefore }] = await queryAsAppBackend<{ n: number }>(
    'SELECT count(*)::int AS n FROM audit.import_batches',
  );
  await checkRevert();
  await checkRevertErrors(batchesBefore);
  await checkArrivals();
  await checkWaitRootCause();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
