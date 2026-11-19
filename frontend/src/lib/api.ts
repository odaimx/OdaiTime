// Cliente HTTP de la API con renovación automática del token de acceso.

export type Rol = "superadmin" | "admin_empresa" | "gerente_sucursal" | "empleado";

export const ROLES: Record<Rol, string> = {
  superadmin: "Superadmin",
  admin_empresa: "Administrador",
  gerente_sucursal: "Gerente de sucursal",
  empleado: "Empleado",
};

export interface SucursalRef {
  id: string;
  clave: string;
  nombre: string;
}

export interface Usuario {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  empresa: { id: string; nombre: string; logo_version: string | null; fondo_color?: string | null; fondo_version?: string | null; demo?: boolean; licencia_vence?: string | null } | null;
  sucursales: SucursalRef[];
  ultimo_acceso: string | null;
  foto_actualizada?: string | null;
}

export interface Sucursal extends SucursalRef {
  empresa_id: string;
  zona_horaria: string;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  radio_metros: number;
  activa: boolean;
}

export interface Empresa {
  id: string;
  nombre: string;
  razon_social: string | null;
  rfc: string | null;
  activa: boolean;
  max_empleados: number;
  licencia_vence: string | null;
  demo?: boolean;
  max_usuarios?: number;
  direccion?: string | null;
  estado?: "corriendo" | "suspendida" | "eliminada";
  motivo_suspension?: string | null;
  periodicidad?: string | null;
  referencia_odoo?: string | null;
  slug: string;
  url: string | null;
  created_at: string;
  logo_version: string | null;
  fondo_color?: string | null;
  fondo_version?: string | null;
}

/** URL pública de la imagen de fondo de una empresa. */
export const urlFondo = (empresaId: string, version: string) => `/api/tenant/fondo/${empresaId}?v=${encodeURIComponent(version)}`;

/** Estilo del fondo principal de una empresa (color o imagen). */
export function estiloFondo(e: { id: string; fondo_color?: string | null; fondo_version?: string | null } | null | undefined): Record<string, string> {
  if (!e) return {};
  if (e.fondo_version) return { backgroundImage: `url(${urlFondo(e.id, e.fondo_version)})`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" };
  if (e.fondo_color) return { backgroundColor: e.fondo_color };
  return {};
}

/** URL pública del logo de una empresa (la versión invalida la caché al cambiarlo). */
export const urlLogo = (empresaId: string, version: string) => `/api/tenant/logo/${empresaId}?v=${encodeURIComponent(version)}`;

export interface TenantInfo {
  modo: "base" | "tenant" | "libre";
  nombre?: string | null;
  slug?: string | null;
  dominio?: string | null;
  empresa_id?: string | null;
  logo_version?: string | null;
  fondo_color?: string | null;
  fondo_version?: string | null;
  /** Empresa suspendida o con licencia vencida: motivo que se muestra en el login. */
  aviso?: string | null;
}

export interface Licencia {
  max_empleados: number;
  activos: number;
  disponibles: number;
  vence: string | null;
  vencida: boolean;
  url_compra: string;
}

/** Detalle que manda la API cuando se rebasa o venció la licencia. */
export interface LimiteLicencia {
  codigo: "limite_licencia" | "licencia_vencida";
  mensaje: string;
  max_empleados: number;
  activos: number;
  disponibles: number;
  url_compra: string;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  usuario: Usuario;
}

const KEY = "odaitime.session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detalle?: unknown,
  ) {
    super(message);
  }

  get licencia(): LimiteLicencia | null {
    const d = this.detalle as LimiteLicencia | undefined;
    return d?.codigo === "limite_licencia" || d?.codigo === "licencia_vencida" ? d : null;
  }
}

export const errorLicencia = (err: unknown) => (err instanceof ApiError ? err.licencia : null);

export const session = {
  get(): Tokens | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  },
  set(t: Tokens) {
    localStorage.setItem(KEY, JSON.stringify(t));
  },
  clear() {
    localStorage.removeItem(KEY);
  },
};

