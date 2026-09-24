# Contrato de API: Sistema de Gestión Hospitalaria Inteligente

Versión 0.1 · 23 de septiembre de 2026 · Alineado con el levante v0.5 y el modelo de datos v0.5.

Fuente de verdad en código: `src/lib/types/api.ts` (tipos), `src/lib/api/errors.ts` (errores) y `src/lib/auth/permissions.ts` (permisos). Ejemplos ejecutables en `mocks/*.json`, verificados por `mocks/check.ts`. Si este documento y el código difieren, se corrige el documento en el mismo PR.

## Cambios frente al levante v0.5

| Cambio | Detalle |
|---|---|
| **`POST /api/import` se divide en 3 pasos** (IMP-05, SEG-10, SEG-11) | El JSON de un archivo de 4 MB puede pasar de 4 MB al serializarlo, y Vercel limita el cuerpo de una función. Se crea el lote, se envían las filas en trozos menores de 4 MB y se aplica. Reemplaza al endpoint único. |
| Códigos de error adicionales | `NOT_FOUND` (404) y `BATCH_INVALID_STATE` (422). RNF-16 no lista el 404: se agrega. |
| Reporte de errores por fila | Se devuelve en el 200 de `.../rows` (`row_errors`), no dentro del error, para conservar el formato único. |
| `ACCOUNT_DISABLED` (403) | Se suma a los códigos de RNF-16 para AUT-05. |
| Permiso `import:his_tables` | Existe en la matriz (IMP-10, Could) pero no hay `target` para él en este contrato. |

## 1. Convenciones

- **Autenticación:** todo endpoint exige sesión válida y se protege con `withAuth(permission, handler)`. La columna "Permiso" usa el nombre exacto de `permissions.ts`; `null` significa "solo sesión". Sin sesión: 401. Sin permiso: 403. Cuenta desactivada: 403 `ACCOUNT_DISABLED`.
- **JSON en `snake_case`**, igual que las columnas de la base. Codificación UTF-8.
- **Fechas ISO 8601:**
  - Del HIS, sin zona (hora de Colombia): `2026-09-21T14:33:00`.
  - De auditoría, con zona: `2026-09-23T09:02:00-05:00`.
  - Solo fecha: `2026-09-21`. Solo mes: `2026-09`.
- **Éxito:** todos los endpoints responden `200` con el cuerpo indicado.
- **Fecha de referencia:** "hoy" es `reference_date` (2026-09-21), no la fecha del servidor.
- Los errores de Postgres, trazas y SQL interno nunca llegan al cliente; solo el mensaje en español del catálogo.

## 2. Formato de error único (RNF-16)

```json
{ "error": { "code": "FORBIDDEN", "message": "No tienes permiso para realizar esta acción." } }
```

Catálogo (única fuente: `API_ERROR_CATALOG` en `src/lib/api/errors.ts`):

| Código | HTTP | Cuándo | Mensaje por defecto |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | Sin sesión o sesión vencida. | Debes iniciar sesión para continuar. |
| `FORBIDDEN` | 403 | El rol no tiene el permiso. | No tienes permiso para realizar esta acción. |
| `ACCOUNT_DISABLED` | 403 | Cuenta con `is_active = false`. | Tu cuenta está desactivada. Contacta al administrador. |
| `VALIDATION_ERROR` | 400 | Cuerpo, parámetro o ruta inválidos. El mensaje dice qué campo. | Los datos enviados no son válidos. |
| `NOT_FOUND` | 404 | Usuario o lote inexistente. | No se encontró el recurso solicitado. |
| `PAYLOAD_TOO_LARGE` | 413 | Cuerpo de 4.000.000 bytes o más. | El contenido enviado supera el tamaño permitido. |
| `BATCH_REJECTED` | 422 | Al aplicar, el lote tiene filas inválidas. No se aplicó nada. | El lote tiene filas inválidas y no se aplicó ningún dato. |
| `BATCH_INVALID_STATE` | 422 | Operación no permitida en el estado actual del lote. | El lote no está en un estado que permita esta operación. |
| `DUPLICATE_STOCK_DATE` | 422 | Foto de inventario con `stock_date` ya existente (SEG-12). El mensaje indica la fecha. | Ya existe una foto de inventario con esa fecha para alguno de los medicamentos. |
| `SENSITIVE_DATA_REQUESTED` | 422 | Pregunta sobre una persona identificable (SEG-04). | No se pueden consultar datos que identifiquen a un paciente. |
| `OUT_OF_SCOPE` | 422 | Pregunta fuera del alcance de los datos (AGE-07). | La pregunta está fuera del alcance de los datos disponibles. |
| `LAST_ADMIN_REQUIRED` | 422 | La operación dejaría al sistema sin `admin` activo (AUT-07). | Debe quedar al menos un administrador activo. |
| `SELF_MODIFICATION_NOT_ALLOWED` | 422 | Un admin intenta desactivarse o quitarse el rol `admin` (AUT-07). | No puedes desactivarte ni quitarte el rol de administrador a ti mismo. |
| `AGENT_UNAVAILABLE` | 503 | Falló el LLM y no hay plan B para la pregunta. | El asistente no está disponible en este momento. Intenta de nuevo en unos minutos. |
| `INTERNAL_ERROR` | 500 | Cualquier excepción no controlada. El detalle va solo al log del servidor. | Ocurrió un error inesperado. Intenta de nuevo en unos minutos. |

