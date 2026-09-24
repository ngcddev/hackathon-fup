// Cliente de la API para el navegador. Traduce el formato único de error
// ({ error: { code, message } }) a una excepción tipada y maneja la sesión vencida.

import type { ApiErrorCode } from '@/lib/api/errors';
import type { ApiErrorResponse } from '@/lib/types/api';

export type ClientErrorCode = ApiErrorCode | 'NETWORK';

export class ClientApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;

  constructor(code: ClientErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ClientApiError';
    this.code = code;
    this.status = status;
  }
}

const NETWORK_MESSAGE = 'No hay conexión con el servidor. Revisa tu red e intenta de nuevo.';
const UNKNOWN_MESSAGE = 'Ocurrió un error inesperado. Intenta de nuevo en unos minutos.';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ClientApiError('NETWORK', NETWORK_MESSAGE, 0);
  }

  if (response.status === 401 && typeof window !== 'undefined') {
    // Sesión vencida: recarga completa para que el proxy limpie el estado y lleve al inicio de sesión.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login';
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as ApiErrorResponse | null)?.error;
    throw new ClientApiError(error?.code ?? 'INTERNAL_ERROR', error?.message ?? UNKNOWN_MESSAGE, response.status);
  }
  return payload as T;
}

// Los GET idénticos que están en vuelo comparten una sola solicitud (doble montaje de React, varias vistas).
const inflight = new Map<string, Promise<unknown>>();

export function apiGet<T>(url: string): Promise<T> {
  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;
  const promise = request<T>('GET', url).finally(() => inflight.delete(url));
  inflight.set(url, promise);
  return promise;
}

export const apiPost = <T>(url: string, body?: unknown) => request<T>('POST', url, body);
export const apiPatch = <T>(url: string, body: unknown) => request<T>('PATCH', url, body);

export function errorMessage(error: unknown): string {
  return error instanceof ClientApiError ? error.message : UNKNOWN_MESSAGE;
}
