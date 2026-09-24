import { describe, expect, it } from 'vitest';
import { isSensitiveQuestion, redactQuestionForLog, stripPatientKey } from './privacy';

describe('isSensitiveQuestion (SEG-04)', () => {
  it.each([
    '¿Cómo se llama el paciente con cédula 1061234567?',
    'dame el teléfono del paciente',
    '¿Cuál es la dirección de la paciente María?',
    'historia clínica de Juan Pérez',
    'necesito el número de documento del paciente',
    'busca al paciente 1.061.234.567',
    '¿Cuál es el nombre del paciente que ingresó ayer?',
    'quién es el paciente con más ingresos',
    'diagnóstico del paciente en la cama 5',
    'paciente con id 987654',
  ])('rechaza: %s', (q) => expect(isSensitiveQuestion(q)).toBe(true));

  it.each([
    '¿Cuántas camas de UCI están ocupadas hoy?',
    '¿Cuáles son los medicamentos con menos de 5 días de inventario?',
    '¿Cuál es el tiempo de espera promedio en urgencias en la última semana?',
    '¿Qué servicio tiene más pacientes ingresados este mes?',
    '¿Cuál es el nombre del servicio con más ingresos?',
    '¿Cuántos ingresos hubo en 2026?',
    'top 10 de medicamentos más dispensados en 30 días',
  ])('permite: %s', (q) => expect(isSensitiveQuestion(q)).toBe(false));
});

describe('redactQuestionForLog', () => {
  it('quita números de documento', () => {
    expect(redactQuestionForLog('cédula 1061234567 y 1.061.234.567')).not.toMatch(/\d{6}/);
  });
});

describe('stripPatientKey', () => {
  it('quita la columna aunque la consulta la haya seleccionado', () => {
    const out = stripPatientKey(['service', 'patient_key', 'n'], [{ service: 'A', patient_key: 'abc', n: 1 }]);
    expect(out.columns).toEqual(['service', 'n']);
    expect(out.rows).toEqual([{ service: 'A', n: 1 }]);
  });

  it('no distingue mayúsculas', () => {
    expect(stripPatientKey(['PATIENT_KEY'], [{ PATIENT_KEY: 'x' }]).columns).toEqual([]);
  });

  it('sin la columna, devuelve lo mismo', () => {
    const rows = [{ a: 1 }];
    expect(stripPatientKey(['a'], rows).rows).toBe(rows);
  });
});