Los controladores pueden lanzar `new ApiError(code, mensajeEspecifico)`; `toErrorResponse` lo convierte. Los mensajes específicos van en español y sin detalle interno.

Errores comunes a todos los endpoints: `UNAUTHENTICATED` (401), `ACCOUNT_DISABLED` (403), `FORBIDDEN` (403, salvo `/api/me`), `INTERNAL_ERROR` (500). No se repiten en cada ficha.

## 3. Matriz de permisos (AUT-03)

| Permiso | director | service_head | administrative | pharmacy | admin |
|---|:---:|:---:|:---:|:---:|:---:|
| `dashboard:view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `summary:view` (solo si se implementa D5) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `agent:query` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `sources:view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `import:bed_inventory` | — | — | ✓ | — | ✓ |
| `import:surgery_schedules` | — | — | ✓ | — | ✓ |
| `import:drug_stock` | — | — | — | ✓ | ✓ |
| `import:his_tables` (IMP-10, Could) | — | — | — | — | ✓ |
| `import:revert` | — | — | — | — | ✓ |
| `users:manage` | — | — | — | — | ✓ |
| `logs:view` | — | — | — | — | ✓ |

`importPermissionFor(target)`: `drug_stock` → `import:drug_stock`, `bed_inventory` → `import:bed_inventory`, `surgery_schedules` → `import:surgery_schedules`.

## 4. Endpoints

| Método y ruta | Permiso | Prioridad |
|---|---|---|
| `GET /api/me` | `null` (solo sesión) | Must |
| `POST /api/query` | `agent:query` | Must |
| `GET /api/kpis?service=` | `dashboard:view` | Must |
| `GET /api/sources` | `sources:view` | Must |
| `POST /api/import/batches` | según `target` (`importPermissionFor`) | Must |
| `POST /api/import/batches/{batchId}/rows` | según el `target` del lote | Must |
| `POST /api/import/batches/{batchId}/apply` | según el `target` del lote | Must |
| `POST /api/import/batches/{batchId}/revert` | `import:revert` | Should |
| `GET /api/admin/users` | `users:manage` | Must |
| `POST /api/admin/users` | `users:manage` | Must |
| `PATCH /api/admin/users/{userId}` | `users:manage` | Must |
| `POST /api/admin/users/{userId}/reset-password` | `users:manage` | Should |
| `GET /api/admin/logs` | `logs:view` | Could |

Login y logout no son endpoints propios: el navegador usa Supabase Auth directamente.

---

### 4.1 `GET /api/me`

Nombre, rol y permisos del usuario en sesión (barra superior, AUT-08, y menú según permisos, RNF-05). Sin request.

**200** (`MeResponse`, ejemplo en `mocks/me.json`):

```json
{
  "id": "6f1c2a7e-3b0d-4c55-9a11-0d2e5c7b8a01",
  "full_name": "Laura Mendoza (cuenta demo)",
  "role": "pharmacy",
  "permissions": ["dashboard:view", "summary:view", "agent:query", "sources:view", "import:drug_stock"]
}
```

**Errores:** 401 `UNAUTHENTICATED`, 403 `ACCOUNT_DISABLED`.

---

