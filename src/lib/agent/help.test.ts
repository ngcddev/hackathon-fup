import { describe, expect, it } from 'vitest';
import { detectHelp, helpAnswer, helpRows } from './help';
import { matchPlanB } from './plan-b';

describe('detectHelp', () => {
  it.each([
    '¿Qué puedo consultar contigo?',
    'que puedo consultar',
    'QUÉ PUEDO PREGUNTARTE?',
    '¿Qué datos tienes?',
    'que informacion manejas',
    'cuentame mas de la info que tienes',
    '¿En qué me puedes ayudar?',
    'Hola, ¿qué puedes hacer?',
    'ayuda',
    '¿Cómo funciona esto?',
    '¿Quién eres?',
    'dame ejemplos de preguntas',
    'buenas tardes, dime que puedo consultar por favor',
    '¿Sobre qué temas me puedes informar?',
    'no sé qué preguntarte, oriéntame',
  ])('reconoce como ayuda: %s', (q) => {
    expect(detectHelp(q)).toBe('help');
  });

  it.each(['hola', 'Buenos días', '¡Hola! ¿Cómo estás?'])('reconoce saludos: %s', (q) => {
    expect(detectHelp(q)).toBe('greeting');
  });

  it.each(['gracias', 'Muchas gracias!', 'ok', 'perfecto'])('reconoce agradecimientos: %s', (q) => {
    expect(detectHelp(q)).toBe('thanks');
  });

  it.each([
    '¿Cuántas camas de UCI están ocupadas hoy?',
    'hola, cuantas camas de uci hay ocupadas',
    'que datos tienes de medicamentos por agotarse',
    'cuantos pacientes tengo',
    'ayuda con la ocupacion de urgencias',
    '¿Qué medicamentos puedo consultar con menos de 5 días?',
    '',
  ])('no intercepta preguntas de datos: %s', (q) => {
    expect(detectHelp(q)).toBeNull();
  });
});

describe('respuesta de ayuda', () => {
  it('trae un ejemplo por tema y cada ejemplo responde con el plan B', () => {
    const rows = helpRows();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      expect(row.ejemplo_de_pregunta).not.toBe('');
      expect(matchPlanB(row.ejemplo_de_pregunta)).not.toBeNull();
    }
  });

  it('muestra la fecha de corte', () => {
    expect(helpAnswer('help', '2026-09-21')).toContain('21/09/2026');
  });
});
