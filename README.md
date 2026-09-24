# Sistema de Gestión Hospitalaria Inteligente

MVP para el **Hospital Susana López de Valencia E.S.E.** (Popayán, Cauca). Centraliza los datos del HIS y de las hojas de cálculo del hospital en una sola base. Tiene un dashboard de KPIs con alertas y recomendaciones, un agente que responde preguntas en español (NL2SQL) y un importador de hojas de cálculo con trazabilidad. El acceso se controla por usuario y rol.

- **Stack:** Next.js 16 (App Router) + React 19, Supabase (Postgres y Auth), Vercel. Tailwind CSS 4.
- **Agente:** Gemini como proveedor principal, Groq como respaldo y un plan B con preguntas predefinidas. Costo 0 USD.
- **Fecha de referencia ("hoy"):** 2026-09-21. Vive en `core.app_settings` y se lee con `agent.reference_date()`; nunca se usa `CURRENT_DATE`.

## Contenido

1. [Funcionalidades](#funcionalidades)
2. [Arquitectura](#arquitectura)
3. [Requisitos](#requisitos)
4. [Puesta en marcha desde cero](#puesta-en-marcha-desde-cero)
5. [Desarrollo diario](#desarrollo-diario)
6. [Roles y permisos](#roles-y-permisos)
7. [API](#api)
8. [Importar hojas de cálculo](#importar-hojas-de-cálculo)
9. [Verificación](#verificación)
10. [Despliegue en Vercel](#despliegue-en-vercel)
11. [Reglas del proyecto](#reglas-del-proyecto)
12. [Documentación](#documentación)

## Funcionalidades

| Pantalla | Ruta | Qué muestra |
|---|---|---|
| Resumen | `/` | KPIs principales (ocupación, urgencias, medicamentos, cirugías e ingresos), alertas prioritarias, tendencia de ocupación y estado de los datos. |
| Agente IA | `/agent` | Preguntas en lenguaje natural; responde con texto, tabla y acceso al módulo relacionado. |
| Pacientes e ingresos | `/patients` | Ingresos por año, mes y día, tiempos de espera en urgencias y causa del cambio. |
| Camas | `/beds` | Ocupación total y por servicio y subservicio (desplegable), tendencia de 30 días y estancia promedio. |
| Medicamentos | `/drugs` | Inventario y días de inventario; medicamentos críticos. |
| Cirugías | `/surgeries` | Cumplimiento quirúrgico. |
| Alertas | `/alerts` | Alertas con severidad, acción recomendada y sugerencia de la IA. |
| Fuentes de datos | `/sources` | Tablas cargadas, porcentaje de datos simulados e historial de importaciones. |
| Usuarios | `/users` | Alta, edición, desactivación y cambio de contraseña (solo admin). |
| Registro de actividad | `/logs` | Consultas al agente y acciones de administración (solo admin). |
| Documentación | `/docs` | Guía de uso dentro de la aplicación. |

La interfaz está en español, en blanco y negro, legible en proyector y adaptada a celular. Se puede instalar como app (PWA). Sin conexión muestra la última copia de los KPIs.

## Arquitectura

Monolito MVC en Next.js:

```
src/
  app/                 Vistas (App Router)
    (app)/             Pantallas con sesión: resumen, agent, beds, drugs, ...
    login/             Inicio de sesión
    api/*/route.ts     Controladores (cada uno envuelto en withAuth)
  components/          Componentes de interfaz (app, ui, views, login)
  lib/
    auth/              Sesión, withAuth y matriz de permisos (permissions.ts)
    agent/             Agente NL2SQL: prompt, validación del SQL, plan B, privacidad
    api/               Catálogo de errores (errors.ts) y cliente del navegador
    db/                Pools de pg por rol de Postgres
    queries/           Consultas del dashboard (KPIs, insights, fuentes)
    alerts/            Umbrales y reglas de alertas
    import/            Importación de plantillas y reversión de lotes
    types/api.ts       Tipos de request y response (contrato)
supabase/
  migrations/          Esquema completo (fuente de verdad del modelo de datos)
  tests/               Verificaciones de la carga y valores esperados de la demo
scripts/               Carga histórica, usuarios, verificaciones
docs/                  Requerimientos, modelo de datos, contrato de la API
mocks/                 Ejemplos { request, response } por endpoint
```

### Base de datos

Cuatro esquemas en Postgres:

| Esquema | Contenido |
|---|---|
| `staging` | Copia en texto de los archivos del HIS y de las plantillas importadas, antes de validar. |
| `core` | Datos limpios: pacientes, ingresos, triage, servicios, medicamentos, cirugías, camas, usuarios. |
| `agent` | Vistas agregadas y sin datos personales. Es lo único que el agente puede consultar. |
| `audit` | Lotes de importación, errores por fila, log de consultas y de administración. |

La aplicación se conecta con un rol de Postgres distinto según la tarea:

| Rol | Uso | Permisos |
|---|---|---|
| `app_backend` | Sesión, dashboard, administración y logs. | Lectura de `core` y `agent`; escritura de perfiles y logs. |
| `agent_ro` | SQL generado por el agente. | Solo `SELECT` sobre `agent`, `statement_timeout` de 5 s. |
| `importer` | Importador de plantillas. | Inserta en `staging` y lotes, y ejecuta `core.apply_batch`. |

Supabase Auth maneja las cuentas. El rol de cada usuario vive en `core.user_profiles`, y la matriz de permisos solo en `src/lib/auth/permissions.ts`.

## Requisitos

- Node.js 20 o superior y npm.
- Python 3.11 o superior (solo para la carga histórica del HIS).
- Un proyecto de [Supabase](https://supabase.com).
- Llaves gratuitas de [Google AI Studio](https://aistudio.google.com/apikey) (Gemini) y [Groq](https://console.groq.com/keys) (opcionales: sin ellas el agente usa el plan B).
- Los 7 archivos `.txt` del HIS (`Paciente`, `Triage`, `Ingresos`, `Atencion`, `Servicios`, `MedicamentoInsumo`, `ProgramacionCirugia`). **Son datos reales: nunca se suben al repositorio** (la carpeta `data/` está en `.gitignore`).

## Puesta en marcha desde cero

### 1. Instalar dependencias

```bash
git clone https://github.com/ngcddev/hackathon-fup.git
cd hackathon-fup
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

Next.js lee `.env.local` y `.env`; los scripts de `scripts/` leen `.env.local`. Ambos archivos están en `.gitignore`. Los valores se van llenando en los pasos siguientes:

| Variable | Dónde se obtiene |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API. **Solo servidor.** |
| `HIS_LOAD_DATABASE_URL` | Cadena del usuario `postgres` (Supabase → Connect). Solo en tu máquina, nunca en Vercel. |
| `HIS_DATA_DIR`, `REFERENCE_DATE`, `HIS_ENCODING`, `HIS_SEPARATOR` | Carpeta de los `.txt` del HIS, `2026-09-21`, `utf-8-sig` y `\|`. |
| `DATABASE_URL_APP_BACKEND`, `DATABASE_URL_AGENT_RO`, `DATABASE_URL_IMPORTER` | Paso 4. |
| `BOOTSTRAP_ADMIN_*`, `SEED_*` | Correo, contraseña y nombre de las cuentas iniciales (pasos 6 y 7). |
| `AGENT_LLM_ENABLED`, `GEMINI_*`, `GROQ_*` | `true` y las llaves del agente. Modelos sugeridos: `gemini-3.1-flash-lite` y `openai/gpt-oss-20b`. |
| `AUTH_STUB`, `AUTH_STUB_ROLE` | Solo desarrollo: usuario falso sin Supabase Auth. Déjalos vacíos con sesión real. |

Ninguna clave secreta lleva el prefijo `NEXT_PUBLIC_`.

### 3. Crear el esquema

Aplica las migraciones en orden. Cada una corre dentro de una transacción:

```bash
npx tsx scripts/apply-migration.ts supabase/migrations/20260923120000_initial_schema.sql
npx tsx scripts/apply-migration.ts supabase/migrations/20260923190000_revert_batch_returns_count.sql
npx tsx scripts/apply-migration.ts supabase/migrations/20260924120000_roles_director_service_head_medic_admin.sql
```

La migración inicial se aplica una sola vez sobre un proyecto limpio.

### 4. Credenciales de roles

La migración crea `app_backend`, `agent_ro` e `importer` **sin contraseña**. Asígnalas a mano desde el SQL Editor de Supabase, con contraseñas largas y distintas, fuera del repositorio:

```sql
alter role app_backend with password '...';
alter role agent_ro    with password '...';
alter role importer    with password '...';
```

Arma las tres cadenas con el pooler de Supabase en **modo transaction** (puerto `6543`). El usuario lleva el formato `rol.referencia_del_proyecto`:

```
postgres://app_backend.<referencia>:<contraseña>@aws-0-<región>.pooler.supabase.com:6543/postgres
```

Comprueba que los tres roles conectan:

```bash
npx tsx scripts/db-check.ts
```

### 5. Cargar el histórico del HIS

```bash
pip install -r scripts/load/requirements.txt
python scripts/load/load_his.py --dry-run   # solo lee y valida los archivos, sin base
python scripts/load/load_his.py             # carga completa
```

El script sube los 7 archivos a `staging`, los valida y carga con `core.apply_batch`, deriva el inventario de camas, genera la foto simulada de medicamentos (marcada como simulada) y refresca las vistas. Solo imprime conteos, nunca datos de pacientes. El reporte queda en `scripts/load/output/load_report.md`. Para recargar una tabla: `--only triages`.

Para verificar la carga, ejecuta `supabase/tests/load_check.sql` en el SQL Editor. Cada prueba debe salir `OK`.

### 6. Crear el primer administrador

```bash
npx tsx scripts/bootstrap-admin.ts
```

Usa `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` y `BOOTSTRAP_ADMIN_NAME`. Es idempotente: también sirve para recuperar el acceso si el admin queda bloqueado.

### 7. Usuarios demo por rol (opcional)

```bash
npx tsx scripts/seed/seed-users.ts
```

Crea un usuario `director`, uno `service_head` y uno `medic` con las variables `SEED_*`.

### 8. Esquema del agente (solo si cambian las vistas)

```bash
npx tsx scripts/export-agent-schema.ts
```

Regenera `src/lib/agent/schema.generated.ts`, el esquema que ve el LLM. El prompt nunca consulta la base en tiempo de ejecución.

### 9. Arrancar

```bash
npm run dev
```

Abre <http://localhost:3000> e inicia sesión con el administrador.

## Desarrollo diario

```bash
npm run dev            # servidor local
npx tsc --noEmit       # verificación de tipos (incluye mocks/check.ts)
npm run lint           # ESLint
npm test               # pruebas con Vitest
npm run format         # Prettier
```

> **Next.js 16 trae cambios incompatibles** con versiones anteriores (por ejemplo, `params` de un route handler es una `Promise`). Antes de escribir código, lee la guía correspondiente en `node_modules/next/dist/docs/`.

Si tras un `git pull` con archivos renombrados la app muestra código viejo, reinicia el servidor: `rm -rf .next && npm run dev`.

**Definición de terminado:** `npx tsc --noEmit` y `npm run lint` sin errores; ningún secreto en el código ni en el bundle del cliente; cada endpoint con su permiso en `withAuth` y errores en el formato único. Si cambia el contrato, en el mismo PR se actualizan `docs/api-contract.md`, `src/lib/types/api.ts` y los mocks.

**Flujo de trabajo:** ramas `feature/*` y PRs pequeños hacia `main`. Cada PR toca solo las carpetas de su dueño (tabla de propiedad en `CLAUDE.md`).

## Roles y permisos

Un usuario tiene un solo rol. Los permisos se verifican en el servidor (proxy y `withAuth` en cada controlador): ocultar un botón no es control de acceso.

| Permiso | `director` | `service_head` | `medic` | `admin` |
|---|:-:|:-:|:-:|:-:|
| Dashboard, alertas y resumen (`dashboard:view`, `summary:view`) | ✓ | ✓ | ✓ | ✓ |
| Agente IA (`agent:query`) | ✓ | ✓ | ✓ | ✓ |
| Fuentes de datos (`sources:view`) | ✓ | ✓ | ✓ | ✓ |
| Importar y revertir lotes (`import:*`) | | | | ✓ |
| Gestionar usuarios (`users:manage`) | | | | ✓ |
| Registro de actividad (`logs:view`) | | | | ✓ |

## API

Todas las rutas exigen sesión. Los errores tienen un formato único, con el mensaje en español:

```json
{ "error": { "code": "FORBIDDEN", "message": "No tienes permiso para realizar esta acción." } }
```

El catálogo de códigos y sus status HTTP está en `src/lib/api/errors.ts`. Nunca se devuelven trazas ni mensajes de Postgres.

| Método y ruta | Permiso | Para qué |
|---|---|---|
| `GET /api/me` | sesión | Usuario actual, rol y permisos. |
| `GET /api/kpis?service=` | `dashboard:view` | KPIs, alertas y tendencias (todo el hospital o un servicio). |
| `GET /api/insights/*` | `dashboard:view` | Series de ingresos, llegadas y causa del cambio en la espera de urgencias. |
| `POST /api/alerts/suggestion` | `dashboard:view` | Sugerencia de la IA para una alerta. |
| `POST /api/query` | `agent:query` | Pregunta al agente. |
| `GET /api/sources` | `sources:view` | Tablas, porcentaje simulado e historial de lotes. |
| `POST /api/import/batches` | `import:<target>` | Crear un lote de importación. |
| `POST /api/import/batches/{id}/rows` | `import:<target>` | Enviar un trozo de filas. |
| `POST /api/import/batches/{id}/apply` | `import:<target>` | Validar y aplicar el lote (todo o nada). |
| `POST /api/import/batches/{id}/revert` | `import:revert` | Revertir un lote aplicado. |
| `GET/POST /api/admin/users`, `PATCH /api/admin/users/{id}`, `POST .../reset-password` | `users:manage` | Administración de usuarios. |
| `GET /api/admin/logs` | `logs:view` | Registro de actividad. |

El detalle de cada endpoint está en [`docs/api-contract.md`](docs/api-contract.md), los tipos en `src/lib/types/api.ts` y los ejemplos en `mocks/*.json`. El frontend puede trabajar contra los mocks mientras el backend no esté listo.

## Importar hojas de cálculo

Solo el admin puede importar, desde la pestaña **Importar** de **Camas**, **Medicamentos** o **Cirugías**:

| Plantilla | Sección | Columnas |
|---|---|---|
| `drug_stock` | Medicamentos | `item_code`, `item_name`, `stock_date`, `current_stock`, `unit`, `expiration_date` |
| `bed_inventory` | Camas | `bed_code`, `bed_name`, `bed_group`, `bed_subgroup`, `is_active` |
| `surgery_schedules` | Cirugías | `schedule_number`, `patient_id`, `admission_id`, `service_code`, `scheduled_date`, `operating_room` |

El asistente tiene 6 pasos: descargar la plantilla, subir el archivo (CSV, hasta 4 MB y 10.000 filas), mapear columnas, vista previa, validación y aplicar. En el mapeo sugiere las columnas a partir de nombres en español o del HIS ("Código", "Fecha de corte", `IdPaciente`) y avisa si el archivo pertenece a otra sección.

Reglas:

- **Todo o nada (IMP-05):** con una sola fila inválida, el lote queda `rejected` y no se toca `core`.
- **No se sobrescriben datos (SEG-12):** una foto de inventario con fecha ya existente, una cama ya importada o una programación ya cargada rechazan el lote.
- **Formatos:** fechas `AAAA-MM-DD` o `DD/MM/AAAA`; números con punto o coma decimal y sin separador de miles; booleanos `Sí`/`No`.
- **Trazabilidad:** cada lote guarda archivo, origen, usuario y fecha, con el reporte de errores por fila. Un lote aplicado se puede revertir desde el historial.

## Verificación

| Comando | Qué comprueba |
|---|---|
| `npx tsx scripts/db-check.ts` | Conexión de los tres roles por el pooler. |
| `npx tsx --conditions=react-server scripts/kpis-check.ts` | KPIs contra `supabase/tests/expected_values.md`. |
| `npx tsx --conditions=react-server scripts/insights-check.ts` | Alertas, insights y reversión contra la base real. |
| `npx tsx scripts/query-check.ts` | Agente (plan B) contra el servidor local; requiere `npm run dev` y `QUERY_CHECK_EMAIL`/`QUERY_CHECK_PASSWORD`. |
| `npx tsx scripts/llm-check.ts` | Cadena Gemini → Groq → plan B. |
| `supabase/tests/load_check.sql` | Carga histórica completa (en el SQL Editor). |

## Despliegue en Vercel

1. Importa el repositorio en Vercel (framework Next.js). La región está fijada en `vercel.json` (`gru1`, São Paulo), cerca de la base de Supabase.
2. Configura las variables de entorno de la tabla del paso 2, **excepto** `HIS_LOAD_DATABASE_URL`, `HIS_*`, `BOOTSTRAP_*`, `SEED_*` y `AUTH_STUB*`, que solo se usan en tu máquina.
3. En Supabase → Authentication → URL Configuration, agrega la URL de Vercel.

## Reglas del proyecto

1. **El agente solo hace SELECT:** una sentencia, `LIMIT` máximo 200, `statement_timeout` de 5 s, rol `agent_ro`, solo vistas de `agent`.
2. **Sin datos personales (PII):** ni nombre, documento, motivo de consulta ni id real del paciente en vistas, respuestas, logs, caché ni prompts del LLM.
3. **Credenciales solo en `.env`/`.env.local`**, nunca en el repositorio. Se publica `.env.example` sin valores.
4. **La service role key y las llaves del LLM solo existen en el servidor.**
5. **Permisos verificados en el servidor** en cada controlador.
6. **Las importaciones nunca sobrescriben datos** y usan el rol `importer`.
7. **Los datos simulados o derivados quedan marcados** (`data_origin`, `is_simulated`) y la interfaz los señala.

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/levante_requerimientos_hslv.md`](docs/levante_requerimientos_hslv.md) | Problema, alcance, roles y requerimientos (IDs como `AUT-03`, `SEG-01`, `IMP-05`). |
| [`docs/modelo_datos_hslv.md`](docs/modelo_datos_hslv.md) | Esquemas `staging`, `core`, `agent` y `audit`, reglas y decisiones del modelo. |
| [`docs/Diccionario_Datos_HIS.md`](docs/Diccionario_Datos_HIS.md) | Diccionario de las tablas del HIS. |
| [`docs/api-contract.md`](docs/api-contract.md) | Contrato de la API (fuente de verdad junto con `src/lib/types/api.ts`). |
| [`CLAUDE.md`](CLAUDE.md) | Decisiones cerradas, propiedad de carpetas y convenciones del equipo. |
