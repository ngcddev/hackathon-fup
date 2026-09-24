import 'server-only';
import { ApiError } from '@/lib/api/errors';

// Los errores de pg traen nombres de tablas, columnas y fragmentos de SQL: nunca salen tal cual.
// El detalle va a console.error del servidor y quien llama recibe un INTERNAL_ERROR genérico,
// que toErrorResponse convierte en la respuesta única de la API.
export function toInternalError(context: string, error: unknown): ApiError {
  console.error(`[db] ${context}:`, error);
  return new ApiError('INTERNAL_ERROR', undefined, { cause: error });
}