let onSessionExpired: () => void = () => {};
export function setOnSessionExpired(fn: () => void) {
  onSessionExpired = fn;
}

/** Empresa suspendida, eliminada o con licencia vencida: se sale y el login explica el motivo. */
const BLOQUEOS = ["empresa_suspendida", "empresa_eliminada", "licencia_vencida"];
export const AVISO_BLOQUEO = "odaitime.bloqueo";

function revisarBloqueo(status: number, body: unknown): boolean {
  const d = (body as { detail?: { codigo?: string; mensaje?: string } } | null)?.detail;
  if (status !== 403 || !d || typeof d !== "object" || !BLOQUEOS.includes(d.codigo ?? "")) return false;
  try {
    sessionStorage.setItem(AVISO_BLOQUEO, d.mensaje ?? "El acceso de tu empresa está suspendido.");
  } catch {
    /* sin almacenamiento */
  }
  if (session.get()) {
    session.clear();
    onSessionExpired();
  }
  return true;
}

// Una sola renovación en vuelo aunque varias peticiones fallen a la vez.
let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  const current = session.get();
  if (!current) return false;
  const r = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  });
  if (!r.ok) {
    revisarBloqueo(r.status, await r.json().catch(() => null));
    return false;
  }
  session.set(await r.json());
  return true;
}

function errorMessage(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown })?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "mensaje" in detail) return String(detail.mensaje);
  if (Array.isArray(detail) && detail[0]?.msg) {
    const d = detail[0] as { type: string; msg: string; loc?: string[]; ctx?: Record<string, unknown> };
    const campo = d.loc?.[d.loc.length - 1];
    const prefijo = campo && campo !== "body" ? `${campo}: ` : "";
    const traducciones: Record<string, string> = {
      string_too_short: `debe tener al menos ${d.ctx?.min_length} caracteres`,
      string_too_long: `debe tener máximo ${d.ctx?.max_length} caracteres`,
      missing: "es obligatorio",
      string_pattern_mismatch: "tiene caracteres no permitidos",
      greater_than_equal: `debe ser mayor o igual a ${d.ctx?.ge}`,
      less_than_equal: `debe ser menor o igual a ${d.ctx?.le}`,
    };
    if (traducciones[d.type]) return prefijo + traducciones[d.type];
    if (d.msg.includes("email")) return "Correo electrónico inválido";
    // "Value error, RFC inválido..." → "RFC inválido..."
    return d.msg.replace(/^Value error, /, "");
  }
  return `Error ${status}`;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const token = session.get()?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const r = await fetch(`/api${path}`, { ...init, headers });

  if (r.status === 401 && retry && session.get()) {
    refreshing ??= refresh().finally(() => (refreshing = null));
    if (await refreshing) return api<T>(path, init, false);
    session.clear();
    onSessionExpired();
  }

  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => null);
  if (!r.ok && path !== "/auth/login") revisarBloqueo(r.status, body);
  if (!r.ok) throw new ApiError(r.status, errorMessage(body, r.status), (body as { detail?: unknown })?.detail);
  return body as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, data: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) });
export const patch = <T>(path: string, data: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(data) });

// Zonas horarias de México (IANA).
export const ZONAS_MX: { value: string; label: string }[] = [
  { value: "America/Mexico_City", label: "Centro (CDMX, Guadalajara, Monterrey)" },
  { value: "America/Cancun", label: "Sureste (Quintana Roo)" },
  { value: "America/Merida", label: "Centro (Yucatán, Campeche)" },
  { value: "America/Monterrey", label: "Centro (Nuevo León)" },
  { value: "America/Chihuahua", label: "Centro (Chihuahua)" },
  { value: "America/Ciudad_Juarez", label: "Montaña con horario de verano (Cd. Juárez)" },
  { value: "America/Mazatlan", label: "Pacífico (Sinaloa, Nayarit, BCS)" },
  { value: "America/Hermosillo", label: "Pacífico sin horario de verano (Sonora)" },
  { value: "America/Tijuana", label: "Noroeste (Baja California)" },
  { value: "America/Matamoros", label: "Centro con horario de verano (frontera Tamaulipas)" },
];

