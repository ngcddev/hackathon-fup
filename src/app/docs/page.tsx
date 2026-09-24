import type { Metadata } from 'next';
import { C, List, P, Section, Sub, Table, Toc } from './_parts';

export const metadata: Metadata = {
  title: 'Documentación | Sistema de Gestión Hospitalaria Inteligente',
};

const FUNCTIONS = [
  { id: 'f-autenticacion', label: 'Autenticación y sesión' },
  { id: 'f-permisos', label: 'Roles y permisos' },
  { id: 'f-dashboard', label: 'Dashboard de KPIs' },
  { id: 'f-alertas', label: 'Alertas y recomendaciones' },
  { id: 'f-insights', label: 'Análisis de urgencias (D6 y D7)' },
  { id: 'f-agente', label: 'Agente conversacional' },
  { id: 'f-importador', label: 'Importador de datos' },
  { id: 'f-fuentes', label: 'Panel de fuentes' },
  { id: 'f-usuarios', label: 'Administración de usuarios y logs' },
  { id: 'f-carga', label: 'Carga histórica del HIS' },
];

const MODULES = [
  { id: 'm-estructura', label: 'Estructura del proyecto y propiedad' },
  { id: 'm-auth', label: 'src/lib/auth y src/proxy.ts' },
  { id: 'm-api', label: 'src/lib/api (errores)' },
  { id: 'm-db', label: 'src/lib/db' },
  { id: 'm-queries', label: 'src/lib/queries' },
  { id: 'm-alerts', label: 'src/lib/alerts' },
  { id: 'm-agent', label: 'src/lib/agent' },
  { id: 'm-import', label: 'src/lib/import' },
  { id: 'm-types', label: 'src/lib/types y mocks' },
  { id: 'm-supabase', label: 'src/lib/supabase' },
];

const REFERENCE = [
  { id: 'r-api', label: 'Endpoints de la API' },
  { id: 'r-errores', label: 'Catálogo de errores' },
  { id: 'r-bd', label: 'Base de datos (esquemas, roles, vistas)' },
  { id: 'r-scripts', label: 'Scripts' },
  { id: 'r-env', label: 'Variables de entorno' },
  { id: 'r-comandos', label: 'Comandos' },
  { id: 'r-estado', label: 'Estado de implementación' },
  { id: 'r-reglas', label: 'Reglas no negociables y convenciones' },
  { id: 'r-docs', label: 'Documentos de referencia' },
];

