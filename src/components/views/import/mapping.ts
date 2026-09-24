// Sugerencia automática del mapeo entre las columnas de la plantilla y los encabezados del archivo.

import { IMPORT_COLUMNS, IMPORT_TARGETS, type ImportTarget } from '@/lib/types/api';
import { normalizeHeader } from './csv';

// Otros nombres con que suele venir cada columna: español, abreviaturas y los nombres del HIS.
// Se comparan normalizados (sin tildes, mayúsculas ni separadores), así que "Fecha de corte",
// "FECHA_CORTE" y "fechaCorte" cuentan igual.
const SYNONYMS: Record<ImportTarget, Record<string, readonly string[]>> = {
  drug_stock: {
    item_code: ['codigo', 'cod', 'codigo medicamento', 'codigo producto', 'codigo articulo', 'codigo item', 'cod producto', 'referencia', 'cum', 'id producto'],
    item_name: ['nombre', 'descripcion', 'medicamento', 'producto', 'articulo', 'nombre medicamento', 'nombre producto', 'descripcion producto'],
    stock_date: ['fecha', 'fecha corte', 'fecha inventario', 'fecha foto', 'fecha existencia', 'corte'],
    current_stock: ['existencia', 'existencias', 'stock', 'stock actual', 'cantidad', 'cantidad disponible', 'disponible', 'saldo', 'inventario'],
    unit: ['unidad', 'unidad medida', 'unidad de medida', 'um', 'presentacion'],
    expiration_date: ['vencimiento', 'fecha vencimiento', 'fecha de vencimiento', 'vence', 'caducidad', 'fecha caducidad'],
  },
  bed_inventory: {
    bed_code: ['codigo cama', 'cod cama', 'id cama', 'codigo'],
    bed_name: ['nombre cama', 'cama', 'nombre', 'descripcion', 'descripcion cama'],
    bed_group: ['servicio', 'grupo', 'grupo cama', 'area', 'pabellon'],
    bed_subgroup: ['subservicio', 'sub servicio', 'subgrupo', 'sub grupo', 'subgrupo cama', 'sala', 'unidad'],
    is_active: ['activa', 'activo', 'esta activa', 'estado', 'habilitada', 'habilitado', 'vigente'],
  },
  surgery_schedules: {
    schedule_number: ['consecutivo programacion', 'numero programacion', 'no programacion', 'consecutivo', 'programacion'],
    patient_id: ['id paciente', 'codigo paciente', 'paciente'],
    admission_id: ['oid ingreso', 'id ingreso', 'numero ingreso', 'ingreso'],
    service_code: ['codigo servicio', 'codigo procedimiento', 'procedimiento', 'cups', 'servicio'],
    scheduled_date: ['fecha programacion', 'fecha programada', 'fecha cirugia', 'fecha'],
    operating_room: ['quirofano', 'sala', 'sala cirugia'],
  },
};

// Clave de comparación: "Id_Paciente", "IdPaciente" e "id paciente" dan "idpaciente".
const compact = (value: string) => normalizeHeader(value).replace(/_/g, '');
const tokens = (value: string) => normalizeHeader(value.replace(/([a-z])([A-Z])/g, '$1_$2')).split('_').filter(Boolean);

// 3: nombre técnico exacto. 2: sinónimo exacto. 1: el encabezado contiene todas las palabras de un
// sinónimo de dos o más palabras (p. ej. "Fecha de vencimiento del lote"). 0: no se parecen.
function score(column: string, synonyms: readonly string[], header: string): number {
  const key = compact(header);
  if (!key) return 0;
  if (key === compact(column)) return 3;
  if (synonyms.some((s) => compact(s) === key)) return 2;
  const words = new Set(tokens(header));
  const partial = synonyms.some((s) => {
    const parts = tokens(s);
    return parts.length > 1 && parts.every((p) => words.has(p));
  });
  return partial ? 1 : 0;
}

// Asigna primero las coincidencias más seguras y nunca usa el mismo encabezado para dos columnas.
export function guessMapping(target: ImportTarget, template: readonly string[], headers: string[]): Record<string, string> {
  const synonyms = SYNONYMS[target];
  const candidates: { column: string; header: string; score: number; order: number }[] = [];
  template.forEach((column, order) => {
    for (const header of headers) {
      const s = score(column, synonyms[column] ?? [], header);
      if (s > 0) candidates.push({ column, header, score: s, order });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);

  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const c of candidates) {
    if (out[c.column] || used.has(c.header)) continue;
    out[c.column] = c.header;
    used.add(c.header);
  }
  return out;
}

// Plantilla a la que más se parece el archivo, para avisar cuando se sube en la sección equivocada.
export function closestTarget(headers: string[]): { target: ImportTarget; matched: number } | null {
  let best: { target: ImportTarget; matched: number } | null = null;
  for (const target of IMPORT_TARGETS) {
    const matched = Object.keys(guessMapping(target, IMPORT_COLUMNS[target], headers)).length;
    if (matched > 0 && (!best || matched > best.matched)) best = { target, matched };
  }
  return best;
}
