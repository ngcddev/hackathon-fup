// Verifica las tarjetas de GET /api/kpis contra supabase/tests/expected_values.md.
// Uso: npx tsx --conditions=react-server scripts/kpis-check.ts
// (la condición react-server evita que 'server-only' falle fuera de Next.js)
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

  console.log(JSON.stringify({ uci, drugs, wait }, null, 2));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
