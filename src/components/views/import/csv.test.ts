import { describe, expect, it } from 'vitest';
import { normalizeHeader, parseCsv } from './csv';

describe('parseCsv', () => {
  it('lee comas, comillas y saltos de línea dentro de una celda', () => {
    expect(parseCsv('a,b\n"x, y","línea 1\nlínea 2"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'línea 1\nlínea 2'],
    ]);
  });

  it('detecta punto y coma (Excel en español) y quita el BOM', () => {
    expect(parseCsv('﻿codigo;nombre\r\nA-1;Cama 1\r\n')).toEqual([
      ['codigo', 'nombre'],
      ['A-1', 'Cama 1'],
    ]);
  });

  it('descarta líneas vacías y respeta comillas escapadas', () => {
    expect(parseCsv('a\n\n"di ""hola"""\n,\n')).toEqual([['a'], ['di "hola"']]);
  });
});

describe('normalizeHeader', () => {
  it('quita tildes, mayúsculas y separadores', () => {
    expect(normalizeHeader('Sub Servicio')).toBe('sub_servicio');
    expect(normalizeHeader('Código de cama')).toBe('codigo_de_cama');
  });
});
