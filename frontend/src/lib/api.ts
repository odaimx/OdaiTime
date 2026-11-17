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
  empresa: { id: string; nombre: string } | null;
  sucursales: SucursalRef[];
  ultimo_acceso: string | null;
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
  slug: string;
  url: string | null;
  created_at: string;
}

export interface TenantInfo {
  modo: "base" | "tenant" | "libre";
  nombre?: string | null;
  slug?: string | null;
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

interface Tokens {
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
  if (!r.ok) return false;
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
}

export interface Turno {
  id: string;
  nombre: string;
  tipo_jornada: TipoJornada;
  tolerancia_minutos: number;
  activo: boolean;
  dias: TurnoDia[];
  minutos_semana: number;
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
export async function descargar(path: string, nombre: string): Promise<void> {
  const token = session.get()?.access_token;
  const r = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new ApiError(r.status, "No se pudo descargar el archivo");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

/** Sube un archivo (multipart) a la API. */
export async function subir<T>(path: string, campo: string, archivo: File): Promise<T> {
  const body = new FormData();
  body.append(campo, archivo);
  return api<T>(path, { method: "POST", body });
}
