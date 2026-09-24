// Matriz de permisos AUT-03. Vive solo aquí, versionada en Git; la base de datos
// solo guarda el rol de cada usuario. Se aplica en el servidor (SEG-15).

import type { ImportTarget } from '@/lib/types/api';

export const ROLES = ['director', 'service_head', 'administrative', 'pharmacy', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'dashboard:view', // Dashboard y alertas (GET /api/kpis)
  'summary:view', // Resumen del día (solo si se implementa D5)
  'agent:query', // Agente conversacional (POST /api/query)
  'sources:view', // Panel de fuentes e historial de importaciones (GET /api/sources)
  'import:bed_inventory', // Importar inventario de camas
  'import:surgery_schedules', // Importar programación quirúrgica
  'import:drug_stock', // Importar inventario de medicamentos
  'import:his_tables', // Importación incremental de tablas del HIS (IMP-10, Could)
  'import:revert', // Revertir un lote de importación
  'users:manage', // Gestionar usuarios
  'logs:view', // Log de consultas del agente y de administración (AUT-15, Could)
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_ROLES: readonly Role[] = ROLES;

export const PERMISSION_MATRIX: Record<Permission, readonly Role[]> = {
  'dashboard:view': ALL_ROLES,
  'summary:view': ALL_ROLES,
  'agent:query': ALL_ROLES,
  'sources:view': ALL_ROLES,
  'import:bed_inventory': ['administrative', 'admin'],
  'import:surgery_schedules': ['administrative', 'admin'],
  'import:drug_stock': ['pharmacy', 'admin'],
  'import:his_tables': ['admin'],
  'import:revert': ['admin'],
  'users:manage': ['admin'],
  'logs:view': ['admin'],
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSION_MATRIX[permission].includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((permission) => can(role, permission));
}

const IMPORT_PERMISSION_BY_TARGET: Record<ImportTarget, Permission> = {
  bed_inventory: 'import:bed_inventory',
  surgery_schedules: 'import:surgery_schedules',
  drug_stock: 'import:drug_stock',
};

export function importPermissionFor(target: ImportTarget): Permission {
  return IMPORT_PERMISSION_BY_TARGET[target];
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
