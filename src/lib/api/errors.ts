// Catálogo único de errores de la API (RNF-16). Todo endpoint responde
// { error: { code, message } } con el status HTTP de este catálogo.

export const API_ERROR_CATALOG = {
  UNAUTHENTICATED: { status: 401, message: 'Debes iniciar sesión para continuar.' },
  FORBIDDEN: { status: 403, message: 'No tienes permiso para realizar esta acción.' },
  ACCOUNT_DISABLED: { status: 403, message: 'Tu cuenta está desactivada. Contacta al administrador.' },
  VALIDATION_ERROR: { status: 400, message: 'Los datos enviados no son válidos.' },
  NOT_FOUND: { status: 404, message: 'No se encontró el recurso solicitado.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'El contenido enviado supera el tamaño permitido.' },
  BATCH_REJECTED: { status: 422, message: 'El lote tiene filas inválidas y no se aplicó ningún dato.' },
  BATCH_INVALID_STATE: { status: 422, message: 'El lote no está en un estado que permita esta operación.' },
  DUPLICATE_STOCK_DATE: { status: 422, message: 'Ya existe una foto de inventario con esa fecha para alguno de los medicamentos.' },
  SENSITIVE_DATA_REQUESTED: { status: 422, message: 'No se pueden consultar datos que identifiquen a un paciente.' },
  OUT_OF_SCOPE: { status: 422, message: 'La pregunta está fuera del alcance de los datos disponibles.' },
  LAST_ADMIN_REQUIRED: { status: 422, message: 'Debe quedar al menos un administrador activo.' },
  SELF_MODIFICATION_NOT_ALLOWED: { status: 422, message: 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo.' },
  AGENT_UNAVAILABLE: { status: 503, message: 'El asistente no está disponible en este momento. Intenta de nuevo en unos minutos.' },
  INTERNAL_ERROR: { status: 500, message: 'Ocurrió un error inesperado. Intenta de nuevo en unos minutos.' },
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CATALOG;

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  // `message` es opcional: si se omite se usa el del catálogo. Debe estar en
  // español y listo para mostrar al usuario; nunca detalle de Postgres.
  constructor(code: ApiErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? API_ERROR_CATALOG[code].message, options);
    this.name = 'ApiError';
    this.code = code;
    this.status = API_ERROR_CATALOG[code].status;
  }
}

function errorResponse(code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status: API_ERROR_CATALOG[code].status });
}

// Convierte cualquier excepción al formato único. Una excepción desconocida
// responde 500 con mensaje genérico; el detalle solo va al log del servidor.
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return errorResponse(error.code, error.message);
  }
  console.error('[api] Error no controlado:', error);
  return errorResponse('INTERNAL_ERROR', API_ERROR_CATALOG.INTERNAL_ERROR.message);
}
