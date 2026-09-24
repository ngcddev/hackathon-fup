// GENERADO por scripts/export-agent-schema.ts. No editar a mano: vuelve a correr el script.
// Fuente: vistas del esquema agent y COMMENT ON (rol agent_ro).

export interface SchemaColumn {
  name: string;
  type: string;
  comment: string | null;
  values?: string[];
}

export interface SchemaView {
  name: string;
  comment: string | null;
  columns: SchemaColumn[];
}

export const AGENT_SCHEMA_VIEWS: SchemaView[] = [
  {
    name: "v_admissions",
    comment: "Un registro por ingreso. Pacientes ingresados (S-05): admission_class = 'Hospitalario'; contar con COUNT(DISTINCT patient_key). hospitalized_at es la asignación de cama y NO indica hospitalización. age_group se calcula a agent.reference_date().",
    columns: [
      {"name":"admission_id","type":"bigint","comment":null},
      {"name":"patient_key","type":"text","comment":null},
      {"name":"admission_class","type":"text","comment":null,"values":["Ambulatorio","Hospitalario"]},
      {"name":"admission_route","type":"text","comment":null,"values":["Cirugia Ambulatorias","Hospitalizacion","Remitido","Urgencias"]},
      {"name":"admitted_at","type":"timestamp without time zone","comment":null},
      {"name":"hospitalized_at","type":"timestamp without time zone","comment":null},
      {"name":"estimated_discharge_at","type":"timestamp without time zone","comment":null},
      {"name":"service","type":"text","comment":null},
      {"name":"subservice","type":"text","comment":null},
      {"name":"triage_level","type":"smallint","comment":null},
      {"name":"age_group","type":"text","comment":null,"values":["0-4","18-29","30-44","45-59","5-17","60-74","75+"]},
      {"name":"sex","type":"text","comment":null,"values":["Femenino","Masculino"]},
      {"name":"regime","type":"text","comment":null,"values":["Contributivo","Otro","Particular","Subsidiado","Vinculado"]},
      {"name":"zone","type":"text","comment":null,"values":["Rural","Urbana"]},
    ],
  },
  {
    name: "v_bed_occupancy",
    comment: "Camas ocupadas por día y servicio. UCI: service = 'UNIDAD DE CUIDADO INTENSIVO'. is_capacity_simulated = true si la capacidad es derivada del histórico o simulada.",
    columns: [
      {"name":"day","type":"date","comment":null},
      {"name":"service","type":"text","comment":null},
      {"name":"subservice","type":"text","comment":null},
      {"name":"occupied_beds","type":"integer","comment":null},
      {"name":"capacity","type":"integer","comment":null},
      {"name":"occupancy_pct","type":"numeric","comment":null},
      {"name":"is_capacity_simulated","type":"boolean","comment":null},
    ],
  },
  {
    name: "v_emergency_wait_times",
    comment: "Ingresos por urgencias con espera en minutos (0 a 1440), desde el triage o, si no hay, desde el ingreso. Filtrar periodos por admitted_at. shift: dia (7:00-18:59) o noche; weekday: 1 lunes a 7 domingo; hour de la llegada.",
    columns: [
      {"name":"admission_id","type":"bigint","comment":null},
      {"name":"admitted_at","type":"timestamp without time zone","comment":null},
      {"name":"triaged_at","type":"timestamp without time zone","comment":null},
      {"name":"attended_at","type":"timestamp without time zone","comment":null},
      {"name":"wait_minutes","type":"numeric","comment":null},
      {"name":"triage_level","type":"smallint","comment":null},
      {"name":"triage_classification","type":"text","comment":null},
      {"name":"shift","type":"text","comment":null,"values":["dia","noche"]},
      {"name":"weekday","type":"integer","comment":null},
      {"name":"hour","type":"integer","comment":null},
    ],
  },
  {
    name: "v_drug_inventory",
    comment: "Foto más reciente de inventario por ítem. Para medicamentos: item_type = 'medicamento'. avg_daily_consumption = consumo de los 30 días hasta agent.reference_date() / 30. days_of_inventory NULL = sin consumo.",
    columns: [
      {"name":"item_code","type":"text","comment":null},
      {"name":"item_name","type":"text","comment":null},
      {"name":"item_type","type":"text","comment":null,"values":["medicamento"]},
      {"name":"current_stock","type":"numeric","comment":null},
      {"name":"avg_daily_consumption","type":"numeric","comment":null},
      {"name":"days_of_inventory","type":"numeric","comment":null},
      {"name":"stock_date","type":"date","comment":null},
      {"name":"is_simulated","type":"boolean","comment":null},
    ],
  },
  {
    name: "v_drug_consumption_daily",
    comment: null,
    columns: [
      {"name":"day","type":"date","comment":null},
      {"name":"item_code","type":"text","comment":null},
      {"name":"item_name","type":"text","comment":null},
      {"name":"item_type","type":"text","comment":null},
      {"name":"area_name","type":"text","comment":null},
      {"name":"specialty","type":"text","comment":null},
      {"name":"total_quantity","type":"integer","comment":null},
    ],
  },
  {
    name: "v_service_demand_daily",
    comment: null,
    columns: [
      {"name":"day","type":"date","comment":null},
      {"name":"area_name","type":"text","comment":null},
      {"name":"specialty","type":"text","comment":null},
      {"name":"service_code","type":"text","comment":null},
      {"name":"service_name","type":"text","comment":null},
      {"name":"lines_count","type":"integer","comment":null},
      {"name":"total_quantity","type":"integer","comment":null},
    ],
  },
  {
    name: "v_surgeries",
    comment: "Una fila por programación quirúrgica con ingreso en el extracto. scheduled_month: fecha programada o mes del ingreso. is_performed: al menos un servicio de la programación aparece prestado en ese ingreso.",
    columns: [
      {"name":"schedule_number","type":"text","comment":null},
      {"name":"scheduled_month","type":"date","comment":null},
      {"name":"is_performed","type":"boolean","comment":null},
      {"name":"data_origin","type":"text","comment":null,"values":["historical"]},
    ],
  },
  {
    name: "v_diagnosis_monthly",
    comment: "Diagnósticos agregados por mes y servicio. Solo grupos de 5 o más ingresos.",
    columns: [
      {"name":"month","type":"date","comment":null},
      {"name":"service","type":"text","comment":null},
      {"name":"diagnosis_code","type":"text","comment":null},
      {"name":"diagnosis_name","type":"text","comment":null},
      {"name":"admissions_count","type":"integer","comment":null},
    ],
  },
];

export const AGENT_SERVICES: string[] = ["GINECO OBSTETRICIA","HOSPITALIZACION","PEDIATRIA","RECUPERACION","SALA PARTOS","UNIDAD DE CUIDADO BASICO","UNIDAD DE CUIDADO INTENSIVO","UNIDAD DE CUIDADO INTERMEDIO","URGENCIAS"];
