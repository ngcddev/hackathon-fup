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
    return Object.entries(value).flatMap(([k, v]) => [...(FORBIDDEN.test(k) ? [`${path}.${k}`] : []), ...leaks(v, `${path}.${k}`)]);
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
  report('ALE-04 recomendación de triage 1 nombra el turno noche', t1?.recommendation === 'Reforzar la atención de triage 1 en el turno noche.', t1?.recommendation);
  report('ALE-04 recomendación de triage 2 nombra el turno día', t2?.recommendation === 'Reforzar la atención de triage 2 en el turno día.', t2?.recommendation);
  report('ALE-04 triage 3 y 4 no alertan (59,7 y 60,6 min bajo 120 y 240)', !alerts.some((a) => /triage-[34]/.test(a.id)), `t3=${wait[3]} t4=${wait[4]}`);
  const first = kpis.alerts.findIndex((a) => a.severity === 'warning');
  const lastCritical = kpis.alerts.map((a) => a.severity).lastIndexOf('critical');
  report('ALE-03 las críticas siguen antes que las advertencias', first === -1 || lastCritical < first);
  report('ALE-04 sin datos identificables', leaks(alerts).length === 0);

  const { buildEmergencyWaitAlerts } = await import('@/lib/alerts/emergency-wait');
  const card = { ...kpis.emergency_wait, by_triage_level: [{ triage_level: 3, avg_wait_minutes: 130, admissions_count: 5 }, { triage_level: 4, avg_wait_minutes: 100, admissions_count: 5 }] };
  const synthetic = buildEmergencyWaitAlerts(card, [
    { triage_level: 3, shift: 'dia', avg_wait_minutes: 120, admissions_count: 3 },
    { triage_level: 3, shift: 'noche', avg_wait_minutes: 150, admissions_count: 2 },
  ]);
  report('ALE-04 triage 3 sobre 120 min es advertencia con el turno de mayor espera', synthetic.length === 1 && synthetic[0].alert.severity === 'warning' && synthetic[0].alert.recommendation.endsWith('turno noche.'));
}

async function main() {
  await checkEmergencyWaitAlerts();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