### 4.2 `POST /api/query`

Permiso: `agent:query`. Pregunta en español; responde con el resultado y el SQL ejecutado (mock: `mocks/query.json`).

**Request** (`QueryRequest`): `{ "question": "..." }`, de 1 a 500 caracteres.

**200** (`QueryResponse`):

```json
{
  "question": "¿Cuáles son los medicamentos con menos de 5 días de inventario?",
  "answer": "Hay 3 medicamentos con menos de 5 días de inventario; el más crítico es MEDICAMENTO SIMULADO A, con 1,8 días. Los datos de inventario son simulados.",
  "sql": "SELECT item_name, current_stock, avg_daily_consumption, days_of_inventory FROM agent.v_drug_inventory WHERE ... LIMIT 200",
  "columns": ["item_name", "current_stock", "avg_daily_consumption", "days_of_inventory"],
  "rows": [["MEDICAMENTO SIMULADO A", 54, 30, 1.8]],
  "row_count": 1,
  "truncated": false,
  "origin": "predefined",
  "llm_provider": null,
  "views_used": ["v_drug_inventory"],
  "includes_simulated_data": true,
  "reference_date": "2026-09-21",
  "duration_ms": 412
}
```

Reglas:
- `rows` es una matriz alineada con `columns`. Los números salen como número; las fechas como texto ISO.
- `truncated` es `true` si se aplicó el `LIMIT` de 200 (SEG-02).
- `origin`: `llm` o `predefined`. `llm_provider`: `gemini`, `groq` o `null` (plan B).
- **Si el LLM o su SQL fallan, no es un error:** se responde el plan B con `origin: "predefined"` (AGE-05, RNF-10). Solo si tampoco hay plan B: 503 `AGENT_UNAVAILABLE`.
- **`patient_key` nunca aparece** en `columns` ni en `rows`: el backend filtra la columna aunque el SQL la seleccione.
- Sin datos para la pregunta (AGE-07): 200 con `row_count: 0` y `answer` que lo explica.
- `includes_simulated_data` es `true` si alguna vista usada tiene datos simulados (por ejemplo `v_drug_inventory`).
- El LLM solo recibe esquema, pregunta y agregados; nunca filas de pacientes (RNF-03).

**Errores:**

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `question` vacía, ausente o de más de 500 caracteres. |
| 422 | `SENSITIVE_DATA_REQUESTED` | Se pide información de una persona identificable. |
| 422 | `OUT_OF_SCOPE` | La pregunta no se puede responder con las vistas autorizadas. |
| 503 | `AGENT_UNAVAILABLE` | Falló el LLM y no existe plan B para la pregunta. |

---

### 4.3 `GET /api/kpis?service=`

Permiso: `dashboard:view`. Una sola respuesta con todos los grupos y las alertas (mock: `mocks/kpis.json`). La misma respuesta sirve de snapshot para el modo offline (OFF-03); solo contiene agregados (OFF-06).

**Query:** `service` (opcional): nombre exacto de un servicio, por ejemplo `UNIDAD DE CUIDADO INTENSIVO`. Sin él, todo el hospital. Un servicio desconocido responde 400.

**200** (`KpisResponse`), resumen de la forma:

```json
{
  "occupancy":       { "scope": "service",  "day": "2026-09-21", "total": {}, "by_service": [], "by_subservice": [] },
  "emergency_wait":  { "scope": "hospital", "period_start": "2026-09-15", "period_end": "2026-09-21", "avg_wait_minutes": 62.1, "admissions_count": 796, "by_triage_level": [] },
  "critical_drugs":  { "scope": "hospital", "threshold_days": 5, "count": 3, "includes_simulated_data": true, "items": [] },
  "surgeries":       { "scope": "hospital", "universe_total": 1180, "performed_total": 826, "compliance_pct": 70.0, "by_month": [] },
  "demand":          { "scope": "service",  "period_start": "2026-09-01", "period_end": "2026-09-21", "admissions_by_service": [], "services_by_specialty": [] },
  "drug_rotation":   { "scope": "hospital", "period_start": "2026-08-23", "period_end": "2026-09-21", "top": [], "bottom": [] },
  "occupancy_trend": { "scope": "service",  "days": [] },
  "avg_stay":        { "scope": "service",  "by_service": [] },
  "alerts": [],
  "reference_date": "2026-09-21",
  "generated_at": "2026-09-23T08:15:00-05:00",
  "service_filter": null
}
```

