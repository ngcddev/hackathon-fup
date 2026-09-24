@AGENTS.md

# Sistema de Gestión Hospitalaria Inteligente (Hospital Susana López de Valencia)

MVP de hackathon (entrega: jueves 1 p.m.). Dashboard de KPIs, alertas, agente conversacional NL2SQL, importador de hojas de cálculo con trazabilidad, administración de usuarios y roles. Documentos de referencia:

- `docs/levante_requerimientos_hslv.md`: requerimientos (IDs como AUT-03, SEG-01, RNF-16).
- `docs/modelo_datos_hslv.md`: esquemas `staging`, `core`, `agent`, `audit`.
- `docs/api-contract.md`: contrato de la API (fuente de verdad junto con `src/lib/types/api.ts`).

## Instrucción de propiedad (léela antes de editar)

**Antes de editar un archivo, confirma que su carpeta pertenece a quien te está usando según la tabla de propiedad; si no, detente y avisa.**

## Stack y decisiones cerradas

- Next.js 16 (App Router) + Supabase (Postgres y Auth) + Vercel. Monolito MVC: vistas en `src/app`, controladores en `src/app/api/*/route.ts`, lógica en `src/lib`. Alias `@/*` → `src/*`. **Next.js 16 tiene cambios incompatibles: lee `node_modules/next/dist/docs/` antes de escribir código** (por ejemplo, `params` de un route handler es una `Promise`).
- Agente: Gemini (principal), Groq (respaldo) y plan B con preguntas predefinidas. Costo 0 USD.
- Fecha de referencia ("hoy"): 2026-09-21, guardada en `core.app_settings` y expuesta con `agent.reference_date()`. Nunca `CURRENT_DATE`.
- Autenticación con Supabase Auth; el rol vive en `core.user_profiles`. Un usuario, un rol: `director`, `service_head`, `medic`, `admin`.
- La matriz de permisos vive solo en `src/lib/auth/permissions.ts`, no en la base.
- supabase-js: Auth y consultas fijas del dashboard sobre el esquema `agent`. Todo lo de `core` y `audit` va por la conexión pg con el rol que corresponda (`agent_ro`, `importer`, `app_backend`).
- Importación en 3 pasos: crear lote, enviar filas en trozos menores de 4 MB, aplicar. Todo o nada.
- Datos simulados o derivados siempre quedan marcados (`data_origin`, `is_simulated`).

## Propiedad de carpetas

Las rutas de `/lib` y `/app` viven bajo `src/`.

| Dueño | Carpetas |
|---|---|
| **Camilo** | `/supabase`, `/scripts/load`, `/lib/db`, `/lib/queries`, `/lib/alerts`, `/app/api/kpis`, `/app/api/import`, `/app/api/sources` |
| **Nicolás** | `/lib/auth`, `/lib/agent`, `/lib/api`, `/lib/types`, `middleware.ts`, `/app/api/query`, `/app/api/admin`, `/app/api/me`, `/scripts/seed`, `/scripts/bootstrap-admin`, `/docs`, `/mocks` |
| **Andrés** | Páginas y componentes: `/app` (salvo `/app/api`) y `/components` |

Si una carpeta no está en la tabla, pregunta antes de editar. Un cambio en una carpeta ajena se pide al dueño; no se hace por su cuenta.

## Reglas no negociables

1. **Solo SELECT para el agente.** Una sola sentencia, `LIMIT` máximo 200, `statement_timeout` de 5 s, rol `agent_ro`, solo vistas del esquema `agent`.
2. **Sin PII.** Nada de nombre, documento, motivo de consulta ni id real del paciente en vistas, respuestas, logs, caché del dispositivo ni prompts del LLM. `patient_key` nunca aparece en una respuesta de la API.
3. **Credenciales solo en `.env`** (en `.gitignore`). Se publica `.env.example` sin valores.
4. **La service role key y la API key del LLM solo existen en el servidor**, en variables sin prefijo `NEXT_PUBLIC_`.
5. **Permisos verificados en el servidor** (middleware y cada controlador con `withAuth`). Ocultar un botón no es control de acceso.
6. Las importaciones nunca sobrescriben datos existentes (SEG-12) y usan el rol `importer`.
7. Nunca se devuelven trazas ni mensajes de Postgres al cliente.

## Contrato de la API

- **Formato de error único:** `{ "error": { "code": "...", "message": "..." } }` con `message` en español. Catálogo de códigos y status HTTP en un solo lugar: `src/lib/api/errors.ts` (`API_ERROR_CATALOG`). No inventes códigos fuera de él; si falta uno, se agrega ahí y en `docs/api-contract.md`.
- Los controladores lanzan `new ApiError(code, mensaje?)`. `toErrorResponse` lo convierte; una excepción desconocida responde 500 genérico y el detalle solo va al log.
- Cada controlador se exporta envuelto: `export const GET = withAuth('dashboard:view', async (request, ctx) => { ... })`. `ctx` trae `user` (`id`, `full_name`, `role`) y `params` ya resuelto. `withAuth(null, ...)` exige solo sesión.
- Permisos: nombres exactos de `src/lib/auth/permissions.ts` (`dashboard:view`, `agent:query`, `sources:view`, `import:*`, `users:manage`, `logs:view`). Para importar: `importPermissionFor(target)`.
- Tipos de request y response: `src/lib/types/api.ts`. Sin `any`.
- Ejemplos por endpoint en `mocks/*.json` (`{ request, response }`), verificados por `mocks/check.ts`. El frontend puede trabajar contra ellos mientras el backend no esté listo.
- `AUTH_STUB=true` y `AUTH_STUB_ROLE=<rol>` inyectan un usuario falso solo en desarrollo (nunca en producción). Sin ellos, `withAuth` responde 401.

## Convenciones

- Código, nombres de variables, tablas y columnas en **inglés**; documentación, comentarios y mensajes al usuario en **español**.
- JSON en `snake_case` (igual que las columnas). Fechas ISO 8601: las del HIS sin zona (hora de Colombia), las de auditoría con zona.
- Interfaz en español, en blanco y negro, legible en proyector.
- Ramas `feature/*`, PRs pequeños hacia `main`. Un PR por cambio coherente; el PR toca solo carpetas de su dueño.
- No se hace commit de `.env`, datos reales (`data/`) ni claves. No se añaden líneas de atribución a Claude en commits ni PRs.

## Definición de terminado

- `npx tsc --noEmit` compila sin errores.
- `npm run lint` sin errores ni advertencias nuevas.
- Sin secretos en el código ni en el bundle del cliente.
- Cada endpoint aplica su permiso con `withAuth` y responde errores con el formato único.
- Si cambia el contrato, se actualizan `docs/api-contract.md`, `src/lib/types/api.ts` y los mocks en el mismo PR.

## Comandos

```bash
npm run dev            # servidor local
npx tsc --noEmit       # verificación de tipos (incluye mocks/check.ts)
npm run lint           # ESLint
```