// --- Etapa 3: turnos y empleados ---

export type TipoJornada = "diurna" | "nocturna" | "mixta";

export const JORNADAS: Record<TipoJornada, { label: string; max: string }> = {
  diurna: { label: "Diurna", max: "8 h (6:00–20:00)" },
  nocturna: { label: "Nocturna", max: "7 h (20:00–6:00)" },
  mixta: { label: "Mixta", max: "7.5 h (menos de 3.5 h nocturnas)" },
};

export const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const DIAS_CORTOS = ["L", "M", "M", "J", "V", "S", "D"];

export interface TurnoDia {
  dia_semana: number;
  entrada: string; // "HH:MM:SS"
  salida: string;
  comida_minutos: number;
  entrada2: string | null; // turno quebrado
  salida2: string | null;
}

export interface Turno {
  id: string;
  nombre: string;
  tipo_jornada: TipoJornada;
  tolerancia_minutos: number;
  activo: boolean;
  dias: TurnoDia[];
  minutos_semana: number;
  semana_max_minutos: number;
  advertencias: string[];
}

export interface Ref {
  id: string;
  nombre: string;
}

export interface Empleado {
  id: string;
  numero: string;
  nombre: string;
  apellido_paterno: string;
  apellido_materno: string | null;
  nombre_completo: string;
  curp: string | null;
  rfc: string | null;
  nss: string | null;
  fecha_ingreso: string;
  puesto: string | null;
  departamento: string | null;
  salario_diario: string | null;
  email: string | null;
  telefono: string | null;
  sucursal: SucursalRef;
  turno_actual: Ref | null;
  tiene_acceso: boolean;
  /** Acceso al portal del trabajador activo. */
  portal: boolean;
  portal_email: string | null;
  tiene_pin: boolean;
  foto_version: string | null;
  /** null = según la configuración de checadas de su sucursal. */
  medios_checado?: ("movil" | "kiosco" | "biometrico")[] | null;
  /** Kioscos/relojes donde puede checar; vacío = cualquiera. */
  dispositivos_checado?: string[];
  activo: boolean;
  fecha_baja: string | null;
  motivo_baja: string | null;
}

export interface Asignacion {
  id: string;
  turno: Ref;
  fecha_inicio: string;
  fecha_fin: string | null;
}

export interface EmpleadoDetalle extends Empleado {
  asignaciones: Asignacion[];
}

export const hhmm = (t: string) => t.slice(0, 5);