export default function DocsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8 leading-relaxed">
      <h1 className="text-2xl font-bold">Documentación del sistema</h1>
      <P>
        Sistema de Gestión Hospitalaria Inteligente, Hospital Susana López de Valencia (Popayán). MVP de hackathon
        (Campus Party FUP 2026). Esta página resume lo que existe en el repositorio, organizado por funcionalidad, por
        módulo de código y como referencia técnica. La fuente de verdad de cada tema se indica en su sección.
      </P>
      <P>
        Fecha de referencia del sistema («hoy»): <C>2026-09-21</C>, guardada en <C>core.app_settings</C> y expuesta con{' '}
        <C>agent.reference_date()</C>. Nunca se usa <C>CURRENT_DATE</C>.
      </P>

      <nav aria-label="Índice" className="mt-8 grid gap-6 border p-4 sm:grid-cols-3">
        <Toc title="Por funcionalidad" items={FUNCTIONS} />
        <Toc title="Por módulo de código" items={MODULES} />
        <Toc title="Referencia" items={REFERENCE} />
      </nav>

      <Section id="vision" title="Visión general">
        <List
          items={[
            <>
              <strong>Stack:</strong> Next.js 16 (App Router), React 19, Supabase (Postgres y Auth), Tailwind 4,
              despliegue en Vercel. Monolito MVC: vistas en <C>src/app</C>, controladores en{' '}
              <C>src/app/api/*/route.ts</C>, lógica en <C>src/lib</C>. Alias <C>@/*</C> apunta a <C>src/*</C>.
            </>,
            <>
              <strong>Agente:</strong> Gemini (principal), Groq (respaldo) y plan B con preguntas predefinidas. Costo 0
              USD.
            </>,
            <>
              <strong>Acceso a datos:</strong> supabase-js para Auth; todo lo de <C>core</C> y <C>audit</C> va por la
              conexión <C>pg</C> con el rol que corresponda (<C>agent_ro</C>, <C>importer</C>, <C>app_backend</C>).
            </>,
            <>
              <strong>Trazabilidad:</strong> los datos simulados o derivados quedan marcados (<C>data_origin</C>,{' '}
              <C>is_simulated</C>).
            </>,
          ]}
        />
        <Sub title="Flujo de una petición a la API">
          <List
            items={[
              <>
                <C>src/proxy.ts</C> exige sesión (páginas redirigen a <C>/login</C>; <C>/api/*</C> responde 401) y
                renueva los tokens en las cookies.
              </>,
              <>
                El controlador se exporta envuelto en <C>withAuth(permiso, handler)</C>, que valida el JWT, lee el perfil
                en <C>core.user_profiles</C> y verifica el permiso contra la matriz.
              </>,
              <>
                El controlador delega en <C>src/lib/queries</C>, <C>src/lib/agent</C> o <C>src/lib/import</C>, que usan
                el pool de Postgres del rol adecuado.
              </>,
              <>
                Cualquier <C>ApiError</C> se convierte con <C>toErrorResponse</C> al formato único; una excepción
                desconocida responde 500 genérico y el detalle solo va al log.
              </>,
            ]}
          />
        </Sub>
      </Section>

      {/* ------------------------------------------------------------------ FUNCIONALIDADES */}

      <h2 className="mt-14 text-2xl font-bold">Funcionalidades</h2>

      <Section id="f-autenticacion" title="Autenticación y sesión">
        <P>Requerimientos: AUT-01, AUT-05, AUT-06, AUT-07, SEG-13, SEG-15. Código: src/lib/auth, src/proxy.ts y scripts/bootstrap-admin.ts.</P>
        <List
          items={[
            <>Inicio de sesión con correo y contraseña por Supabase Auth, directamente desde el navegador. No hay endpoints propios de login ni logout.</>,
            <>
              En cada request se valida el JWT (<C>getClaims</C>) y se lee el perfil en <C>core.user_profiles</C>. Una
              cuenta con <C>is_active = false</C> pierde el acceso en su siguiente solicitud (<C>ACCOUNT_DISABLED</C>).
            </>,
            <>El rol nunca se lee del token: solo de la base.</>,
            <>El autorregistro está deshabilitado; las cuentas se crean desde administración o con el script de arranque.</>,
            <>
              <C>scripts/bootstrap-admin.ts</C> crea o recrea el primer <C>admin</C> desde <C>.env</C> (idempotente).
            </>,
            <>
              <C>GET /api/me</C> devuelve nombre, rol y permisos del usuario en sesión, para la barra superior y el menú.
            </>,
            <>
              Desarrollo sin Supabase: <C>AUTH_STUB=true</C> y <C>AUTH_STUB_ROLE=&lt;rol&gt;</C> inyectan un usuario falso.
              Nunca en producción.
            </>,
          ]}
        />
      </Section>

      <Section id="f-permisos" title="Roles y permisos">
        <P>
          Cuatro roles, uno por usuario: <C>director</C>, <C>service_head</C>, <C>medic</C>, <C>admin</C>. La matriz
          vive solo en <C>src/lib/auth/permissions.ts</C>, no en la base. Se aplica en el servidor.
        </P>
        <Table
          headers={['Permiso', 'director', 'service_head', 'medic', 'admin']}
          rows={[
            ['dashboard:view', 'sí', 'sí', 'sí', 'sí'],
            ['summary:view (solo si se implementa D5)', 'sí', 'sí', 'sí', 'sí'],
            ['agent:query', 'sí', 'sí', 'sí', 'sí'],
            ['sources:view', 'sí', 'sí', 'sí', 'sí'],
            ['import:bed_inventory', '—', '—', '—', 'sí'],
            ['import:surgery_schedules', '—', '—', '—', 'sí'],
            ['import:drug_stock', '—', '—', '—', 'sí'],
            ['import:his_tables (Could)', '—', '—', '—', 'sí'],
            ['import:revert', '—', '—', '—', 'sí'],
            ['users:manage', '—', '—', '—', 'sí'],
            ['logs:view (Could)', '—', '—', '—', 'sí'],
          ]}
        />
        <P>
          <C>importPermissionFor(target)</C> traduce el destino de importación a su permiso. Ocultar un botón no es
          control de acceso: cada controlador verifica el permiso.
        </P>
      </Section>

      <Section id="f-dashboard" title="Dashboard de KPIs">
        <P>
          Requerimientos: DAS-01 a DAS-10. Endpoint: <C>GET /api/kpis?service=</C> (permiso <C>dashboard:view</C>). Una
          sola respuesta con todas las tarjetas y las alertas. Todo se calcula sobre la fecha de referencia.
        </P>
        <Table
          headers={['Tarjeta (clave)', 'Contenido', 'Alcance']}
          rows={[
            ['occupancy', 'Ocupación de camas: total, por servicio y por subservicio en la fecha de referencia.', 'Respeta el filtro de servicio'],
            ['emergency_wait', 'Espera promedio en urgencias de la última semana, con desglose por nivel de triage.', 'Todo el hospital'],
            ['critical_drugs', 'Medicamentos con menos de 5 días de inventario (conteo y detalle). Incluye pronóstico de agotamiento (D2).', 'Todo el hospital'],
            ['surgeries', 'Programaciones con ingreso en el extracto frente a realizadas, por mes; universo total y % de cumplimiento.', 'Todo el hospital'],
            ['demand', 'Ingresos por servicio y servicios prestados por especialidad.', 'Ingresos respetan el filtro; especialidades no'],
            ['drug_rotation', 'Top 10 y bottom 10 de medicamentos e insumos por cantidad dispensada (el bottom solo con consumo mayor a 0).', 'Todo el hospital'],
            ['occupancy_trend', 'Evolución diaria de la ocupación en los últimos 30 días (DAS-08, Should).', 'Respeta el filtro'],
            ['avg_stay', 'Estancia promedio por servicio en días (DAS-09, Should).', 'Respeta el filtro'],
            ['alerts', 'Alertas ordenadas por severidad. Ver «Alertas y recomendaciones».', 'Siempre todo el hospital'],
          ]}
        />
        <List
          items={[
            <>
              Cada tarjeta lleva <C>scope</C>: <C>service</C> (respeta el filtro) o <C>hospital</C> (la interfaz debe
              mostrar «Todo el hospital»).
            </>,
            <>
              Un <C>service</C> desconocido responde 400 <C>VALIDATION_ERROR</C>.
            </>,
            <>
              La respuesta incluye <C>reference_date</C>, <C>generated_at</C> y <C>service_filter</C>. Solo contiene
              agregados: sirve de snapshot para el modo sin conexión.
            </>,
            <>
              Código: <C>src/lib/queries/kpis/*</C>; <C>getKpis</C> en <C>index.ts</C> ejecuta todas las consultas en
              paralelo.
            </>,
          ]}
        />
      </Section>

      <Section id="f-alertas" title="Alertas y recomendaciones">
        <P>
          Requerimientos: ALE-01 a ALE-06. Se generan en <C>src/lib/alerts</C> y salen en <C>alerts</C> de{' '}
          <C>GET /api/kpis</C>. Los umbrales viven en <C>src/lib/alerts/thresholds.ts</C>.
        </P>
        <Table
          headers={['Tipo', 'Regla', 'Recomendación']}
          rows={[
            [
              'occupancy',
              'Por subservicio: advertencia desde 85 %, crítica desde 95 %.',
              'Nombra el subservicio del mismo servicio con menor ocupación (bajo 85 %); si no hay, sugiere abrir camas o reasignar personal. En UCI nunca sugiere trasladar entre subservicios.',
            ],
            [
              'stockout',
              'Una alerta crítica por medicamento con menos de 5 días; los de 5 a 10 días en una sola advertencia agrupada.',
              'Cantidad a pedir para cubrir 15 días de consumo. Incluye fecha estimada de quiebre. Marcada como inventario simulado.',
            ],
            [
              'emergency_wait',
              'Espera promedio de la última semana por nivel de triage sobre su umbral: triage 1 = 10 min, 2 = 30 min (Resolución 5596 de 2015), 3 = 120 min y 4 = 240 min (supuestos por validar).',
              'Refuerzo de atención en el turno (día o noche) con mayor espera. Crítica en triage 1 y 2; advertencia en 3 y 4.',
            ],
            [
              'surgery_compliance',
              'Tipo definido en el contrato (cumplimiento quirúrgico bajo 80 %, ALE-05).',
              'Aún no hay generador implementado.',
            ],
          ]}
        />
        <P>
          Orden (ALE-03): críticas antes que advertencias; dentro de cada severidad, por tipo (ocupación, inventario,
          espera, cirugía) y luego por gravedad.
        </P>
      </Section>

      <Section id="f-insights" title="Análisis de urgencias (D6 y D7)">
        <Sub title="D6: mapa de calor de llegadas — GET /api/insights/arrivals">
          <List
            items={[
              <>
                Llegadas a urgencias (<C>admission_route = &apos;Urgencias&apos;</C>) promediadas por día de la semana y
                franjas de 2 horas, del primer día con llegadas a la fecha de referencia.
              </>,
              <>Devuelve las celdas del mapa y las 3 franjas con más llegadas. Permiso <C>dashboard:view</C>.</>,
              <>
                Código: <C>src/lib/queries/insights/arrivals.ts</C>.
              </>,
            ]}
          />
        </Sub>
        <Sub title="D7: causa raíz de la espera — GET /api/insights/wait-root-cause">
          <List
            items={[
              <>
                Compara la última semana con las 4 anteriores, segmentando por turno, día de la semana y nivel de
                triage. Reporta los 3 segmentos que más aportan al cambio global.
              </>,
              <>Ignora segmentos con menos de 10 ingresos. Un cambio de hasta 5 % se considera sin cambio. La frase se arma con plantilla, sin LLM.</>,
              <>
                Código: <C>src/lib/queries/insights/wait-root-cause.ts</C>. Permiso <C>dashboard:view</C>.
              </>,
            ]}
          />
        </Sub>
      </Section>

      <Section id="f-agente" title="Agente conversacional">
        <P>
          Requerimientos: AGE-01 a AGE-07, SEG-01 a SEG-06, RNF-03, RNF-10. Endpoint: <C>POST /api/query</C> (permiso{' '}
          <C>agent:query</C>). Pregunta en español de 1 a 500 caracteres.
        </P>
        <Sub title="Flujo (src/lib/agent/run.ts)">
          <List
            items={[
              <>
                <strong>Privacidad:</strong> <C>isSensitiveQuestion</C> rechaza preguntas sobre una persona identificable
                (422 <C>SENSITIVE_DATA_REQUESTED</C>).
              </>,
              <>
                <strong>LLM:</strong> Gemini, un reintento solo ante 429 o 5xx, luego Groq. Presupuesto total de 8 s
                (Gemini hasta 3,5 s y Groq hasta 3 s por llamada). Solo recibe esquema, reglas y la pregunta; nunca
                filas.
              </>,
              <>
                El LLM decide <C>sql</C>, <C>out_of_scope</C> o <C>sensitive</C>.
              </>,
              <>
                <strong>Validador</strong> (<C>validator.ts</C>): parser real de Postgres, lista blanca de nodos, vistas y
                funciones; una sola sentencia SELECT; <C>LIMIT</C> forzado a 200; revisión por expresiones regulares.
                Falla cerrado.
              </>,
              <>
                <strong>Ejecución</strong> con el rol <C>agent_ro</C>: transacción <C>READ ONLY</C>,{' '}
                <C>statement_timeout</C> de 5 s y un reintento si la caché está fría.
              </>,
              <>
                <strong>Plan B:</strong> si el LLM, el validador o la ejecución fallan, se busca la pregunta entre 14
                predefinidas (emparejamiento determinista por palabras clave). Si tampoco hay plan B: 503{' '}
                <C>AGENT_UNAVAILABLE</C>.
              </>,
              <>
                Se elimina <C>patient_key</C> de la respuesta y se registra la consulta en <C>audit.query_log</C> (sin las
                filas devueltas y con la pregunta sin números de documento).
              </>,
            ]}
          />
        </Sub>
        <Sub title="Respuesta (QueryResponse)">
          <P>
            <C>question</C>, <C>answer</C>, <C>sql</C>, <C>columns</C>, <C>rows</C>, <C>row_count</C>, <C>truncated</C>,{' '}
            <C>origin</C> (<C>llm</C> o <C>predefined</C>), <C>llm_provider</C> (<C>gemini</C>, <C>groq</C> o nulo),{' '}
            <C>views_used</C>, <C>includes_simulated_data</C>, <C>reference_date</C> y <C>duration_ms</C>.
          </P>
        </Sub>
        <Sub title="Vistas que puede consultar (esquema agent)">
          <List
            items={[
              <C key="1">v_admissions</C>,
              <C key="2">v_bed_occupancy</C>,
              <C key="3">v_emergency_wait_times</C>,
              <C key="4">v_drug_inventory (simulada)</C>,
              <C key="5">v_drug_consumption_daily</C>,
              <C key="6">v_service_demand_daily</C>,
              <C key="7">v_surgeries</C>,
              <C key="8">v_diagnosis_monthly</C>,
            ]}
          />
        </Sub>
        <Sub title="Preguntas predefinidas (plan B)">
          <List
            items={[
              'Camas de UCI ocupadas hoy (uci_beds_today).',
              'Medicamentos con menos de 5 días de inventario (drugs_below_5_days).',
              'Tiempo de espera promedio en urgencias de la última semana (emergency_wait_week).',
              'Servicio con más pacientes ingresados este mes (top_service_admissions_month).',
              'Ocupación por servicio hoy, espera por triage en el mes, ingresos por día en la semana, top de especialidades, medicamentos más dispensados, medicamentos de 5 a 10 días, cumplimiento quirúrgico por mes, ingresos por grupo de edad, diagnósticos más frecuentes y llegadas a urgencias por hora.',
            ]}
          />
        </Sub>
      </Section>

      <Section id="f-importador" title="Importador de datos">
        <P>
          Requerimientos: IMP-01 a IMP-11, SEG-09 a SEG-12. La importación es en 3 pasos y «todo o nada» (un lote con
          una fila inválida no aplica ninguna). Nunca sobrescribe datos existentes y usa el rol <C>importer</C>.
        </P>
        <Table
          headers={['Paso', 'Endpoint', 'Qué hace']}
          rows={[
            ['1', 'POST /api/import/batches', 'Crea el lote (estado pending). Devuelve batch_id y los límites.'],
            ['2', 'POST /api/import/batches/{batchId}/rows', 'Envía filas en trozos de menos de 4.000.000 bytes. Valida cada fila y reporta errores por fila y columna.'],
            ['3', 'POST /api/import/batches/{batchId}/apply', 'Aplica con core.apply_batch y refresca las vistas materializadas. Pasa a applied o rejected.'],
            ['—', 'POST /api/import/batches/{batchId}/revert', 'Revierte un lote aplicado (solo admin). Borra sus filas; en drug_stock vuelve a regir la foto anterior.'],
          ]}
        />
        <Sub title="Destinos y plantillas">
          <Table
            headers={['target', 'Columnas', 'Permiso']}
            rows={[
              ['drug_stock', 'item_code, item_name, stock_date, current_stock, unit, expiration_date', 'import:drug_stock'],
              ['bed_inventory', 'bed_code, bed_name, bed_group, bed_subgroup, is_active', 'import:bed_inventory'],
              ['surgery_schedules', 'schedule_number, patient_id, admission_id, service_code, scheduled_date, operating_room', 'import:surgery_schedules'],
            ]}
          />
        </Sub>
        <Sub title="Reglas y límites">
          <List
            items={[
              <>Archivos <C>.csv</C> o <C>.xlsx</C>; máximo 10.000 filas por lote (1.000 recomendadas por trozo).</>,
              <>El servidor valida otra vez todo: columnas obligatorias, tipos, fechas, valores permitidos y duplicados. Celdas que empiezan por <C>=</C>, <C>+</C>, <C>-</C> o <C>@</C> se tratan como texto.</>,
              <>
                <C>DUPLICATE_STOCK_DATE</C>: un lote de inventario con una <C>stock_date</C> ya existente se rechaza completo (SEG-12).
              </>,
              <>Cada fila queda con su origen: archivo, sistema, usuario, fecha y lote (IMP-06).</>,
              <>Estados del lote: <C>pending</C>, <C>validated</C>, <C>applied</C>, <C>rejected</C>, <C>reverted</C>.</>,
            ]}
          />
        </Sub>
      </Section>

      <Section id="f-fuentes" title="Panel de fuentes">
        <P>
          Requerimiento DAS-12. Endpoint: <C>GET /api/sources</C> (permiso <C>sources:view</C>, solo lectura, todos los
          roles). Devuelve:
        </P>
        <List
          items={[
            <>
              <C>tables</C>: filas por tabla y cuántas son simuladas.
            </>,
            <>
              <C>batches</C>: los 50 lotes más recientes (archivo, sistema de origen, quién importó, cuándo, filas leídas,
              cargadas y rechazadas, estado, si es simulado).
            </>,
            <>
              <C>last_load_at</C> y <C>simulated_pct</C> (0 a 100).
            </>,
          ]}
        />
      </Section>

      <Section id="f-usuarios" title="Administración de usuarios y logs">
        <P>Requerimientos: AUT-04, AUT-07, AUT-09, AUT-11, AUT-15. Todos los endpoints exigen <C>users:manage</C> (los logs, <C>logs:view</C>).</P>
        <Table
          headers={['Endpoint', 'Función']}
          rows={[
            ['GET /api/admin/users', 'Lista usuarios ordenados por fecha de creación.'],
            ['POST /api/admin/users', 'Crea usuario con nombre, correo, rol y contraseña temporal (mínimo 10 caracteres). Nace activo y con cambio de contraseña obligatorio.'],
            ['PATCH /api/admin/users/{userId}', 'Cambia rol y/o is_active.'],
            ['POST /api/admin/users/{userId}/reset-password', 'Asigna una nueva contraseña temporal.'],
            ['GET /api/admin/logs?type=', 'type=queries (audit.query_log) o type=admin (audit.user_admin_log); filtros user_id, from, to y limit (1 a 200, por defecto 50).'],
          ]}
        />
        <List
          items={[
            <>
              Un admin no puede desactivarse ni quitarse el rol a sí mismo (<C>SELF_MODIFICATION_NOT_ALLOWED</C>) y
              siempre debe quedar al menos un admin activo (<C>LAST_ADMIN_REQUIRED</C>).
            </>,
            <>Cada acción queda en <C>audit.user_admin_log</C>: crear, cambio de rol, desactivar, reactivar y restablecer contraseña.</>,
            <>El log de consultas no incluye mensajes de error internos ni las filas devueltas.</>,
          ]}
        />
      </Section>

      <Section id="f-carga" title="Carga histórica del HIS">
        <P>Requerimientos: CAR-01 a CAR-08. Script: <C>scripts/load/load_his.py</C> (solo en la máquina de quien carga; nunca en Vercel).</P>
        <List
          items={[
            <>Lee los 7 archivos txt del HIS (Atención, Ingresos, MedicamentoInsumo, Paciente, ProgramacionCirugia, Servicios, Triage). Por defecto UTF-8 con BOM y separador <C>|</C>, configurables.</>,
            <>Los sube a <C>staging</C> con COPY, los transforma con <C>core.apply_batch</C> y deriva las camas (<C>core.derive_bed_inventory</C>).</>,
            <>Genera la foto simulada de <C>drug_stock</C> con semilla fija (todo marcado como simulado).</>,
            <>Cierra con <C>core.finish_historical_load</C>: escribe la fecha de referencia, refresca vistas materializadas y vacía el staging del HIS.</>,
            <>Modos: <C>--dry-run</C> (solo lee y valida) y <C>--only &lt;tabla&gt;</C> (recarga una sola tabla).</>,
            <>
              <C>scripts/profile_his.py</C> genera un perfil agregado de los txt, sin datos de pacientes (resultado en{' '}
              <C>docs/perfil_his.md</C>).
            </>,
          ]}
        />
      </Section>

      {/* ------------------------------------------------------------------ MÓDULOS */}

      <h2 className="mt-14 text-2xl font-bold">Módulos de código</h2>

      <Section id="m-estructura" title="Estructura del proyecto y propiedad">
        <Table
          headers={['Ruta', 'Contenido', 'Dueño']}
          rows={[
            ['supabase/, scripts/load, src/lib/db, src/lib/queries, src/lib/alerts, src/app/api/kpis, src/app/api/import, src/app/api/sources', 'Base de datos, carga, consultas, alertas, KPIs, importación y fuentes', 'Camilo'],
            ['src/lib/auth, src/lib/agent, src/lib/api, src/lib/types, src/proxy.ts, src/app/api/query, admin y me, scripts/seed, scripts/bootstrap-admin, docs, mocks', 'Autenticación, agente, contrato de API, tipos, administración', 'Nicolás'],
            ['src/app (salvo src/app/api) y src/components', 'Páginas y componentes', 'Andrés'],
          ]}
        />
        <P>Un cambio en una carpeta ajena se pide al dueño. Ramas <C>feature/*</C> y PRs pequeños hacia <C>main</C>.</P>
      </Section>

      <Section id="m-auth" title="src/lib/auth y src/proxy.ts">
        <List
          items={[
            <>
              <C>permissions.ts</C>: <C>ROLES</C>, <C>PERMISSIONS</C>, <C>PERMISSION_MATRIX</C>, <C>can</C>,{' '}
              <C>permissionsFor</C>, <C>importPermissionFor</C>, <C>isRole</C>.
            </>,
            <>
              <C>with-auth.ts</C>: <C>withAuth(permiso, handler)</C>. El handler recibe <C>request</C> y{' '}
              <C>{'{ user, params }'}</C>, con <C>params</C> ya resuelto (en Next 16 es una <C>Promise</C>).{' '}
              <C>withAuth(null, ...)</C> exige solo sesión. También expone la obtención del usuario en sesión para
              páginas del servidor.
            </>,
            <>
              <C>src/proxy.ts</C> (antes «middleware»): primera barrera de sesión y renovación de tokens. No consulta la
              base; el rol y <C>is_active</C> se verifican en <C>withAuth</C>.
            </>,
          ]}
        />
      </Section>

      <Section id="m-api" title="src/lib/api (errores)">
        <P>
          <C>errors.ts</C>: <C>API_ERROR_CATALOG</C> (único lugar de códigos y status), <C>ApiError</C> y{' '}
          <C>toErrorResponse</C>. Ver «Catálogo de errores».
        </P>
      </Section>

      <Section id="m-db" title="src/lib/db">
        <List
          items={[
            <>
              <C>pools.ts</C>: un pool <C>pg</C> por rol (<C>app_backend</C>, <C>agent_ro</C>, <C>importer</C>) por el
              pooler de Supabase en modo transaction (puerto 6543). Las fechas y los timestamp sin zona salen como texto
              para no desplazar horas; <C>bigint</C> y <C>numeric</C> salen como número.
            </>,
            <>
              <C>index.ts</C>: <C>queryAsAppBackend</C> (consultas parametrizadas) y <C>runAgentQuery</C> (SQL del agente
              en transacción de solo lectura con timeout de 5 s).
            </>,
            <>
              <C>errors.ts</C>: convierte errores de Postgres en un error interno genérico (el detalle no llega al
              cliente).
            </>,
          ]}
        />
      </Section>

      <Section id="m-queries" title="src/lib/queries">
        <List
          items={[
            <>
              <C>kpis/</C>: una consulta por tarjeta (<C>occupancy</C>, <C>emergency-wait</C>, <C>critical-drugs</C>,{' '}
              <C>surgeries</C>, <C>demand</C>, <C>drug-rotation</C>, <C>occupancy-trend</C>, <C>avg-stay</C>) y{' '}
              <C>index.ts</C> con <C>getKpis</C>.
            </>,
            <>
              <C>insights/</C>: <C>arrivals.ts</C> (D6), <C>wait-root-cause.ts</C> (D7) y <C>labels.ts</C> (turnos y días).
            </>,
            <>Consultan el esquema <C>agent</C> con el rol <C>app_backend</C>.</>,
          ]}
        />
      </Section>

      <Section id="m-alerts" title="src/lib/alerts">
        <List
          items={[
            <>
              <C>index.ts</C>: <C>buildAlerts</C> junta y ordena.
            </>,
            <>
              <C>occupancy.ts</C>, <C>stockout.ts</C>, <C>emergency-wait.ts</C>: un generador por tipo de alerta.
            </>,
            <>
              <C>thresholds.ts</C>: todos los umbrales en un solo archivo (ALE-06). <C>format.ts</C>: formato de números.
            </>,
          ]}
        />
      </Section>

      <Section id="m-agent" title="src/lib/agent">
        <Table
          headers={['Archivo', 'Función']}
          rows={[
            ['run.ts', 'Orquesta el flujo completo de POST /api/query (handleQuery).'],
            ['llm.ts', 'Cliente Gemini → Groq con presupuesto de tiempo y reintentos.'],
            ['prompt.ts', 'Arma el prompt de sistema y el mensaje de usuario (esquema, servicios con sinónimos, ejemplos).'],
            ['schema.generated.ts', 'Esquema de las vistas que ve el LLM. Se regenera con scripts/export-agent-schema.ts cuando cambian las vistas.'],
            ['validator.ts', 'Validador de SQL (solo SELECT, lista blanca, LIMIT 200).'],
            ['privacy.ts', 'Filtro de preguntas sensibles, redacción de la pregunta para el log y eliminación de patient_key.'],
            ['plan-b.ts', 'Preguntas predefinidas con SQL fijo y emparejamiento determinista.'],
            ['answer-template.ts, text.ts', 'Plantillas de respuesta y normalización de texto.'],
            ['query-log.ts', 'Registro de cada consulta en audit.query_log.'],
            ['*.test.ts', 'Pruebas con vitest (llm, plan-b, privacy, validator).'],
          ]}
        />
      </Section>

      <Section id="m-import" title="src/lib/import">
        <P>
          <C>revert.ts</C>: <C>revertBatch</C> llama a <C>core.revert_batch</C> y traduce los códigos SQLSTATE al
          catálogo (<C>P0002</C> a <C>NOT_FOUND</C>, <C>55000</C> a <C>BATCH_INVALID_STATE</C>, <C>42501</C> a{' '}
          <C>FORBIDDEN</C>). El resto del importador (crear lote, filas, aplicar) aún no está en el código.
        </P>
      </Section>

      <Section id="m-types" title="src/lib/types y mocks">
        <List
          items={[
            <>
              <C>src/lib/types/api.ts</C>: tipos de request y response de toda la API, más <C>AGENT_VIEWS</C>,{' '}
              <C>IMPORT_COLUMNS</C> e <C>IMPORT_LIMITS</C>. Sin <C>any</C>.
            </>,
            <>
              <C>mocks/*.json</C>: ejemplos <C>{'{ request, response }'}</C> por endpoint, verificados por{' '}
              <C>mocks/check.ts</C>. El frontend puede trabajar contra ellos mientras el backend no esté listo.
            </>,
            <>Si cambia el contrato, se actualizan <C>docs/api-contract.md</C>, los tipos y los mocks en el mismo PR.</>,
          ]}
        />
      </Section>

      <Section id="m-supabase" title="src/lib/supabase">
        <P>
          <C>server.ts</C> y <C>client.ts</C>: clientes de Supabase Auth (servidor con cookies y navegador). Solo usan la
          URL y la clave pública (<C>NEXT_PUBLIC_*</C>).
        </P>
      </Section>

      {/* ------------------------------------------------------------------ REFERENCIA */}

      <h2 className="mt-14 text-2xl font-bold">Referencia</h2>

      <Section id="r-api" title="Endpoints de la API">
        <P>
          Formato JSON en <C>snake_case</C>. Fechas del HIS sin zona (hora de Colombia); fechas de auditoría con zona.
          Éxito siempre con 200. Detalle completo en <C>docs/api-contract.md</C>.
        </P>
        <Table
          headers={['Método y ruta', 'Permiso', 'Estado']}
          rows={[
            ['GET /api/me', 'solo sesión', 'Implementado'],
            ['POST /api/query', 'agent:query', 'Implementado'],
            ['GET /api/kpis?service=', 'dashboard:view', 'Implementado'],
            ['GET /api/insights/arrivals', 'dashboard:view', 'Implementado'],
            ['GET /api/insights/wait-root-cause', 'dashboard:view', 'Implementado'],
            ['POST /api/import/batches/{batchId}/revert', 'import:revert', 'Implementado'],
            ['GET /api/sources', 'sources:view', 'Implementado'],
            ['POST /api/import/batches', 'según target', 'Pendiente'],
            ['POST /api/import/batches/{batchId}/rows', 'según target del lote', 'Pendiente'],
            ['POST /api/import/batches/{batchId}/apply', 'según target del lote', 'Pendiente'],
            ['GET /api/admin/users', 'users:manage', 'Implementado'],
            ['POST /api/admin/users', 'users:manage', 'Implementado'],
            ['PATCH /api/admin/users/{userId}', 'users:manage', 'Implementado'],
            ['POST /api/admin/users/{userId}/reset-password', 'users:manage', 'Implementado'],
            ['GET /api/admin/logs', 'logs:view', 'Implementado'],
          ]}
        />
      </Section>

      <Section id="r-errores" title="Catálogo de errores">
        <P>
          Formato único: <C>{'{ "error": { "code": "...", "message": "..." } }'}</C> con el mensaje en español. Única
          fuente: <C>API_ERROR_CATALOG</C> en <C>src/lib/api/errors.ts</C>. Nunca se devuelven trazas ni mensajes de
          Postgres.
        </P>
        <Table
          headers={['Código', 'HTTP', 'Cuándo']}
          rows={[
            ['UNAUTHENTICATED', '401', 'Sin sesión o sesión vencida.'],
            ['FORBIDDEN', '403', 'El rol no tiene el permiso.'],
            ['ACCOUNT_DISABLED', '403', 'Cuenta con is_active = false.'],
            ['VALIDATION_ERROR', '400', 'Cuerpo, parámetro o ruta inválidos.'],
            ['NOT_FOUND', '404', 'Usuario o lote inexistente.'],
            ['PAYLOAD_TOO_LARGE', '413', 'Cuerpo de 4.000.000 bytes o más.'],
            ['BATCH_REJECTED', '422', 'Al aplicar, el lote tiene filas inválidas; no se aplicó nada.'],
            ['BATCH_INVALID_STATE', '422', 'Operación no permitida en el estado actual del lote.'],
            ['DUPLICATE_STOCK_DATE', '422', 'Foto de inventario con fecha ya existente (SEG-12).'],
            ['SENSITIVE_DATA_REQUESTED', '422', 'Pregunta sobre una persona identificable.'],
            ['OUT_OF_SCOPE', '422', 'Pregunta fuera del alcance de los datos.'],
            ['LAST_ADMIN_REQUIRED', '422', 'La operación dejaría al sistema sin admin activo.'],
            ['SELF_MODIFICATION_NOT_ALLOWED', '422', 'Un admin intenta desactivarse o quitarse el rol.'],
            ['AGENT_UNAVAILABLE', '503', 'Falló el LLM y no hay plan B para la pregunta.'],
            ['INTERNAL_ERROR', '500', 'Excepción no controlada; el detalle va solo al log.'],
          ]}
        />
      </Section>

      <Section id="r-bd" title="Base de datos (esquemas, roles, vistas)">
        <P>
          Migraciones en <C>supabase/migrations</C>. Modelo completo en <C>docs/modelo_datos_hslv.md</C>.
        </P>
        <Table
          headers={['Esquema', 'Propósito', 'Quién accede']}
          rows={[
            ['auth', 'Cuentas y contraseñas (Supabase Auth).', 'Supabase Auth; el backend usa la service role key solo en el servidor.'],
            ['staging', 'Copia fiel de los archivos de origen, todo como texto, antes de validar.', 'importer (solo inserción) y el script de carga.'],
            ['core', 'Datos limpios y tipados, tablas complementarias, app_settings, vistas materializadas y perfiles de usuario.', 'app_backend y core.apply_batch.'],
            ['agent', 'Vistas anonimizadas y agent.reference_date(). Único esquema que ve la IA.', 'agent_ro y consultas fijas del dashboard.'],
            ['audit', 'Lotes de carga, errores, log de consultas y log de administración.', 'app_backend; importer solo en lotes y errores.'],
          ]}
        />
        <Sub title="Roles de Postgres">
          <Table
            headers={['Rol', 'Permisos', 'Lo usa']}
            rows={[
              ['agent_ro', 'Solo SELECT sobre agent y EXECUTE sobre agent.reference_date(); transacciones de solo lectura; statement_timeout de 5 s.', 'POST /api/query'],
              ['importer', 'INSERT en staging, audit.import_batches y audit.import_errors; EXECUTE sobre core.apply_batch.', 'Importación'],
              ['app_backend', 'SELECT sobre core y agent; escritura en core.user_profiles, audit.query_log y audit.user_admin_log.', 'Sesión, administración, logs y consultas fijas'],
            ]}
          />
        </Sub>
        <Sub title="Tablas principales">
          <List
            items={[
              <>
                <C>core</C>: <C>patients</C>, <C>admissions</C>, <C>triages</C>, <C>first_attentions</C>,{' '}
                <C>service_lines</C>, <C>drug_dispensations</C>, <C>surgery_schedules</C>, <C>bed_inventory</C>,{' '}
                <C>drug_stock</C>, <C>app_settings</C>, <C>user_profiles</C>.
              </>,
              <>
                Vistas materializadas: <C>mv_admission_stay</C> (egreso estimado), <C>mv_bed_occupancy_daily</C>,{' '}
                <C>mv_item_catalog</C>.
              </>,
              <>
                <C>audit</C>: <C>import_batches</C>, <C>import_errors</C>, <C>query_log</C>, <C>user_admin_log</C>.
              </>,
              <>
                <C>staging</C>: una tabla por archivo del HIS (<C>stg_*</C>) y por plantilla de importación.
              </>,
              <>
                Funciones: <C>core.apply_batch</C>, <C>core.revert_batch</C>, <C>core.refresh_materialized_views</C>,{' '}
                <C>core.finish_historical_load</C>, <C>core.derive_bed_inventory</C>.
              </>,
            ]}
          />
        </Sub>
        <Sub title="Vistas anonimizadas (agent)">
          <P>
            No exponen nombre, documento, motivo de consulta, fecha de nacimiento, id real del paciente ni diagnóstico
            individual. <C>patient_key</C> es un hash con sal y nunca sale en una respuesta de la API.
          </P>
          <Table
            headers={['Vista', 'Contenido']}
            rows={[
              ['v_admissions', 'Ingresos: clase, vía, fechas, servicio, subservicio, triage, grupo de edad, sexo, régimen y zona.'],
              ['v_bed_occupancy', 'Camas ocupadas y capacidad por día, servicio y subservicio.'],
              ['v_emergency_wait_times', 'Espera en urgencias por ingreso, con triage, turno, día y hora.'],
              ['v_drug_inventory', 'Foto más reciente de inventario, consumo diario promedio y días de inventario (simulado).'],
              ['v_drug_consumption_daily', 'Consumo por día, ítem, área y especialidad.'],
              ['v_service_demand_daily', 'Servicios prestados por día, área, especialidad y servicio.'],
              ['v_surgeries', 'Programaciones con ingreso en el extracto y si fueron realizadas.'],
              ['v_diagnosis_monthly', 'Diagnósticos agregados por mes y servicio (mínimo 5 ingresos).'],
            ]}
          />
        </Sub>
      </Section>

      <Section id="r-scripts" title="Scripts">
        <Table
          headers={['Script', 'Para qué sirve']}
          rows={[
            ['scripts/apply-migration.ts', 'Aplica un archivo de supabase/migrations dentro de una transacción con la conexión de la carga histórica.'],
            ['scripts/bootstrap-admin.ts', 'Crea o recrea el primer admin desde .env.'],
            ['scripts/db-check.ts', 'Verifica la conexión de los tres roles por el pooler.'],
            ['scripts/export-agent-schema.ts', 'Regenera src/lib/agent/schema.generated.ts a partir de las vistas de agent.'],
            ['scripts/kpis-check.ts', 'Verifica las tarjetas de GET /api/kpis contra supabase/tests/expected_values.md.'],
            ['scripts/insights-check.ts', 'Verifica alertas de espera, pronóstico de agotamiento, tendencia, estancia, reversión, D6 y D7 contra la base real.'],
            ['scripts/query-check.ts', 'Verifica POST /api/query (plan B) contra un servidor local.'],
            ['scripts/llm-check.ts', 'Verifica la cadena Gemini → Groq → plan B contra un servidor local.'],
            ['scripts/load/load_his.py', 'Carga histórica del HIS.'],
            ['scripts/profile_his.py', 'Perfil agregado de los txt del HIS.'],
          ]}
        />
        <P>
          Los scripts TypeScript se ejecutan con <C>npx tsx</C>; los que importan <C>src/lib</C> necesitan{' '}
          <C>--conditions=react-server</C> para que <C>server-only</C> no falle fuera de Next.js. Pruebas de datos en{' '}
          <C>supabase/tests</C> (<C>load_check.sql</C>, <C>demo_reference.sql</C>, <C>expected_values.md</C>).
        </P>
      </Section>

      <Section id="r-env" title="Variables de entorno">
        <P>Credenciales solo en <C>.env</C> (en <C>.gitignore</C>). Se publica <C>.env.example</C> sin valores.</P>
        <Table
          headers={['Variable', 'Uso', 'Dónde']}
          rows={[
            ['NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'Cliente de Supabase Auth.', 'Público'],
            ['AUTH_STUB, AUTH_STUB_ROLE', 'Usuario falso solo en desarrollo.', 'Servidor'],
            ['SUPABASE_SERVICE_ROLE_KEY', 'Administración de cuentas en Auth.', 'Solo servidor'],
            ['BOOTSTRAP_ADMIN_EMAIL, _PASSWORD, _NAME', 'Datos del primer admin.', 'Solo script'],
            ['DATABASE_URL_APP_BACKEND, DATABASE_URL_AGENT_RO, DATABASE_URL_IMPORTER', 'Conexiones pg por rol (pooler, puerto 6543).', 'Solo servidor'],
            ['AGENT_LLM_ENABLED', 'true habilita Gemini y Groq; sin él va directo al plan B.', 'Solo servidor'],
            ['GEMINI_API_KEY, GROQ_API_KEY, GEMINI_MODEL, GROQ_MODEL', 'Llaves y modelos del LLM.', 'Solo servidor'],
            ['HIS_LOAD_DATABASE_URL, HIS_DATA_DIR, REFERENCE_DATE, HIS_ENCODING, HIS_SEPARATOR', 'Carga histórica del HIS.', 'Solo en tu máquina'],
          ]}
        />
      </Section>

      <Section id="r-comandos" title="Comandos">
        <Table
          headers={['Comando', 'Función']}
          rows={[
            [<C key="a">npm run dev</C>, 'Servidor local.'],
            [<C key="b">npm run build</C>, 'Compilación de producción.'],
            [<C key="c">npx tsc --noEmit</C>, 'Verificación de tipos (incluye mocks/check.ts).'],
            [<C key="d">npm run lint</C>, 'ESLint.'],
            [<C key="e">npm test</C>, 'Pruebas con vitest.'],
          ]}
        />
        <P>
          Definición de terminado: tipos sin errores, lint sin advertencias nuevas, sin secretos en el código ni en el
          bundle, cada endpoint con <C>withAuth</C> y errores en el formato único.
        </P>
      </Section>

      <Section id="r-estado" title="Estado de implementación">
        <P>Corresponde al código presente en la rama principal al momento de escribir esta página.</P>
        <Table
          headers={['Área', 'Estado', 'Notas']}
          rows={[
            ['Esquema de base de datos y migraciones', 'Hecho', 'Cuatro esquemas, tres roles, vistas y funciones de importación.'],
            ['Carga histórica del HIS', 'Hecho', 'load_his.py con validación de conteos.'],
            ['Autenticación, permisos y GET /api/me', 'Hecho', 'withAuth, proxy y bootstrap-admin.'],
            ['GET /api/kpis (8 tarjetas y alertas)', 'Hecho', 'Incluye tendencia (DAS-08) y estancia (DAS-09).'],
            ['Alertas de ocupación, inventario y espera', 'Hecho', 'ALE-01 a ALE-04 y ALE-06.'],
            ['Alerta de cumplimiento quirúrgico (ALE-05)', 'Pendiente', 'El tipo existe en el contrato; no hay generador.'],
            ['D6 y D7 (análisis de urgencias)', 'Hecho', 'Endpoints de insights.'],
            ['Agente: LLM, validador, privacidad, plan B, log', 'Hecho', 'POST /api/query.'],
            ['Reversión de lotes (IMP-08)', 'Hecho', 'Endpoint y core.revert_batch.'],
            ['Importador: crear lote, enviar filas, aplicar', 'Pendiente', 'La lógica SQL existe (core.apply_batch); faltan los controladores.'],
            ['GET /api/sources (panel de fuentes)', 'Hecho', 'Conteos por tabla, últimos 50 lotes y porcentaje simulado.'],
            ['Administración de usuarios y logs', 'Hecho', 'Usuarios (crear, editar, reiniciar contraseña) y logs, con auditoría en audit.user_admin_log.'],
            ['Páginas de la interfaz (login, dashboard, chat, importador, administración)', 'Pendiente', 'Hoy solo existe la página de inicio de plantilla y esta documentación.'],
            ['Modo sin conexión (PWA, OFF-01 a OFF-09)', 'Pendiente', 'Should.'],
            ['Resumen del día (D5), límite de solicitudes (SEG-07), filtro por rango de fechas (DAS-13)', 'Pendiente', 'Opcionales.'],
          ]}
        />
      </Section>

      <Section id="r-reglas" title="Reglas no negociables y convenciones">
        <Sub title="Reglas no negociables">
          <List
            items={[
              'Solo SELECT para el agente: una sola sentencia, LIMIT máximo 200, statement_timeout de 5 s, rol agent_ro y solo vistas del esquema agent.',
              'Sin datos personales: nada de nombre, documento, motivo de consulta ni id real del paciente en vistas, respuestas, logs, caché del dispositivo ni prompts del LLM. patient_key nunca aparece en una respuesta.',
              'Credenciales solo en .env; la service role key y la API key del LLM solo existen en el servidor, en variables sin prefijo NEXT_PUBLIC_.',
              'Permisos verificados en el servidor (proxy y cada controlador con withAuth).',
              'Las importaciones nunca sobrescriben datos existentes y usan el rol importer.',
              'Nunca se devuelven trazas ni mensajes de Postgres al cliente.',
            ]}
          />
        </Sub>
        <Sub title="Convenciones">
          <List
            items={[
              'Código, variables, tablas y columnas en inglés; documentación, comentarios y mensajes al usuario en español.',
              'JSON en snake_case. Fechas ISO 8601: las del HIS sin zona (hora de Colombia), las de auditoría con zona.',
              'Interfaz en español, en blanco y negro, legible en proyector.',
              'Ramas feature/*, PRs pequeños hacia main; cada PR toca solo carpetas de su dueño.',
              'No se hace commit de .env, datos reales (data/) ni claves.',
            ]}
          />
        </Sub>
      </Section>

      <Section id="r-docs" title="Documentos de referencia">
        <Table
          headers={['Archivo', 'Contenido']}
          rows={[
            ['docs/levante_requerimientos_hslv.md', 'Requerimientos funcionales y no funcionales (IDs como AUT-03, SEG-01, RNF-16), KPIs, criterios de aceptación y riesgos.'],
            ['docs/modelo_datos_hslv.md', 'Modelo de datos: esquemas, roles, tablas, vistas y relaciones.'],
            ['docs/api-contract.md', 'Contrato de la API. Fuente de verdad junto con src/lib/types/api.ts.'],
            ['docs/Diccionario_Datos_HIS.md', 'Diccionario de los archivos de origen del HIS.'],
            ['docs/perfil_his.md', 'Perfil agregado de los datos del HIS (sin datos de pacientes).'],
            ['supabase/tests/expected_values.md', 'Valores esperados de la carga y de la demo.'],
          ]}
        />
      </Section>
    </main>
  );
}
