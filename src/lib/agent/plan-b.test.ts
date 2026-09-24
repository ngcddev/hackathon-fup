import { describe, expect, it } from 'vitest';
import { extractDiagnosisTerm, matchPlanB, NO_DATA_ANSWER, PLAN_B } from './plan-b';

const idOf = (q: string) => matchPlanB(q)?.entry.id ?? null;

describe('matchPlanB: preguntas de la demo (canónica y variantes)', () => {
  it.each([
    ['uci_beds_today', '¿Cuántas camas de UCI están ocupadas hoy?'],
    ['uci_beds_today', 'camas uci ocupadas'],
    ['uci_beds_today', 'ocupación de la unidad de cuidados intensivos'],
    ['drugs_below_5_days', '¿Cuáles son los medicamentos con menos de 5 días de inventario?'],
    ['drugs_below_5_days', 'medicamentos críticos'],
    ['drugs_below_5_days', 'medicinas con menos de cinco dias de stock'],
    ['emergency_wait_week', '¿Cuál es el tiempo de espera promedio en urgencias en la última semana?'],
    ['emergency_wait_week', '¿cuánto se demoran en urgencias esta semana?'],
    ['emergency_wait_week', 'espera promedio urgencias ultima semana'],
    ['top_service_admissions_month', '¿Qué servicio tiene más pacientes ingresados este mes?'],
    ['top_service_admissions_month', 'servicio con más ingresos este mes'],
    ['top_service_admissions_month', 'que servicio recibe mas pacientes'],
  ])('%s ← %s', (id, question) => expect(idOf(question)).toBe(id));
});

describe('matchPlanB: las 10 adicionales', () => {
  it.each([
    ['occupancy_by_service_today', 'ocupación por servicio hoy'],
    ['emergency_wait_by_triage_month', 'espera por triage este mes'],
    ['admissions_per_day_week', 'ingresos por día de la última semana'],
    ['top_specialties_services_month', 'especialidades con más servicios este mes'],
    ['top_dispensed_drugs_30d', 'top 10 medicamentos más dispensados en 30 días'],
    ['drugs_5_to_10_days', 'medicamentos entre 5 y 10 días de inventario'],
    ['surgery_compliance_by_month', 'cumplimiento quirúrgico por mes'],
    ['admissions_by_age_group_month', 'ingresos por grupo de edad este mes'],
    ['top_diagnoses_month', 'diagnósticos más frecuentes este mes'],
    ['emergency_arrivals_by_hour', 'llegadas a urgencias por hora del día'],
  ])('%s ← %s', (id, question) => expect(idOf(question)).toBe(id));

  it('cada entrada responde a su pregunta canónica y a sus variantes', () => {
    for (const entry of PLAN_B) {
      for (const q of [entry.question, ...entry.variants]) {
        expect(idOf(q), `${entry.id} ← ${q}`).toBe(entry.id);
      }
    }
  });
});

describe('matchPlanB: sin coincidencia', () => {
  it.each(['¿Cuál es la capital de Francia?', 'hola', '¿Cuántos médicos hay de turno?', 'cirugías', ''])(
    'no responde: %s',
    (q) => expect(matchPlanB(q)).toBeNull(),
  );
});