Reglas:
- Cada tarjeta lleva `scope`: `service` (respeta el filtro) o `hospital` (siempre todo el hospital; la interfaz muestra "Todo el hospital", DAS-10).
- `occupancy`, `demand.admissions_by_service`, `occupancy_trend` y `avg_stay` respetan el filtro. `demand.services_by_specialty` no lo respeta aunque la tarjeta diga `service`.
- `occupancy_trend` (DAS-08) y `avg_stay` (DAS-09) son Should: pueden faltar en la respuesta.
- `critical_drugs.items`: solo `item_type = medicamento`, de menor a mayor `days_of_inventory`. `drug_rotation.top` y `.bottom`: 10 ítems cada uno, `bottom` solo con consumo mayor a 0.
- `surgeries` incluye el universo (`universe_total`) para mostrar "sobre N programaciones" (S-11).
- `alerts`: siempre de todo el hospital, sin importar el filtro, ordenadas por severidad (`critical` antes que `warning`). Tipos: `stockout`, `occupancy`, `emergency_wait`, `surgery_compliance`.
- `service_filter`: el filtro aplicado o `null`.

**Errores:** 400 `VALIDATION_ERROR` (servicio desconocido).

---

### 4.4 `GET /api/sources`

Permiso: `sources:view` (solo lectura, DAS-12). Sin request (mock: `mocks/sources.json`).

**200** (`SourcesResponse`):

```json
{
  "tables": [{ "table": "drug_stock", "rows": 240, "simulated_rows": 240 }],
  "batches": [
    {
      "batch_id": "0d7e5b61-91c2-4a3f-b7d8-4f2a6e8c1d22",
      "load_type": "ui_import",
      "target_table": "bed_inventory",
      "file_name": "camas_ejemplo.csv",
      "source_system": "Admisiones",
      "imported_by": { "user_id": "8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d", "full_name": "Carlos Ruiz (cuenta demo)" },
      "imported_at": "2026-09-22T21:05:00-05:00",
      "rows_read": 50,
      "rows_loaded": 0,
      "rows_rejected": 3,
      "status": "rejected",
      "is_simulated": false
    }
  ],
  "last_load_at": "2026-09-22T21:05:00-05:00",
  "simulated_pct": 1.3
}
```

`batches`: los 50 más recientes, del más nuevo al más antiguo. `imported_by` es `null` en cargas por script. `status`: `pending`, `validated`, `applied`, `rejected` o `reverted`. `simulated_pct` va de 0 a 100.

---

### 4.5 Importación en 3 pasos

Cada rol solo puede usar los `target` que le permite la matriz. El servidor **no confía en la validación del navegador**: valida cada fila otra vez (columnas obligatorias, tipos, fechas, valores permitidos y duplicados) y trata las celdas que empiezan por `=`, `+`, `-` o `@` como texto (SEG-11).

Límites (`IMPORT_LIMITS`): cada trozo debe pesar menos de 4.000.000 bytes (recomendado: 1.000 filas), máximo 10.000 filas por lote.

Flujo: crear lote → enviar filas (uno o más trozos) → aplicar. Un lote nace `pending`; pasa a `applied` si todo es válido o a `rejected` si no (todo o nada, IMP-05).

Plantillas (`IMPORT_COLUMNS`), nombres exactos de las claves de `values`:

| `target` | Columnas |
|---|---|
| `drug_stock` | `item_code`, `item_name`, `stock_date`, `current_stock`, `unit`, `expiration_date` |
| `bed_inventory` | `bed_code`, `bed_name`, `bed_group`, `bed_subgroup`, `is_active` |
| `surgery_schedules` | `schedule_number`, `patient_id`, `admission_id`, `service_code`, `scheduled_date`, `operating_room` |

Las columnas de las plantillas son una propuesta que Camilo ajusta al validar contra `core.*`; un cambio se refleja aquí y en `IMPORT_COLUMNS`.

#### 4.5.1 `POST /api/import/batches`: crear lote

Permiso: `importPermissionFor(target)` (mock: `mocks/import-batches-create.json`).

**Request** (`CreateBatchRequest`):

