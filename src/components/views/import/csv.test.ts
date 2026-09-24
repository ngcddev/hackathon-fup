import { describe, expect, it } from 'vitest';
import { IMPORT_COLUMNS } from '@/lib/types/api';
import { normalizeHeader, parseCsv } from './csv';
import { closestTarget, guessMapping } from './mapping';

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

describe('guessMapping', () => {
  it('reconoce los nombres técnicos exactos', () => {
    expect(guessMapping('bed_inventory', ['bed_code', 'is_active'], ['BED_CODE', 'Is Active'])).toEqual({
      bed_code: 'BED_CODE',
      is_active: 'Is Active',
    });
  });

  it('reconoce encabezados en español con tildes y mayúsculas', () => {
    const headers = ['Código', 'Descripción', 'Fecha de corte', 'Existencia', 'Unidad de medida', 'Fecha de vencimiento'];
    expect(guessMapping('drug_stock', IMPORT_COLUMNS.drug_stock, headers)).toEqual({
      item_code: 'Código',
      item_name: 'Descripción',
      stock_date: 'Fecha de corte',
      current_stock: 'Existencia',
      unit: 'Unidad de medida',
      expiration_date: 'Fecha de vencimiento',
    });
  });

  it('reconoce los nombres del HIS en camelCase', () => {
    const headers = ['ConsecutivoProgramacion', 'IdPaciente', 'OidIngreso', 'CodigoServicio', 'FechaProgramacion', 'Quirófano'];
    expect(guessMapping('surgery_schedules', IMPORT_COLUMNS.surgery_schedules, headers)).toEqual({
      schedule_number: 'ConsecutivoProgramacion',
      patient_id: 'IdPaciente',
      admission_id: 'OidIngreso',
      service_code: 'CodigoServicio',
      scheduled_date: 'FechaProgramacion',
      operating_room: 'Quirófano',
    });
  });

  it('no usa el mismo encabezado para dos columnas y prefiere la coincidencia más segura', () => {
    // "Fecha" sirve para stock_date; "Vencimiento" no debe quedarse sin columna por ello.
    const out = guessMapping('drug_stock', IMPORT_COLUMNS.drug_stock, ['fecha', 'vencimiento', 'codigo']);
    expect(out).toEqual({ stock_date: 'fecha', expiration_date: 'vencimiento', item_code: 'codigo' });
  });

  it('usa coincidencias parciales de varias palabras', () => {
    expect(guessMapping('drug_stock', ['expiration_date'], ['Fecha de vencimiento del lote'])).toEqual({
      expiration_date: 'Fecha de vencimiento del lote',
    });
  });

  it('deja sin asignar lo que no reconoce', () => {
    expect(guessMapping('drug_stock', IMPORT_COLUMNS.drug_stock, ['columna_x', 'otra'])).toEqual({});
  });
});

describe('closestTarget', () => {
  it('identifica la plantilla a la que pertenece el archivo', () => {
    expect(closestTarget([...IMPORT_COLUMNS.drug_stock])).toEqual({ target: 'drug_stock', matched: 6 });
    expect(closestTarget(['Código cama', 'Servicio', 'Subservicio', 'Activa'])?.target).toBe('bed_inventory');
    expect(closestTarget(['x', 'y'])).toBeNull();
  });
});