describe('respuestas (AGE-06): empiezan con el dato principal', () => {
  it('UCI', () => {
    const entry = PLAN_B[0];
    const answer = entry.buildAnswer([
      { subservicio: 'UNIDAD DE CUIDADO INTENSIVO NEONATAL', ocupadas: 15, capacidad: 18, porcentaje_ocupacion: 83.3 },
      { subservicio: 'UNIDAD DE CUIDADO INTENSIVO PEDIATRICO', ocupadas: 6, capacidad: 9, porcentaje_ocupacion: 66.7 },
      { subservicio: 'UNIDAD DE CUIDADOS INTENSIVOS ADULTOS', ocupadas: 9, capacidad: 19, porcentaje_ocupacion: 47.4 },
      { subservicio: 'TOTAL UCI', ocupadas: 30, capacidad: 46, porcentaje_ocupacion: 65.2 },
    ]);
    expect(answer.startsWith('Hay 30 de 46 camas UCI ocupadas (65,2 %).')).toBe(true);
    expect(answer).toContain('adultos: 9 de 19');
  });

  it('espera en urgencias', () => {
    const answer = PLAN_B[2].buildAnswer([
      { triage_level: '1', ingresos: 20, espera_promedio_min: 30.5 },
      { triage_level: 'Sin triage', ingresos: 35, espera_promedio_min: 153.8 },
      { triage_level: 'TOTAL', ingresos: 796, espera_promedio_min: 62.1 },
    ]);
    expect(answer.startsWith('El tiempo promedio fue de 62,1 minutos')).toBe(true);
    expect(answer).toContain('796 ingresos');
  });

  it('medicamentos críticos incluye el aviso de datos simulados', () => {
    const answer = PLAN_B[1].buildAnswer([
      { nombre: 'LOSARTAN 50 mg TABLETA', dias_restantes: 1.4 },
      { nombre: 'OTRO', dias_restantes: 2 },
    ]);
    expect(answer.startsWith('Hay 2 medicamentos con menos de 5 días de inventario')).toBe(true);
    expect(answer).toContain('simulados');
  });

  it('servicio con más pacientes', () => {
    const answer = PLAN_B[3].buildAnswer([{ servicio: 'PEDIATRIA', pacientes: 405 }]);
    expect(answer.startsWith('El servicio con más pacientes es Pediatria, con 405 pacientes')).toBe(true);
  });

  it('sin filas, todas responden con el texto de AGE-07', () => {
    for (const entry of PLAN_B) expect(entry.buildAnswer([])).toBe(NO_DATA_ANSWER);
  });
});

describe('búsqueda de diagnóstico sin LLM', () => {
  it.each([
    ['cuantos pacientes ingresaron con apendiciti?', 'APENDICITI'],
    ['¿Cuántos pacientes son atendidos por apendicitis?', 'APENDICITI'],
    ['ingresos con diagnóstico de neumonías este mes', 'NEUMONIA'],
    ['casos de dengue', 'DENGUE'],
    ['pacientes hospitalizados con una bronquiolitis', 'BRONQUIOLITI'],
  ])('%s → %s', (question, term) => {
    expect(extractDiagnosisTerm(question)).toBe(term);
    const match = matchPlanB(question);
    expect(match?.entry.id).toBe('diagnosis_search');
    expect(match?.entry.sql).toContain(`diagnosis_name ILIKE '%${term}%'`);
  });

  it('filtra el mes solo si la pregunta lo pide', () => {
    expect(matchPlanB('casos de dengue este mes')?.entry.sql).toContain('date_trunc');
    expect(matchPlanB('casos de dengue')?.entry.sql).not.toContain('date_trunc');
  });

  it.each([
    'pacientes ingresados por urgencias',
    'ingresos de pediatria',
    'pacientes con triage 1',
    'ingresos de mujeres',
    'pacientes de zona rural',
    'ingresos por grupo de edad este mes',
    'pacientes por nivel de triage',
  ])('no confunde otros filtros con un diagnóstico: %s', (question) => {
    expect(extractDiagnosisTerm(question)).toBeNull();
  });

  it('las preguntas fijas tienen prioridad', () => {
    expect(matchPlanB('diagnósticos más frecuentes este mes')?.entry.id).toBe('top_diagnoses_month');
  });

  it('responde con el total y el diagnóstico principal', () => {
    const entry = matchPlanB('casos de apendicitis')!.entry;
    const answer = entry.buildAnswer([
      { diagnostico: 'APENDICITIS AGUDA, NO ESPECIFICADA', ingresos: 40 },
      { diagnostico: 'OTRAS APENDICITIS', ingresos: 7 },
    ]);
    expect(answer.startsWith('Hubo 47 ingresos con diagnósticos que contienen "apendiciti"')).toBe(true);
    expect(entry.buildAnswer([])).toBe(NO_DATA_ANSWER);
  });
});
