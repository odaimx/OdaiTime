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
  created_at: string;
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
  ) {
    super(message);
  }
}

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
  if (init.body) headers.set("Content-Type", "application/json");
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
  if (!r.ok) throw new ApiError(r.status, errorMessage(body, r.status));
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
