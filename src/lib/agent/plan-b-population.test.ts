import { describe, expect, it } from 'vitest';
import { matchPlanB, NO_DATA_ANSWER, PLAN_B, populationEntry } from './plan-b';
import { validateSql } from './validator';

const idOf = (q: string) => matchPlanB(q)?.entry.id ?? null;

describe('pacientes por población (sin LLM)', () => {
  it.each([
    'cuantos pacientes enfermos tengo osea niños?',
    'cuantos niños enfermos tengo?',
    '¿Cuántos niños ingresaron esta semana?',
    'cuantas mujeres hay hospitalizadas',
    'pacientes adultos mayores este mes',
    'cuantos bebés atendimos',
  ])('responde: %s', (q) => expect(idOf(q)).toBe('patients_by_population'));

  it('elige grupos de edad, sexo y periodo según la pregunta', () => {
    expect(populationEntry('cuantos niños enfermos tengo?')!.sql).toContain("age_group IN ('0-4', '5-17')");
    expect(populationEntry('cuantos bebés ingresaron')!.sql).toContain("age_group IN ('0-4')");
    expect(populationEntry('cuantas mujeres ingresaron')!.sql).toContain("sex IN ('Femenino')");
    expect(populationEntry('adultos mayores ingresados')!.sql).toContain("age_group IN ('60-74', '75+')");
    expect(populationEntry('cuantos niños ingresaron esta semana')!.sql).toContain('agent.reference_date() - 6');
    expect(populationEntry('cuantos niños ingresaron')!.question).toContain('este mes');
  });

  it('no se mete en preguntas de otros indicadores', () => {
    expect(populationEntry('espera de los niños en urgencias')).toBeNull();
    expect(populationEntry('camas de pediatría ocupadas')).toBeNull();
    expect(populationEntry('medicamentos para niños')).toBeNull();
    expect(idOf('¿Cuántos ingresos hubo por grupo de edad este mes?')).toBe('admissions_by_age_group_month');
  });

  it('la enfermedad gana sobre la población: "niños con diagnóstico de neumonía"', () => {
    expect(idOf('niños con diagnóstico de neumonía')).toBe('diagnosis_search');
  });

  it('responde con total, hospitalizados, detalle por edad y participación', () => {
    const entry = populationEntry('cuantos niños enfermos tengo?')!;
    const answer = entry.buildAnswer([
      { grupo_edad: '0-4', pacientes: 120, hospitalizados: 40, pacientes_periodo: 1000 },
      { grupo_edad: '5-17', pacientes: 80, hospitalizados: 25, pacientes_periodo: 1000 },
    ]);
    expect(answer).toBe(
      'Este mes ingresaron 200 niños y adolescentes (0 a 17 años); 65 de ellos quedaron hospitalizados. ' +
        'Por grupo de edad: 0-4 años, 120; 5-17 años, 80. Son el 20 % de los 1.000 pacientes del periodo.',
    );
    expect(entry.buildAnswer([])).toBe(NO_DATA_ANSWER);
  });

  it('concuerda en género y ordena los grupos de edad por número', () => {
    const answer = populationEntry('cuantas mujeres ingresaron esta semana')!.buildAnswer([
      { grupo_edad: '18-29', pacientes: 106, hospitalizados: 50, pacientes_periodo: 789 },
      { grupo_edad: '5-17', pacientes: 103, hospitalizados: 40, pacientes_periodo: 789 },
      { grupo_edad: '0-4', pacientes: 54, hospitalizados: 20, pacientes_periodo: 789 },
    ]);
    expect(answer).toContain('110 de ellas quedaron hospitalizadas');
    expect(answer).toContain('Por grupo de edad: 0-4 años, 54; 5-17 años, 103; 18-29 años, 106.');
  });

  it('el SQL pasa el validador del agente', async () => {
    for (const q of [
      'cuantos niños enfermos tengo',
      'mujeres hospitalizadas hoy',
      'pacientes adultos mayores esta semana',
    ]) {
      const v = await validateSql(populationEntry(q)!.sql);
      expect(v.ok, `${q}: ${v.ok ? '' : v.reason}`).toBe(true);
    }
  });
});