```json
{ "target": "drug_stock", "file_name": "inventario_farmacia_ejemplo.xlsx", "source_system": "Farmacia", "total_rows": 3 }
```

**200** (`CreateBatchResponse`):

```json
{ "batch_id": "5c8e1f3a-2b4d-4e6f-8a0b-1c3d5e7f9a11", "target": "drug_stock", "status": "pending", "max_chunk_bytes": 4000000, "max_rows_per_batch": 10000 }
```

**Errores:**

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `target` desconocido, `file_name` o `source_system` vacíos, extensión distinta de `.csv`/`.xlsx`, `total_rows` fuera de 1 a 10.000. |
| 403 | `FORBIDDEN` | El rol no puede importar ese `target`. |

#### 4.5.2 `POST /api/import/batches/{batchId}/rows`: enviar un trozo de filas

Permiso: `importPermissionFor(target del lote)` (mock: `mocks/import-batches-rows.json`). El lote debe estar `pending`.

**Request** (`SendRowsRequest`): filas con el número de fila del archivo y las celdas como texto.

```json
{ "rows": [ { "row_number": 2, "values": { "item_code": "SIM-0001", "item_name": "MEDICAMENTO SIMULADO A", "stock_date": "2026-09-22", "current_stock": "54", "unit": "TABLETA", "expiration_date": "2027-03-01" } } ] }
```

**200** (`SendRowsResponse`):

```json
{
  "batch_id": "5c8e1f3a-2b4d-4e6f-8a0b-1c3d5e7f9a11",
  "received_rows": 3,
  "total_received_rows": 3,
  "invalid_rows": 1,
  "row_errors": [ { "row_number": 3, "column_name": "current_stock", "message": "Debe ser un número mayor o igual a 0." } ],
  "errors_truncated": false
}
```

Las filas inválidas también se reciben (se registran en `audit.import_errors`); este paso no falla por ellas. `row_errors` trae los errores de este trozo, máximo 100; `errors_truncated` indica si hubo más. `column_name` es `null` si el error es de la fila completa. Una fila con `row_number` repetido dentro del lote es un `VALIDATION_ERROR`.

**Errores:**

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `batchId` mal formado, `rows` vacío, `row_number` repetido, o claves de `values` ajenas a la plantilla. |
| 403 | `FORBIDDEN` | El rol no puede importar el `target` del lote. |
| 404 | `NOT_FOUND` | El lote no existe. |
| 413 | `PAYLOAD_TOO_LARGE` | El cuerpo pesa 4.000.000 bytes o más. |
| 422 | `BATCH_INVALID_STATE` | El lote ya no está `pending`, o con este trozo se superaría `total_rows`. |

#### 4.5.3 `POST /api/import/batches/{batchId}/apply`: aplicar

Permiso: `importPermissionFor(target del lote)` (mock: `mocks/import-batches-apply.json`). Sin cuerpo. Llama a `core.apply_batch` y refresca las vistas materializadas (IMP-07).

**200** (`ApplyBatchResponse`):

```json
{ "batch_id": "5c8e1f3a-2b4d-4e6f-8a0b-1c3d5e7f9a11", "status": "applied", "rows_loaded": 3, "applied_at": "2026-09-23T09:02:00-05:00" }
```

**Errores:**

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Las filas recibidas no coinciden con `total_rows`. |
| 403 | `FORBIDDEN` | El rol no puede importar el `target` del lote. |
| 404 | `NOT_FOUND` | El lote no existe. |
| 422 | `BATCH_REJECTED` | Al menos una fila inválida. El lote queda `rejected` y no se toca `core`. El mensaje incluye el conteo (por ejemplo "3 filas inválidas"); el detalle ya se entregó en el paso de filas. |
| 422 | `DUPLICATE_STOCK_DATE` | Solo `drug_stock`: la `stock_date` ya existe para algún medicamento. El mensaje indica la fecha repetida. El lote queda `rejected`. |
| 422 | `BATCH_INVALID_STATE` | El lote no está `pending` (ya aplicado, rechazado o revertido). |

#### 4.5.4 `POST /api/import/batches/{batchId}/revert` (Should)

Permiso: `import:revert` (IMP-08; mock: `mocks/import-batches-revert.json`). Sin cuerpo. Solo lotes `applied`. Borra las filas del lote; en `drug_stock`, vuelve a regir la foto anterior.