export function horas(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export const hoyISO = () => new Date().toLocaleDateString("en-CA"); // AAAA-MM-DD local

/** Descarga un archivo de la API (con el token) y lo guarda. */
export async function descargar(path: string, nombre: string): Promise<Headers> {
  const token = session.get()?.access_token;
  const r = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new ApiError(r.status, (typeof body?.detail === "string" && body.detail) || "No se pudo descargar el archivo");
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
  return r.headers;
}

/** Sube un archivo (multipart) a la API. */
export async function subir<T>(path: string, campo: string, archivo: File): Promise<T> {
  const body = new FormData();
  body.append(campo, archivo);
  return api<T>(path, { method: "POST", body });
}

// --- Etapa 4: checadas, dispositivos y bitácora ---

export interface Checada {
  id: string;
  tipo: "entrada" | "salida";
  momento: string;
  origen: "movil" | "kiosco" | "biometrico" | "manual";
  offline: boolean;
  distancia_m: number | null;
  retardo_minutos: number | null;
  estado: "valida" | "anulada";
  corregida: boolean;
  tiene_foto: boolean;
  empleado: { id: string; numero: string; nombre_completo: string; foto_actualizada: string | null };
  sucursal: SucursalRef;
  obra?: ObraRef | null;
}

export const ORIGENES: Record<Checada["origen"], string> = {
  movil: "Celular",
  kiosco: "Kiosco",
  biometrico: "Reloj biométrico",
  manual: "Manual",
};

export interface EstadoHoy {
  empleado: { id: string; numero: string; nombre_completo: string };
  sucursal: { id: string; clave: string; nombre: string; zona_horaria: string; latitud: number | null; longitud: number | null; radio_metros: number };
  turno: { nombre: string; entrada: string; salida: string; tolerancia_minutos: number; bloques: { entrada: string; salida: string }[] } | null;
  siguiente_tipo: "entrada" | "salida";
  permitir_movil: boolean;
  permitir_offline: boolean;
  requiere: { gps: boolean; foto: boolean; qr: boolean };
  checadas_hoy: Checada[];
  hora_servidor: string;
  festivo_hoy: string | null;
  designado_festivo: boolean;
  /** Obra asignada hoy: la ubicación se valida contra ella y no contra la sucursal. */
  obra?: (ObraRef & { latitud: number | null; longitud: number | null; radio_metros: number }) | null;
}

export interface ObraRef {
  id: string;
  clave: string;
  nombre: string;
}

export interface Obra extends ObraRef {
  sucursal_id: string;
  sucursal: SucursalRef;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  radio_metros: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  activa: boolean;
  /** Empleados asignados hoy. */
  empleados_asignados: number;
}

export interface AsignacionObra {
  id: string;
  obra: ObraRef;
  empleado: { id: string; numero: string; nombre_completo: string };
  fecha_inicio: string;
  fecha_fin: string | null;
}

export interface ConfigChecadas {
  permitir_movil: boolean;
  portal_historial: boolean;
  permitir_kiosco: boolean;
  validar_gps: boolean;
  validar_qr: boolean;
  foto: "ninguna" | "movil" | "kiosco" | "ambos";
  pin_kiosco: boolean;
  minutos_antes_entrada: number;
  ignorar_repetida_min: number;
  permitir_offline: boolean;
  offline_max_horas: number;
  sucursal_id: string | null;
  origen: "sucursal" | "general" | "predeterminada";
}

export interface Dispositivo {
  id: string;
  nombre: string;
  tipo: "kiosco" | "biometrico";
  serie: string | null;
  sucursal: SucursalRef;
  activo: boolean;
  vinculado: boolean;
  ultima_conexion: string | null;
  codigo_vinculacion: string | null;
  codigo_expira: string | null;
}

export interface Actividad {
  id: string;
  tipo: "creacion" | "cambio" | "nota" | "sistema";
  mensaje: string | null;
  cambios: { campo: string; etiqueta: string; antes: string | null; despues: string | null }[] | null;
  usuario: { id: string; nombre: string } | null;
  created_at: string;
}

/** Envía un formulario multipart (para checadas con foto). */
export function postForm<T>(path: string, campos: Record<string, string | Blob | null | undefined>, headers?: HeadersInit): Promise<T> {
  const body = new FormData();
  for (const [k, v] of Object.entries(campos)) {
    if (v === null || v === undefined) continue;
    if (v instanceof Blob) body.append(k, v, "foto.jpg");
    else body.append(k, v);
  }
  return api<T>(path, { method: "POST", body, headers });
}

export const hora = (iso: string, tz?: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: tz });

export const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });

/** Reduce una foto a máx. 720 px en JPEG para que suba rápido. */
export async function comprimir(blob: Blob, max = 720): Promise<Blob> {
  const img = await createImageBitmap(blob);
  const escala = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * escala);
  canvas.height = Math.round(img.height * escala);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((ok) => canvas.toBlob((b) => ok(b ?? blob), "image/jpeg", 0.8));
}

/** Carga una imagen protegida (con token) como URL local. */
export async function imagenProtegida(path: string): Promise<string> {
  const token = session.get()?.access_token;
  const r = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new ApiError(r.status, "Sin foto");
  return URL.createObjectURL(await r.blob());
}

// --- Etapa 5: tarjeta de asistencia (LFT) ---

