import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, get, imagenProtegida, ROLES, session, type Empresa, type Licencia, type LimiteLicencia, type Tokens } from "../lib/api";
import { useSoporte } from "../lib/soporte";
import { temaActual } from "../lib/tema";
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
      <div className={`banda -mx-4 -mt-4 bg-navy-950 px-4 py-2.5 sm:-mx-6 sm:-mt-6 sm:px-6 lg:-mx-8 lg:-mt-8 lg:px-8 lg:py-2.5 ${submenu?.length ? "" : "mb-5"}`}>
        {/* En el celular el usuario queda a la derecha del título y las acciones bajan a otra línea. */}
        <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {icono && <Icono nombre={icono} className="h-6 w-6 shrink-0 text-oro-400 sm:h-8 sm:w-8" />}
            <h1 className="truncate text-[1.45rem] font-semibold leading-tight tracking-tight text-oro-400 sm:text-[1.75rem]">{title}</h1>
            {fuentes !== undefined && <FuentesOficiales articulos={fuentes || undefined} oscuro />}
          </div>
          {action && <div className="order-last flex w-full flex-col gap-3 sm:order-none sm:w-auto sm:flex-row sm:items-center">{action}</div>}
          <div className="flex shrink-0 items-center gap-3">
            <LicenciaBanda />
            <MenuUsuario />
          </div>
        </div>
      </div>
      {submenu && submenu.length > 0 && (
        <nav className="relative z-20 -mx-4 mb-5 flex flex-wrap gap-1 border-b border-slate-300 bg-submenu px-3 sm:-mx-6 sm:px-5 lg:-mx-8 lg:px-7" aria-label="Submenú">
          {submenu.map((m) => (
            <div key={m.etiqueta} className="relative">
              <button
                onClick={() => (m.opciones ? setAbierto((a) => (a === m.etiqueta ? null : m.etiqueta)) : m.onClick?.())}
                className={`inline-flex items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  m.activo ? "border-brand-500 text-tinta-900" : "border-transparent text-slate-600 hover:border-slate-300 hover:text-tinta-900"
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


/** Usuario activo junto al selector de empresa: su ficha, soporte y salir. */
/**
 * Licencia de la empresa en la banda, junto al usuario: "Licencia demo" o "Licencia válida" y su
 * vencimiento. Cambia a naranja 5 días antes de vencer y a rojo 2 días antes.
 */
function LicenciaBanda() {
  const { usuario } = useAuth();
  const e = usuario?.empresa;
  if (!e || (usuario.rol !== "admin_empresa" && usuario.rol !== "gerente_sucursal")) return null;
  const vence = e.licencia_vence ?? null;
  const dias = vence ? Math.ceil((new Date(`${vence}T23:59:59`).getTime() - Date.now()) / 86_400_000) : null;
  const color = dias !== null && dias <= 2 ? "text-red-400" : dias !== null && dias <= 5 ? "text-orange-400" : "text-oro-400";
  const fecha = vence ? new Date(`${vence}T12:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : null;
  return (
    <div className={`hidden shrink-0 text-right leading-tight sm:block ${color}`} title={dias !== null && dias <= 5 ? `Faltan ${Math.max(dias, 0)} día(s) para que venza la licencia` : undefined}>
      <p className="text-sm font-semibold">{e.demo ? "Licencia demo" : "Licencia válida"}</p>
      <p className="text-xs">{fecha ? `Vence ${fecha}` : "Sin vencimiento"}</p>
    </div>
  );
}

/** Foto grande del usuario (la de su ficha de empleado si la tiene), para el portal. */
export function FotoUsuario({ className = "h-28 w-28" }: { className?: string }) {
  const { usuario } = useAuth();
  const [foto, setFoto] = useState<string | null>(null);
  useEffect(() => {
    if (!usuario) return;
    let url: string | null = null;
    imagenProtegida(`/auth/me/foto?grande=1&v=${encodeURIComponent(usuario.foto_actualizada ?? "")}`)
      .then((u) => {
        url = u;
        setFoto(u);
      })
      .catch(() => setFoto(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [usuario]);
  return (
    <div className={`shrink-0 overflow-hidden rounded-2xl bg-white/10 ring-4 ring-white/20 ${className}`}>
      {foto ? (
        <img src={foto} alt={usuario?.nombre ?? ""} className="h-full w-full object-cover" />
      ) : (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          <circle cx="32" cy="24" r="11" fill="#cbd5e1" />
          <path d="M10 60c2-12 11-19 22-19s20 7 22 19" fill="#cbd5e1" />
        </svg>
      )}
    </div>
  );
}

export function MenuUsuario() {
  const { usuario, logout, refrescar } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [ficha, setFicha] = useState(false);
  const [clave, setClave] = useState(false);
  const [foto, setFoto] = useState<string | null>(null);
  const [soporte, setSoporte] = useState("https://odai.lat");
  const cierre = useRef<number | undefined>(undefined);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    temaActual()
      .then((t) => t.url_soporte && setSoporte(t.url_soporte))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!usuario) return;
    let url: string | null = null;
    imagenProtegida(`/auth/me/foto?v=${encodeURIComponent(usuario.foto_actualizada ?? "")}`)
      .then((u) => {
        url = u;
        setFoto(u);
      })
      .catch(() => setFoto(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [usuario]);
  // En pantallas táctiles se abre con un toque: se cierra al tocar fuera.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [abierto]);
  if (!usuario) return null;

  const abrir = () => {
    window.clearTimeout(cierre.current);
    setAbierto(true);
  };
  const cerrarLuego = () => {
    cierre.current = window.setTimeout(() => setAbierto(false), 200);
  };
  const elegir = (accion: () => void) => {
    setAbierto(false);
    accion();
  };

  return (
    <div
      ref={caja}
      className="relative shrink-0"
      // Solo el mouse abre por "hover"; en el celular el toque abriría y el clic cerraría al instante.
      onPointerEnter={(e) => e.pointerType === "mouse" && abrir()}
      onPointerLeave={(e) => e.pointerType === "mouse" && cerrarLuego()}
    >
      <button
        onClick={() => setAbierto((a) => !a)}
        className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5 ring-2 transition ${abierto ? "ring-oro-400" : "ring-white/30 hover:ring-oro-300"}`}
        title={usuario.nombre}
        aria-label="Menú del usuario"
        aria-expanded={abierto}
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
        // pt-2 en lugar de margen: el puntero no "sale" del menú al bajar del botón.
        <div className="absolute right-0 top-full z-40 pt-2">
          <div className="popover static w-64 max-w-[calc(100vw-2rem)] p-1">
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="truncate text-sm font-semibold text-tinta-900">{usuario.nombre}</p>
              <p className="truncate text-xs text-slate-500">{usuario.email}</p>
            </div>
            <button className="menu-item mt-1" onClick={() => elegir(() => setFicha(true))}>
              <Icono nombre="user-round" className="h-4 w-4" /> Mi ficha
            </button>
            <button className="menu-item" onClick={() => elegir(() => setClave(true))}>
              <Icono nombre="key-round" className="h-4 w-4" /> Cambiar contraseña
            </button>

            <a className="menu-item" href={soporte} target="_blank" rel="noopener noreferrer" onClick={() => setAbierto(false)}>
              <Icono nombre="send" className="h-4 w-4" /> Solicitar soporte
            </a>
            <hr className="my-1 border-slate-100" />
            <button className="menu-item text-red-600" onClick={logout}>
              <Icono nombre="log-out" className="h-4 w-4" /> Salir del sistema
            </button>
          </div>
        </div>
      )}
      {clave && <CambiarPassword onClose={() => setClave(false)} />}

      {ficha && (
        <Modal title="Mi ficha" onClose={() => setFicha(false)}>
          <div className="mb-5 flex items-center gap-4">
            <ImagenEditable
              acepta="image/*"
              onCambiar={async (archivo) => {
                const datos = new FormData();
                datos.append("archivo", archivo);
                await api("/auth/me/foto", { method: "PUT", body: datos });
                await refrescar();
              }}
              onQuitar={
                foto
                  ? async () => {
                      await api("/auth/me/foto", { method: "DELETE" });
                      await refrescar();
                    }
                  : undefined
              }
            >
              <div className="h-24 w-24 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
                {foto ? (
                  <img src={foto} alt={usuario.nombre} className="h-full w-full object-cover" />
                ) : (
                  <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
                    <circle cx="32" cy="24" r="11" fill="#cbd5e1" />
                    <path d="M10 60c2-12 11-19 22-19s20 7 22 19" fill="#cbd5e1" />
                  </svg>
                )}
              </div>
            </ImagenEditable>
            <p className="text-xs text-slate-500">Pasa el mouse sobre la imagen para cambiar o quitar tu foto.</p>
          </div>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="label">Nombre</dt>
              <dd className="text-tinta-900">{usuario.nombre}</dd>
            </div>
            <div>
              <dt className="label">Correo</dt>
              <dd className="text-tinta-900">{usuario.email}</dd>
            </div>
            <div>
              <dt className="label">Rol</dt>
              <dd className="text-tinta-900">{ROLES[usuario.rol]}</dd>
            </div>
            <div>
              <dt className="label">Empresa</dt>
              <dd className="text-tinta-900">{usuario.empresa?.nombre ?? "Odai (todas)"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="label">Sucursales</dt>
              <dd className="text-tinta-900">{usuario.rol === "admin_empresa" || usuario.rol === "superadmin" ? "Todas" : usuario.sucursales.map((s) => s.nombre).join(", ") || "—"}</dd>
            </div>
          </dl>
        </Modal>
      )}
    </div>
  );
}

function CambiarPassword({ onClose }: { onClose: () => void }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (nueva !== repetir) return setError("La confirmación no coincide con la nueva contraseña.");
    setGuardando(true);
    try {
      const t = await api<Tokens>("/auth/cambiar-password", { method: "POST", body: JSON.stringify({ actual, nueva }) });
      session.set(t); // las demás sesiones se cerraron; esta sigue con tokens nuevos
      setListo(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const tipo = ver ? "text" : "password";
  return (
    <Modal title="Cambiar contraseña" onClose={onClose}>
      {listo ? (
        <div className="space-y-4">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Listo. Tu contraseña se cambió y se cerraron tus sesiones en otros dispositivos.</p>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={guardar}>
          <label className="block">
            <span className="label">Contraseña actual</span>
            <input className="input" type={tipo} autoComplete="current-password" required value={actual} onChange={(e) => setActual(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Nueva contraseña</span>
            <input className="input" type={tipo} autoComplete="new-password" required minLength={8} value={nueva} onChange={(e) => setNueva(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Confirmar nueva contraseña</span>
            <input className="input" type={tipo} autoComplete="new-password" required minLength={8} value={repetir} onChange={(e) => setRepetir(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} /> Mostrar contraseñas
          </label>
          <ErrorBox message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn-primary" disabled={guardando}>
              {guardando ? "Guardando…" : "Cambiar contraseña"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/**
 * Guardado de las pantallas de configuración, igual que en las fichas: nube roja con cambios
 * sin guardar, verde cuando está guardado. Ctrl+S también guarda.
 */
export function BarraGuardar({ sucio, guardando = false, onGuardar, children }: { sucio: boolean; guardando?: boolean; onGuardar: () => void; children?: ReactNode }) {
  const ref = useRef(onGuardar);
  ref.current = onGuardar;
  useEffect(() => {
    if (!sucio) return;
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [sucio]);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-100/70 px-3 py-1.5">
      <button
        type="button"
        disabled={!sucio || guardando}
        onClick={onGuardar}
        title={sucio ? "Guardar (Ctrl+S)" : "Guardado"}
        aria-label="Guardar"
        className={`rounded-lg p-1 transition disabled:cursor-default ${sucio ? "text-red-600 hover:text-red-700" : "text-emerald-600"}`}
      >
        <Icono nombre={sucio ? "cloud-upload" : "cloud-check"} className="h-5 w-5" />
      </button>
      <span className={`text-xs ${sucio ? "text-red-600" : "text-emerald-600"}`}>{guardando ? "Guardando…" : sucio ? "Sin guardar" : "Guardado"}</span>
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Obsoleto: todas las ventanas tienen el mismo ancho y posición que los registros. */
  ancho?: "md" | "lg" | "xl";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy-900/40 p-3 pt-6 sm:p-4 sm:pt-12" onMouseDown={onClose}>
      {/* La ventana nunca pasa del alto de la pantalla: su contenido se desplaza por dentro. */}
      <div className={`ventana-form card flex max-h-[calc(100dvh-3rem)] w-full flex-col overflow-hidden sm:max-h-[calc(100dvh-7rem)] max-w-6xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-end border-b border-slate-200 bg-slate-100/70 px-4 py-2.5 sm:px-5">
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-tinta-900" aria-label="Cerrar">
            <Icono nombre="x" className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5 pb-12 sm:p-8 sm:pb-14">
          <h2 className="mb-5 text-xl font-semibold text-tinta-900 sm:text-2xl">{title}</h2>
          {children}
        </div>
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
  const soporte = useSoporte();
  const esSuper = usuario?.rol === "superadmin";
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [elegida, setEmpresaId] = useState<string | null>(usuario?.empresa?.id ?? null);
  // En modo soporte la empresa queda fija: la que se eligió en su ficha.
  const empresaId = esSuper && soporte ? soporte.id : elegida;

  useEffect(() => {
    if (!esSuper || soporte) return;
    get<Empresa[]>("/empresas").then((list) => {
      setEmpresas(list);
      setEmpresaId((actual) => actual ?? list[0]?.id ?? null);
    });
  }, [esSuper, soporte]);

  const selector = esSuper && !soporte ? (
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
          <p className="text-sm text-tinta-900">{info.mensaje}</p>
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
        <span className="text-tinta-900">Licencia{lic.vencida && <span className="ml-1 font-medium text-red-600">vencida</span>}</span>
        <span className="font-medium text-tinta-900">
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

/** Ícono "?" con la explicación del campo (aparece al pasar el mouse o al tocarlo). */
export function Ayuda({ texto }: { texto: ReactNode }) {
  const [ver, setVer] = useState(false);
  return (
    <span className="relative inline-flex align-middle" onMouseEnter={() => setVer(true)} onMouseLeave={() => setVer(false)}>
      <button
        type="button"
        onClick={(e) => (e.preventDefault(), setVer((v) => !v))}
        className="ml-0.5 inline-flex items-center justify-center px-0.5 text-xs font-bold leading-none text-slate-400 hover:text-brand-600"
        aria-label="Ayuda"
      >
        ?
      </button>
      {ver && (
        <span role="tooltip" className="absolute left-1/2 top-6 z-50 w-64 -translate-x-1/2 rounded-lg bg-navy-950 px-3 py-2 text-xs font-normal leading-snug text-white shadow-lg">
          {texto}
        </span>
      )}
    </span>
  );
}

/** Fila de formulario como Odoo: etiqueta a la izquierda y campo a la derecha (alinea las columnas). */
export function Fila({ etiqueta, ayuda, htmlFor, completo, children }: { etiqueta: ReactNode; ayuda?: ReactNode; htmlFor?: string; completo?: boolean; children: ReactNode }) {
  return (
    <div className={`grid min-h-10 grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[9.5rem_minmax(0,1fr)] ${completo ? "md:col-span-2" : ""}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-tinta-900">
        {etiqueta}
        {ayuda && <Ayuda texto={ayuda} />}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Sección que se pliega y despliega (historiales, bitácoras). Cerrada de entrada. */
export function Plegable({ titulo, abierto = false, children }: { titulo: ReactNode; abierto?: boolean; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-slate-200" open={abierto}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-tinta-900 hover:bg-slate-50">
        <Icono nombre="chevron-right" className="h-4 w-4 text-slate-400 transition group-open:rotate-90" />
        {titulo}
      </summary>
      <div className="border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}

/**
 * Imagen con sus acciones encima (como Odoo): lápiz para cambiarla, cámara (opcional) y bote
 * para quitarla. Las acciones aparecen al pasar el mouse.
 */
export function ImagenEditable({
  children,
  onCambiar,
  onQuitar,
  onCamara,
  className = "",
  acepta = "image/png,image/jpeg,image/webp",
}: {
  children: ReactNode;
  onCambiar: (f: File) => void;
  onQuitar?: () => void;
  onCamara?: () => void;
  className?: string;
  acepta?: string;
}) {
  const boton = "flex h-7 w-7 items-center justify-center rounded-md bg-white/95 text-slate-600 shadow ring-1 ring-slate-200 hover:text-brand-600";
  return (
    <div className={`group relative inline-flex flex-col items-center ${className}`}>
      {children}
      {/* Acciones en el borde inferior de la imagen: aparecen al pasar el mouse (no ocupan renglones). */}
      <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <label className={`${boton} cursor-pointer`} title="Cambiar">
          <Icono nombre="pencil" className="h-3.5 w-3.5" />
          <input type="file" accept={acepta} className="sr-only" onChange={(e) => e.target.files?.[0] && onCambiar(e.target.files[0])} />
        </label>
        {onCamara && (
          <button type="button" className={boton} title="Tomar con la cámara" onClick={onCamara}>
            <Icono nombre="camera" className="h-3.5 w-3.5" />
          </button>
        )}
        {onQuitar && (
          <button type="button" className={`${boton} hover:!bg-red-50 hover:!text-red-600`} title="Quitar" onClick={onQuitar}>
            <Icono nombre="trash" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Rejilla de formulario a dos columnas (igual en todas las ventanas). */
export function Campos({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-10 gap-y-3 md:grid-cols-2">{children}</div>;
}

export interface Domicilio {
  calle: string;
  colonia: string;
  codigo_postal: string;
  ciudad: string;
  entidad: string;
}
export const DOMICILIO_VACIO: Domicilio = { calle: "", colonia: "", codigo_postal: "", ciudad: "", entidad: "" };
export const domicilioDe = (o: Partial<Record<keyof Domicilio, string | null>> | null | undefined): Domicilio => ({
  calle: o?.calle ?? "",
  colonia: o?.colonia ?? "",
  codigo_postal: o?.codigo_postal ?? "",
  ciudad: o?.ciudad ?? "",
  entidad: o?.entidad ?? "",
});
/** Para la API: vacíos como null. */
export const domicilioApi = (d: Domicilio) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim() || null]));

export const ENTIDADES = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila",
  "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit",
  "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas",
  "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
];

/** Calle y número, colonia, C.P., ciudad y estado (dentro de <Campos>). */
export function CamposDomicilio({ valor, onCambio, prefijo = "dom" }: { valor: Domicilio; onCambio: (d: Domicilio) => void; prefijo?: string }) {
  const set = (k: keyof Domicilio) => (e: { target: { value: string } }) => onCambio({ ...valor, [k]: e.target.value });
  return (
    <>
      <Fila etiqueta="Calle y número" htmlFor={`${prefijo}-calle`}>
        <input id={`${prefijo}-calle`} className="input" maxLength={200} placeholder="Calle 71 No. 800" value={valor.calle} onChange={set("calle")} />
      </Fila>
      <Fila etiqueta="Colonia" htmlFor={`${prefijo}-colonia`}>
        <input id={`${prefijo}-colonia`} className="input" maxLength={120} value={valor.colonia} onChange={set("colonia")} />
      </Fila>
      <Fila etiqueta="C.P." htmlFor={`${prefijo}-cp`}>
        <input id={`${prefijo}-cp`} className="input" inputMode="numeric" maxLength={5} pattern="\d{5}" title="5 dígitos" value={valor.codigo_postal} onChange={(e) => onCambio({ ...valor, codigo_postal: e.target.value.replace(/\D/g, "") })} />
      </Fila>
      <Fila etiqueta="Ciudad o municipio" htmlFor={`${prefijo}-ciudad`}>
        <input id={`${prefijo}-ciudad`} className="input" maxLength={120} value={valor.ciudad} onChange={set("ciudad")} />
      </Fila>
      <Fila etiqueta="Estado" htmlFor={`${prefijo}-entidad`}>
        <select id={`${prefijo}-entidad`} className="input" value={valor.entidad} onChange={set("entidad")}>
          <option value="">—</option>
          {ENTIDADES.map((e) => (
            <option key={e}>{e}</option>
          ))}
          {valor.entidad && !ENTIDADES.includes(valor.entidad) && <option>{valor.entidad}</option>}
        </select>
      </Fila>
    </>
  );
}

/** Latitud (con «Estoy aquí» y «Calcular con el domicilio»), longitud y radio, dentro de <Campos>. */
export function CamposUbicacion({
  latitud,
  longitud,
  radio,
  domicilio,
  lugar,
  deshabilitado,
  onCambio,
}: {
  latitud: string;
  longitud: string;
  radio: string;
  domicilio: Domicilio;
  lugar: string;
  deshabilitado?: boolean;
  onCambio: (c: { latitud?: string; longitud?: string; radio_metros?: string }) => void;
}) {
  const [mensaje, setMensaje] = useState<string | null>(null);
  return (
    <>
      <Fila
        etiqueta="Latitud"
        ayuda={`«Estoy aquí» toma tu ubicación actual (estando en ${lugar}); el pin la calcula con el domicilio. También puedes copiarlas de Google Maps (clic derecho sobre el lugar).`}
      >
        <div className="flex items-center gap-1.5">
          <input className="input" type="number" step="any" min={-90} max={90} placeholder="21.1619" value={latitud} onChange={(e) => onCambio({ latitud: e.target.value })} />
          <UbicarBotones domicilio={domicilio} deshabilitado={deshabilitado} onMensaje={setMensaje} onUbicar={(la, lo) => onCambio({ latitud: la, longitud: lo })} />
        </div>
      </Fila>
      <Fila etiqueta="Longitud">
        <div className="flex items-center gap-2">
          <input className="input" type="number" step="any" min={-180} max={180} placeholder="-86.8515" value={longitud} onChange={(e) => onCambio({ longitud: e.target.value })} />
          {latitud && longitud && (
            <a className="shrink-0 text-xs text-brand-600 hover:underline" href={`https://www.google.com/maps?q=${latitud},${longitud}`} target="_blank" rel="noreferrer">
              Ver mapa
            </a>
          )}
        </div>
      </Fila>
      <Fila etiqueta="Radio (m)" ayuda="Distancia máxima desde las coordenadas para aceptar una checada con GPS.">
        <input className="input" type="number" min={10} max={5000} value={radio} onChange={(e) => onCambio({ radio_metros: e.target.value })} />
      </Fila>
      {mensaje && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 md:col-span-2">{mensaje}</p>}
    </>
  );
}

type Encontrado = { lat: string; lon: string; display_name: string };
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Busca el domicilio en OpenStreetMap; si no encuentra la calle, prueba con colonia, C.P. y ciudad. */
async function geocodificar(d: Domicilio): Promise<{ r: Encontrado; nivel: string | null } | null> {
  const base = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=mx&accept-language=es";
  const q = (...p: string[]) => `${base}&q=${encodeURIComponent([...p.filter(Boolean), "México"].join(", "))}`;
  const intentos: [string, string | null][] = [];
  if (d.calle) {
    const est = new URLSearchParams({ street: d.calle, city: d.ciudad, state: d.entidad, postalcode: d.codigo_postal, country: "México" });
    intentos.push([`${base}&${[...est].filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`, null]);
    intentos.push([q(d.calle, d.colonia, d.ciudad, d.entidad), null]);
  }
  if (d.colonia) intentos.push([q(d.colonia, d.codigo_postal, d.ciudad, d.entidad), "la colonia"]);
  if (d.codigo_postal) intentos.push([`${base}&postalcode=${d.codigo_postal}&country=M%C3%A9xico`, "el código postal"]);
  if (d.ciudad) intentos.push([q(d.ciudad, d.entidad), "la ciudad"]);
  for (let i = 0; i < intentos.length; i++) {
    if (i) await espera(1100); // OpenStreetMap pide máximo una consulta por segundo
    const lista = (await (await fetch(intentos[i][0])).json()) as Encontrado[];
    if (lista.length) return { r: lista[0], nivel: intentos[i][1] };
  }
  return null;
}

/**
 * Botones junto a la latitud: «Estoy aquí» (GPS del navegador) y «Buscar la dirección»
 * (OpenStreetMap). Llenan latitud y longitud; se pueden ajustar a mano.
 */
export function UbicarBotones({
  domicilio,
  onUbicar,
  onMensaje: setMensaje,
  deshabilitado,
}: {
  domicilio: Domicilio;
  onUbicar: (lat: string, lon: string) => void;
  onMensaje: (m: string | null) => void;
  deshabilitado?: boolean;
}) {
  const [ocupado, setOcupado] = useState<"gps" | "dir" | null>(null);

  function aqui() {
    setMensaje(null);
    if (!navigator.geolocation) return setMensaje("Este navegador no da la ubicación.");
    setOcupado("gps");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setOcupado(null);
        onUbicar(p.coords.latitude.toFixed(6), p.coords.longitude.toFixed(6));
        setMensaje(`Ubicación tomada (precisión ±${Math.round(p.coords.accuracy)} m).`);
      },
      (e) => {
        setOcupado(null);
        setMensaje(e.code === e.PERMISSION_DENIED ? "Permite el acceso a la ubicación en el navegador." : "No se pudo obtener la ubicación.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function buscar() {
    setMensaje(null);
    if (!domicilio.calle && !domicilio.colonia && !domicilio.codigo_postal && !domicilio.ciudad) return setMensaje("Captura primero el domicilio.");
    setOcupado("dir");
    try {
      const res = await geocodificar(domicilio);
      if (!res) setMensaje("No se encontró el domicilio. Revisa la colonia, el C.P. y la ciudad, o usa «Estoy aquí» estando en el lugar.");
      else {
        onUbicar(Number(res.r.lat).toFixed(6), Number(res.r.lon).toFixed(6));
        setMensaje(
          res.nivel
            ? `No se encontró la calle exacta; se tomó el centro de ${res.nivel} (${res.r.display_name}). Ajusta las coordenadas o usa «Estoy aquí» estando en el lugar.`
            : `Encontrada: ${res.r.display_name}. Revisa que sea correcta.`,
        );
      }
    } catch {
      setMensaje("No se pudo buscar el domicilio. Intenta más tarde.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex shrink-0 gap-1.5">
        <button type="button" className="rounded-md p-1.5 text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-brand-600 disabled:opacity-50" title="Estoy aquí: tomar mi ubicación actual" aria-label="Tomar mi ubicación actual" disabled={deshabilitado || !!ocupado} onClick={aqui}>
          <Icono nombre="locate-fixed" className={`h-4 w-4 ${ocupado === "gps" ? "animate-pulse" : ""}`} />
        </button>
        <button type="button" className="rounded-md p-1.5 text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-brand-600 disabled:opacity-50" title="Calcular con el domicilio" aria-label="Calcular con el domicilio" disabled={deshabilitado || !!ocupado} onClick={buscar}>
          <Icono nombre="map-pin" className={`h-4 w-4 ${ocupado === "dir" ? "animate-pulse" : ""}`} />
        </button>
    </div>
  );
}