**200** (`RevertBatchResponse`): `{ "batch_id": "...", "status": "reverted", "rows_reverted": 3 }`

**Errores:** 404 `NOT_FOUND` (lote inexistente); 422 `BATCH_INVALID_STATE` (el lote no está `applied`).

---

### 4.6 Administración de usuarios

Todos con `users:manage`. Las operaciones se registran en `audit.user_admin_log` (AUT-11). Contraseñas de mínimo 10 caracteres (RNF-15); el servidor nunca las devuelve.

`UserSummary`: `user_id`, `email`, `full_name`, `role`, `is_active`, `must_change_password`, `created_at` (con zona) y `created_by` (`null` para el admin inicial).

#### 4.6.1 `GET /api/admin/users`

Sin request. **200** (`ListUsersResponse`): `{ "users": [UserSummary, ...] }`, ordenados por `created_at` ascendente (mock: `mocks/admin-users-list.json`).

#### 4.6.2 `POST /api/admin/users`

**Request** (`CreateUserRequest`):

```json
{ "full_name": "Marta Gómez (cuenta demo)", "email": "director.demo@example.org", "role": "director", "temporary_password": "ClaveTemporal-2026" }
```

**200** (`UserResponse`): `{ "user": UserSummary }` con `is_active: true` y `must_change_password: true` (mock: `mocks/admin-users-create.json`).

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Campo faltante, correo inválido, rol desconocido, contraseña de menos de 10 caracteres, o el correo ya tiene cuenta ("Ya existe una cuenta con ese correo."). |

#### 4.6.3 `PATCH /api/admin/users/{userId}`

**Request** (`UpdateUserRequest`): al menos uno de `role` o `is_active`. **200** (`UserResponse`) (mock: `mocks/admin-users-update.json`).

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo vacío, `userId` mal formado o valores inválidos. |
| 404 | `NOT_FOUND` | La cuenta no existe. |
| 422 | `SELF_MODIFICATION_NOT_ALLOWED` | El admin en sesión se desactiva o se quita el rol `admin` a sí mismo. Tiene prioridad sobre `LAST_ADMIN_REQUIRED`. |
| 422 | `LAST_ADMIN_REQUIRED` | El cambio dejaría cero `admin` activos (protección ante cambios simultáneos). |

#### 4.6.4 `POST /api/admin/users/{userId}/reset-password` (Should)

**Request** (`ResetPasswordRequest`): `{ "temporary_password": "..." }`, mínimo 10 caracteres. **200** (`UserResponse`) con `must_change_password: true` (mock: `mocks/admin-users-reset-password.json`).

Errores: 400 `VALIDATION_ERROR` (contraseña corta), 404 `NOT_FOUND`.

---

### 4.7 `GET /api/admin/logs` (Could)

Permiso: `logs:view` (AUT-15; mock: `mocks/admin-logs.json`).

**Query:** `type` (obligatorio): `queries` (`audit.query_log`) o `admin` (`audit.user_admin_log`). Opcionales: `user_id`, `from` y `to` (fechas `AAAA-MM-DD`, inclusivas), `limit` (1 a 200, por defecto 50). Orden: del más reciente al más antiguo.

**200** (`LogsResponse`), unión discriminada por `type`:
- `{ "type": "queries", "entries": QueryLogEntry[] }`: usuario, fecha, pregunta, SQL, origen, proveedor, estado, `row_count` y `duration_ms`. No incluye `error_message` (puede contener detalle interno) ni filas devueltas (SEG-06).
- `{ "type": "admin", "entries": AdminLogEntry[] }`: actor, cuenta afectada, acción (`create`, `role_change`, `deactivate`, `reactivate`, `password_reset`), valor anterior y nuevo, fecha.

**Errores:** 400 `VALIDATION_ERROR` (falta `type`, valor desconocido, fechas mal formadas, `limit` fuera de rango).

---

## 5. Fuera de este contrato

- Login, logout y cambio de contraseña propio (AUT-10): los hace el navegador con Supabase Auth; no hay endpoint propio.
- Importación incremental de tablas del HIS (IMP-10, Could): el permiso `import:his_tables` existe, pero no hay `target` definido.
- Límite de solicitudes en `/api/query` (SEG-07, Could): si se implementa, necesitará un código 429 nuevo en el catálogo.