export const INCIDENCIAS: Record<string, string> = {
  vacaciones: "Vacaciones",
  incapacidad: "Incapacidad (IMSS)",
  permiso_con_goce: "Permiso con goce",
  permiso_sin_goce: "Permiso sin goce",
  falta_justificada: "Falta justificada",
};

export interface ResumenAsistencia {
  dias_laborables: number;
  asistencias: number;
  faltas: number;
  faltas_por_retardos: number;
  retardos: number;
  minutos_retardo: number;
  minutos_trabajados: number;
  minutos_dobles: number;
  minutos_triples: number;
  minutos_exceso: number;
  domingos_trabajados: number;
  descansos_trabajados: number;
  festivos_trabajados: number;
  incidencias: Record<string, number>;
  sin_salida: number;
}

export interface FilaResumen {
  empleado: { id: string; numero: string; nombre_completo: string; foto_actualizada: string | null };
  sucursal: SucursalRef;
  resumen: ResumenAsistencia;
  /** Conceptos listos para nómina (HE2, FALT…) con su cantidad. */
  conceptos?: { clave: string; descripcion: string; unidad: string; cantidad: number }[];
}

export interface DiaAsistencia {
  fecha: string;
  estado: string;
  esperado_min: number;
  trabajado_min: number;
  retardo_min: number;
  retardos: number;
  extra_min: number;
  dobles_min: number;
  triples_min: number;
  exceso_min: number;
  festivo: string | null;
  festivo_obligatorio: boolean;
  domingo_trabajado: boolean;
  descanso_trabajado: boolean;
  festivo_trabajado: boolean;
  entradas: string[];
  salidas: string[];
  observaciones: string[];
}

export interface DetalleAsistencia {
  empleado: FilaResumen["empleado"];
  sucursal: SucursalRef;
  zona_horaria: string;
  dias: DiaAsistencia[];
  resumen: ResumenAsistencia;
}

export interface IncidenciaReg {
  id: string;
  empleado: FilaResumen["empleado"];
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string;
  notas: string | null;
  folio: string | null;
  created_at: string;
}

export interface Vacaciones {
  antiguedad_anios: number;
  periodo_inicio: string;
  periodo_fin: string;
  dias_correspondientes: number;
  dias_tomados: number;
  dias_disponibles: number;
  proximo_aniversario: string;
  dias_proximo_periodo: number;
}

export interface PoliticaAsistencia {
  retardos_por_falta: number;
  retardo_falta_min: number;
  minimo_extra_min: number;
  redondeo_extra_min: number;
  festivo_opcional_pago: "doble" | "normal";
}

/** Minutos → "7:30" */
export const hm = (min: number) => (min ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}` : "—");

export interface Festivo {
  id: string;
  fecha: string;
  nombre: string;
  tipo: "obligatorio" | "opcional";
  fundamento: string | null;
  origen: "nacional" | "empresa";
  aplica: boolean;
  editable: boolean;
}

// --- Etapa 6: reportes y nómina ---

export interface ConceptoNomina {
  clave: string;
  descripcion: string;
  unidad: string;
  codigo: string | null;
}

// --- Actividades programadas (como las de Odoo) ---

export type TipoTarea = "llamada" | "reunion" | "correo" | "tarea" | "recordatorio";

export interface Tarea {
  id: string;
  modelo: string | null;
  registro_id: string | null;
  registro_nombre: string | null;
  tipo: TipoTarea;
  resumen: string;
  nota: string | null;
  fecha: string;
  hora: string | null;
  asignado: Ref | null;
  hecha_en: string | null;
  comentario: string | null;
  created_at: string;
}

export interface ResumenTarea {
  pendientes: number;
  proxima: string;
}

/** Días entre hoy y la fecha (negativo = vencida). */
export function diasHasta(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const hoy = new Date();
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((a - b) / 86_400_000);
}

// --- Categorías (etiquetas) ---

export type ModeloCategoria = "empleado" | "sucursal" | "usuario" | "empresa";

export interface Categoria {
  id: string;
  modelo: ModeloCategoria;
  nombre: string;
  /** #rrggbb */
  color: string;
  registros: number;
}
