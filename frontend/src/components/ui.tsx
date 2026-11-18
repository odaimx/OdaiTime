import { useEffect, useState, type ReactNode } from "react";
import { get, imagenProtegida, ROLES, type Empresa, type Licencia, type LimiteLicencia } from "../lib/api";
import { useAuth } from "../lib/auth";
import { FuentesOficiales } from "./LFT";
import Icono, { type NombreIcono } from "./Iconos";

export interface Ajustes {
  /** Título del modal, p. ej. "Reglas de la tarjeta de asistencia". */
  titulo: string;
  contenido: ReactNode;
  ancho?: "md" | "lg" | "xl";
}

export interface ItemSubmenu {
  etiqueta: string;
  activo?: boolean;
  onClick?: () => void;
  /** Si tiene opciones, abre un menú desplegable. */
  opciones?: { etiqueta: string; icono?: NombreIcono; onClick: () => void }[];
}

/**
 * Encabezado azul marino de cada pantalla: ícono, título beige y, a la derecha, el selector
 * de empresa. Debajo, los submenús del módulo (como el menú superior de Odoo).
 */
export function PageHeader({
  title,
  action,
  fuentes,
  icono,
  submenu,
}: {
  title: string;
  /** Ya no se muestra (se quitaron las leyendas bajo los títulos). */
  subtitle?: string;
  action?: ReactNode;
  fuentes?: string;
  icono?: NombreIcono;
  submenu?: ItemSubmenu[];
}) {
  const [abierto, setAbierto] = useState<string | null>(null);
  return (
    <>
      <div className={`banda -mx-4 -mt-4 bg-navy-950 px-4 py-4 sm:-mx-6 sm:-mt-6 sm:px-6 lg:-mx-8 lg:-mt-8 lg:px-8 lg:py-5 ${submenu?.length ? "" : "mb-5"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {icono && <Icono nombre={icono} className="h-8 w-8 shrink-0 text-oro-400 sm:h-9 sm:w-9" />}
            <h1 className="truncate text-2xl font-semibold tracking-tight text-oro-400 sm:text-3xl">{title}</h1>
            {fuentes !== undefined && <FuentesOficiales articulos={fuentes || undefined} oscuro />}
          </div>
          <div className="flex items-center gap-3">
            {action && <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">{action}</div>}
            <MenuUsuario />
          </div>
        </div>
      </div>
      {submenu && submenu.length > 0 && (
        <nav className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 sm:-mx-6 sm:px-5 lg:-mx-8 lg:px-7" aria-label="Submenú">
          {submenu.map((m) => (
            <div key={m.etiqueta} className="relative">
              <button
                onClick={() => (m.opciones ? setAbierto((a) => (a === m.etiqueta ? null : m.etiqueta)) : m.onClick?.())}
                className={`inline-flex items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  m.activo ? "border-brand-500 text-navy-900" : "border-transparent text-slate-600 hover:border-slate-300 hover:text-navy-900"
                }`}
              >
                {m.etiqueta}
                {m.opciones && <Icono nombre="chevron-down" className="h-3.5 w-3.5" />}
              </button>
              {m.opciones && abierto === m.etiqueta && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setAbierto(null)} />
                  <div className="popover left-0 top-11 w-64 p-1">
                    {m.opciones.map((o) => (
                      <button
                        key={o.etiqueta}
                        className="menu-item"
                        onClick={() => {
                          setAbierto(null);
                          o.onClick();
                        }}
                      >
                        <span className="w-4">{o.icono && <Icono nombre={o.icono} className="h-4 w-4" />}</span>
                        {o.etiqueta}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </nav>
      )}
    </>
  );
}

export const URL_SOPORTE = "https://odai.lat";

/** Usuario activo junto al selector de empresa: su ficha, soporte y salir. */
export function MenuUsuario() {
  const { usuario, logout } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [ficha, setFicha] = useState(false);
  const [foto, setFoto] = useState<string | null>(null);
  useEffect(() => {
    if (!usuario) return;
    let url: string | null = null;
    imagenProtegida("/auth/me/foto")
      .then((u) => {
        url = u;
        setFoto(u);
      })
      .catch(() => setFoto(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [usuario]);
  if (!usuario) return null;
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setAbierto((a) => !a)}
        className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5 ring-2 transition ${abierto ? "ring-oro-400" : "ring-white/30 hover:ring-oro-300"}`}
        title={usuario.nombre}
        aria-label="Menú del usuario"
      >
        {foto ? (
          <img src={foto} alt={usuario.nombre} className="h-full w-full rounded-md object-cover" />
        ) : (
          <svg viewBox="0 0 64 64" className="h-full w-full rounded-md bg-slate-100" aria-hidden="true">
            <circle cx="32" cy="24" r="11" fill="#cbd5e1" />
            <path d="M10 60c2-12 11-19 22-19s20 7 22 19" fill="#cbd5e1" />
          </svg>
        )}
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setAbierto(false)} />
          <div className="popover right-0 top-12 w-64 p-1">
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="truncate text-sm font-semibold text-navy-900">{usuario.nombre}</p>
              <p className="truncate text-xs text-slate-500">{usuario.email}</p>
            </div>
            <button className="menu-item mt-1" onClick={() => (setAbierto(false), setFicha(true))}>
              <Icono nombre="user-round" className="h-4 w-4" /> Mi ficha
            </button>
            <a className="menu-item" href={URL_SOPORTE} target="_blank" rel="noopener noreferrer" onClick={() => setAbierto(false)}>
              <Icono nombre="send" className="h-4 w-4" /> Solicitar soporte
            </a>
            <hr className="my-1 border-slate-100" />
            <button className="menu-item text-red-600" onClick={logout}>
              <Icono nombre="log-out" className="h-4 w-4" /> Salir del sistema
            </button>
          </div>
        </>
      )}
      {ficha && (
        <Modal title="Mi ficha" onClose={() => setFicha(false)}>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="label">Nombre</dt>
              <dd className="text-navy-900">{usuario.nombre}</dd>
            </div>
            <div>
              <dt className="label">Correo</dt>
              <dd className="text-navy-900">{usuario.email}</dd>
            </div>
            <div>
              <dt className="label">Rol</dt>
              <dd className="text-navy-900">{ROLES[usuario.rol]}</dd>
            </div>
            <div>
              <dt className="label">Empresa</dt>
              <dd className="text-navy-900">{usuario.empresa?.nombre ?? "Odai (todas)"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="label">Sucursales</dt>
              <dd className="text-navy-900">{usuario.rol === "admin_empresa" || usuario.rol === "superadmin" ? "Todas" : usuario.sucursales.map((s) => s.nombre).join(", ") || "—"}</dd>
            </div>
          </dl>
        </Modal>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  ancho = "md",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  ancho?: "md" | "lg" | "xl";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-900/40 p-3 pt-6 sm:p-4 sm:pt-16" onMouseDown={onClose}>
      <div className={`card w-full p-5 sm:p-6 ${ancho === "xl" ? "max-w-5xl" : ancho === "lg" ? "max-w-2xl" : "max-w-lg"}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-navy-900" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="completo rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{message}</p>;
}

export function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Empresa sobre la que se trabaja. Los usuarios de una empresa usan la suya;
 * el superadmin elige una del selector. Devuelve el query string para la API.
 */
export function useEmpresaScope() {
  const { usuario } = useAuth();
  const esSuper = usuario?.rol === "superadmin";
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState<string | null>(usuario?.empresa?.id ?? null);

  useEffect(() => {
    if (!esSuper) return;
    get<Empresa[]>("/empresas").then((list) => {
      setEmpresas(list);
      setEmpresaId((actual) => actual ?? list[0]?.id ?? null);
    });
  }, [esSuper]);

  const selector = esSuper ? (
    <select className="input w-full sm:w-64" value={empresaId ?? ""} onChange={(e) => setEmpresaId(e.target.value)}>
      {empresas.length === 0 && <option value="">Sin empresas</option>}
      {empresas.map((e) => (
        <option key={e.id} value={e.id}>
          {e.nombre}
        </option>
      ))}
    </select>
  ) : null;

  const query = esSuper && empresaId ? `?empresa_id=${empresaId}` : "";
  const listo = !esSuper || empresaId !== null;
  return { query, listo, selector, empresaId };
}

/** Aviso cuando se llega al límite de la licencia, con liga para comprar más. */
export function AvisoLicencia({ info, onClose }: { info: LimiteLicencia; onClose: () => void }) {
  const vencida = info.codigo === "licencia_vencida";
  return (
    <Modal title={vencida ? "Tu licencia está vencida" : "Ya no hay lugares disponibles"} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-4 rounded-lg bg-brand-50 p-4">
          <div className="text-center">
            <p className="text-3xl font-semibold text-brand-600">
              {info.activos}/{info.max_empleados}
            </p>
            <p className="text-xs text-slate-500">empleados activos</p>
          </div>
          <p className="text-sm text-navy-900">{info.mensaje}</p>
        </div>
        {!vencida && (
          <p className="text-sm text-slate-600">
            Para registrar más empleados amplía tu licencia. También puedes liberar un lugar dando de baja a alguien que ya no labore contigo.
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>
            Ahora no
          </button>
          <a href={info.url_compra} target="_blank" rel="noopener noreferrer" className="btn-primary">
            {vencida ? "Renovar licencia" : "Comprar más licencias"}
          </a>
        </div>
      </div>
    </Modal>
  );
}

/** Barra de uso de la licencia. */
export function UsoLicencia({ lic, compacto = false }: { lic: Licencia; compacto?: boolean }) {
  const pct = Math.min(100, Math.round((lic.activos / lic.max_empleados) * 100));
  const color = lic.vencida || pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-navy-900";
  return (
    <div className={compacto ? "w-full sm:w-64" : ""}>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-navy-900">Licencia{lic.vencida && <span className="ml-1 font-medium text-red-600">vencida</span>}</span>
        <span className="font-medium text-navy-900">
          {lic.activos} de {lic.max_empleados} empleados
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {!compacto && lic.disponibles <= Math.max(1, Math.ceil(lic.max_empleados * 0.2)) && (
        <a href={lic.url_compra} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline">
          {lic.disponibles === 0 ? "Sin lugares disponibles · Comprar más" : `Quedan ${lic.disponibles} · Comprar más`}
        </a>
      )}
    </div>
  );
}
