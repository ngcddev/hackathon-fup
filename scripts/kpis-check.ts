// Verifica las tarjetas de GET /api/kpis contra supabase/tests/expected_values.md.
// Uso: npx tsx --conditions=react-server scripts/kpis-check.ts
// (la condición react-server evita que 'server-only' falle fuera de Next.js)
export {};

try {
  process.loadEnvFile('.env.local');
} catch {
  // sin .env.local: se usan las variables del entorno
}

async function main() {
  const { getOccupancyCard } = await import('@/lib/queries/kpis/occupancy');
  const { getCriticalDrugsCard } = await import('@/lib/queries/kpis/critical-drugs');
  const { getEmergencyWaitCard } = await import('@/lib/queries/kpis/emergency-wait');

  let failures = 0;
  const report = (name: string, ok: boolean, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'OK   ' : 'FALLO'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const uci = await getOccupancyCard('UNIDAD DE CUIDADO INTENSIVO');
  report(
    '1. Ocupación de UCI = pregunta 1 (30/46, 65,2 %)',
    uci.total.occupied_beds === 30 && uci.total.capacity === 46 && uci.total.occupancy_pct === 65.2,
    JSON.stringify(uci.total),
  );

  const drugs = await getCriticalDrugsCard();
  report('2. Medicamentos críticos = pregunta 2 (10)', drugs.count === 10, `count=${drugs.count}`);

  const wait = await getEmergencyWaitCard();
  report(
    '3. Espera última semana = pregunta 3 (62,1 min, 796 ingresos)',
    wait.avg_wait_minutes === 62.1 && wait.admissions_count === 796,
    `${wait.avg_wait_minutes} min, ${wait.admissions_count} ingresos`,
  );

  const { getKpis } = await import('@/lib/queries/kpis');
  const { ApiError } = await import('@/lib/api/errors');

  const timed = async (service: string | null) => {
    const started = performance.now();
    const response = await getKpis(service);
    return { response, ms: Math.round(performance.now() - started) };
  };
  const full = await timed(null);

  const FORBIDDEN = /patient|document|birth|reason|diagnosis_code|triage_code|^name$|^full_name$/i;
  const leaks: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) {
        if (FORBIDDEN.test(k)) leaks.push(`${path}.${k}`);
        walk(v, `${path}.${k}`);
      }
  };
  walk(full.response, 'kpis');
  report('4. Ninguna tarjeta devuelve patient_key ni columnas identificables', leaks.length === 0, leaks.join(', '));

  const warm = await timed(null);
  const filtered = await timed('UNIDAD DE CUIDADO INTENSIVO');
  report(
    '5. Tiempo total de las tarjetas en paralelo (meta < 1500 ms)',
    warm.ms < 1500 && filtered.ms < 1500,
    `sin filtro: ${full.ms} ms en frío, ${warm.ms} ms en caliente; con filtro UCI: ${filtered.ms} ms`,
  );
  report(
    '5b. Con filtro UCI solo cambian las tarjetas de scope service',
    filtered.response.occupancy.total.capacity === 46 &&
      filtered.response.demand.admissions_by_service.every((s) => s.service === 'UNIDAD DE CUIDADO INTENSIVO') &&
      filtered.response.alerts.length === full.response.alerts.length &&
      filtered.response.demand.services_by_specialty.length === full.response.demand.services_by_specialty.length,
  );

  try {
    await getKpis('SERVICIO QUE NO EXISTE');
    report('6. Servicio inexistente -> error de validación', false, 'no lanzó error');
  } catch (error) {
    report(
      '6. Servicio inexistente -> error de validación',
      error instanceof ApiError && error.code === 'VALIDATION_ERROR',
      String(error),
    );
  }

  console.log(JSON.stringify(full.response, null, 2));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