describe('edad con umbral y total de pacientes', () => {
  it('"cuantos pacientes mayores tengo de 70 años?": grupos que cubren esa edad, con aclaración', () => {
    const entry = populationEntry('cuantos pacientes mayores tengo de 70 años?')!;
    expect(entry.sql).toContain("age_group IN ('60-74', '75+')");
    const answer = entry.buildAnswer([
      { grupo_edad: '75+', pacientes: 90, hospitalizados: 60, pacientes_periodo: 2391 },
      { grupo_edad: '60-74', pacientes: 150, hospitalizados: 80, pacientes_periodo: 2391 },
    ]);
    expect(answer).toContain('ingresaron 240 pacientes de 60 años o más');
    expect(answer).toContain('sin corte exacto en 70 años: se incluye el grupo 60-74');
  });

  it('corte exacto sin aclaración y menores de N', () => {
    expect(populationEntry('pacientes de 75 años o más')!.sql).toContain("age_group IN ('75+')");
    expect(
      populationEntry('pacientes mayores de 74 años')!.buildAnswer([
        { grupo_edad: '75+', pacientes: 9, hospitalizados: 1, pacientes_periodo: 9 },
      ]),
    ).not.toContain('sin corte exacto');
    expect(populationEntry('cuantos pacientes menores de 18 años')!.sql).toContain("age_group IN ('0-4', '5-17')");
    expect(populationEntry('cuantos pacientes menores de edad')!.sql).toContain("age_group IN ('0-4', '5-17')");
  });

  it('"cuantos pacientes tengo?": total del periodo sin filtro de población', () => {
    const entry = populationEntry('cuantos pacientes tengo?')!;
    expect(entry.sql).not.toContain(' IN (');
    expect(
      entry.buildAnswer([
        { grupo_edad: '0-4', pacientes: 386, hospitalizados: 200, pacientes_periodo: 2391 },
        { grupo_edad: '18-29', pacientes: 500, hospitalizados: 300, pacientes_periodo: 2391 },
      ]),
    ).toBe(
      'Este mes ingresaron 886 pacientes; 500 de ellos quedaron hospitalizados. Por grupo de edad: 0-4 años, 386; 18-29 años, 500.',
    );
    expect(idOf('cuantos pacientes tengo?')).toBe('patients_by_population');
    expect(idOf('¿Qué servicio tiene más pacientes ingresados este mes?')).toBe('top_service_admissions_month');
    expect(populationEntry('cuantos pacientes con apendicitis')).toBeNull();
  });

  it('el SQL pasa el validador', async () => {
    for (const q of [
      'cuantos pacientes tengo',
      'cuantos pacientes mayores tengo de 70 años?',
      'pacientes menores de 12 años',
    ]) {
      const v = await validateSql(populationEntry(q)!.sql);
      expect(v.ok, `${q}: ${v.ok ? '' : v.reason}`).toBe(true);
    }
  });
});

describe('camas libres', () => {
  it.each(['cuantas camas tengo vacias?', 'cuántas camas libres hay hoy', 'camas disponibles', 'camas libres en UCI'])(
    'responde: %s',
    (q) => expect(idOf(q)).toBe('free_beds_today'),
  );

  it('las preguntas de ocupación siguen yendo a su entrada', () => {
    expect(idOf('¿Cuántas camas de UCI están ocupadas hoy?')).toBe('uci_beds_today');
    expect(idOf('ocupación por servicio hoy')).toBe('occupancy_by_service_today');
  });

  it('responde con el total, el servicio con más camas libres y los llenos', () => {
    const entry = PLAN_B.find((e) => e.id === 'free_beds_today')!;
    expect(
      entry.buildAnswer([
        { servicio: 'HOSPITALIZACION', libres: 55, ocupadas: 169, capacidad: 224 },
        { servicio: 'PEDIATRIA', libres: 3, ocupadas: 20, capacidad: 23 },
        { servicio: 'SALA PARTOS', libres: 0, ocupadas: 6, capacidad: 6 },
      ]),
    ).toBe(
      'Hoy hay 58 camas libres de 253 en el hospital. Hospitalizacion tiene más disponibilidad, con 55 libres. Sin camas libres: Sala partos.',
    );
  });

  it('el SQL pasa el validador del agente', async () => {
    const v = await validateSql(PLAN_B.find((e) => e.id === 'free_beds_today')!.sql);
    expect(v.ok).toBe(true);
  });
});
