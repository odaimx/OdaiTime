import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { get, hoyISO, urlLogo, type Rol, type Tarea } from "../lib/api";
import { estiloFondoApp, useTema } from "../lib/tema";
import { useAuth } from "../lib/auth";
import { usePortal } from "../lib/portal";
import Icono, { type NombreIcono } from "./Iconos";
import { REPORTE } from "../lib/imprimir";
import PiePagina from "./PiePagina";
import { salirSoporte, useSoporte } from "../lib/soporte";

const NAV: { to: string; label: string; roles: Rol[]; icon: NombreIcono }[] = [
  { to: "/checar", label: "Checar", roles: ["empleado"], icon: "fingerprint-pattern" },
  { to: "/mis-registros", label: "Mis registros", roles: ["empleado"], icon: "list-checks" },
  { to: "/", label: "Inicio", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "house" },
  { to: "/empresas", label: "Empresas", roles: ["superadmin"], icon: "building" },
  { to: "/sucursales", label: "Sucursales", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "store" },
  { to: "/empleados", label: "Empleados", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "contact-round" },
  { to: "/asistencia", label: "Tarjeta de asistencia", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "clipboard-list" },
  { to: "/checadas", label: "Asistencias", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "fingerprint-pattern" },
  { to: "/actividades", label: "Actividades", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "calendar-check" },
  { to: "/reportes", label: "Exportaciones", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "file-chart-column" },
  { to: "/turnos", label: "Turnos", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "calendar-clock" },
  { to: "/festivos", label: "Días festivos", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "calendar-heart" },
  { to: "/usuarios", label: "Usuarios", roles: ["superadmin", "admin_empresa"], icon: "users" },
  { to: "/mi-empresa", label: "Mi empresa", roles: ["superadmin", "admin_empresa"], icon: "building" },
];

const FIJO_KEY = "odaitime.menuFijo";

export default function Layout() {
  const { usuario, refrescar } = useAuth();
  const soporte = useSoporte();
  const tema = useTema();
  const navegar = useNavigate();
  const portal = usePortal(usuario?.rol === "empleado");
  // Al abrir, vuelve a leer el usuario: trae cambios de la empresa (logo, fondo) hechos en otra sesión.
  useEffect(() => {
    refrescar().catch(() => {});
  }, [refrescar]);
  const [abierto, setAbierto] = useState(false); // móvil: panel abierto
  // Empresa que firma los reportes PDF.
  REPORTE.empresa = {
    nombre: usuario?.empresa?.nombre ?? soporte?.nombre ?? "ODAITIME",
    logo: usuario?.empresa?.logo_version ? `${window.location.origin}${urlLogo(usuario.empresa.id, usuario.empresa.logo_version)}` : "",
  };
  const [pendientes, setPendientes] = useState(0); // mis actividades vencidas o de hoy
  const ubicacion = useLocation();
  useEffect(() => {
    if (!usuario?.empresa || usuario.rol === "empleado") return;
    const leer = () =>
      get<Tarea[]>(`/tareas/mias?hasta=${hoyISO()}`)
        .then((l) => setPendientes(l.length))
        .catch(() => {});
    leer();
    const t = setInterval(leer, 120_000);
    return () => clearInterval(t);
  }, [usuario, ubicacion.pathname]);
  const [hover, setHover] = useState(false); // escritorio: el mouse está encima
  const [fijo, setFijo] = useState(() => {
    try {
      return localStorage.getItem(FIJO_KEY) === "1";
    } catch {
      return false;
    }
  });
  const { pathname } = useLocation();

  // Al navegar se cierra en móvil y se repliega en escritorio.
  useEffect(() => {
    setAbierto(false);
    setHover(false);
  }, [pathname]);

  function alternarFijo() {
    const v = !fijo;
    setFijo(v);
    try {
      localStorage.setItem(FIJO_KEY, v ? "1" : "0");
    } catch {
      /* sin almacenamiento */
    }
  }

  if (!usuario) return null;

  // En escritorio: barra de íconos que se abre al pasar el mouse (o fija si el usuario la fija).
  const expandido = fijo || hover;
  const oculto = expandido ? "" : "lg:hidden"; // textos que solo se ven con el menú abierto

  return (
    <div className="min-h-screen bg-white">
      {/* Barra superior (solo móvil/tablet) */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-navy-950 px-4 py-3 lg:hidden">
        <img src="/logo.png" alt="ODAI" className="h-6 w-auto" />
        <button onClick={() => setAbierto(true)} className="rounded-lg p-2 text-white hover:bg-navy-800" aria-label="Abrir menú">
          <Icono nombre="menu" className="h-5 w-5" />
        </button>
      </header>

      {abierto && <div className="fixed inset-0 z-40 bg-navy-900/50 lg:hidden" onClick={() => setAbierto(false)} />}

      <aside
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHover(false)}
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-hidden bg-navy-950 text-oro-400 transition-all duration-200 lg:translate-x-0 ${
          abierto ? "translate-x-0" : "-translate-x-full"
        } ${expandido ? "lg:w-64" : "lg:w-16"} ${hover && !fijo ? "lg:shadow-2xl" : ""}`}
      >
        <div className={`flex items-start justify-between py-6 ${expandido ? "px-6" : "px-6 lg:px-3"}`}>
          <div className={oculto}>
            {usuario.empresa?.logo_version ? (
              <div className="flex h-12 w-44 items-center justify-center rounded-lg bg-white p-1.5">
                <img src={urlLogo(usuario.empresa.id, usuario.empresa.logo_version)} alt={usuario.empresa.nombre} className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <p className="max-w-44 truncate text-base font-semibold text-oro-300">{usuario.empresa?.nombre ?? "Odai"}</p>
            )}
          </div>
          <button onClick={() => setAbierto(false)} className="text-oro-400 hover:text-oro-300 lg:hidden" aria-label="Cerrar menú">
            ✕
          </button>
          <button
            onClick={alternarFijo}
            className={`hidden rounded-md p-1 text-oro-400/70 hover:bg-navy-800 hover:text-oro-300 ${expandido ? "lg:block" : ""}`}
            aria-label={fijo ? "Ocultar menú automáticamente" : "Fijar menú abierto"}
            title={fijo ? "Ocultar automáticamente" : "Fijar menú"}
          >
            <svg viewBox="0 0 24 24" fill={fijo ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z" />
            </svg>
          </button>
        </div>

        <nav className={`flex-1 space-y-1 overflow-y-auto overflow-x-hidden ${expandido ? "px-3" : "px-3 lg:px-2"}`}>
          {NAV.filter((n) => n.roles.includes(usuario.rol) && (usuario.rol !== "superadmin" || !!soporte || n.to === "/" || n.to === "/empresas") && (n.to !== "/checar" || portal?.checar) && (n.to !== "/mis-registros" || portal?.historial)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/" || n.to === "/checadas"}
              title={expandido ? undefined : n.label}
              className={({ isActive }) =>
                `flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? "bg-brand-500 text-white" : "text-oro-400 hover:bg-navy-800 hover:text-oro-300"
                }`
              }
            >
              <span className="relative">
                <Icono nombre={n.icon} className="h-5 w-5 shrink-0" />
                {n.to === "/actividades" && pendientes > 0 && (
                  <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">{pendientes}</span>
                )}
              </span>
              <span className={oculto}>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={`whitespace-nowrap border-t border-navy-700 py-4 ${expandido ? "px-4" : "px-4 lg:px-2"}`}>
          <div className={`flex items-end gap-2 ${oculto}`}>
            <img src="/logo.png" alt="ODAI" className="h-7 w-auto" />
            <span className="pb-0.5 text-xs font-medium tracking-[0.2em] text-accent-500">TIME</span>
          </div>
        </div>
      </aside>

      {/* El contenido deja espacio para la barra de íconos (o para el menú fijo). */}
      {usuario.rol === "superadmin" && soporte && (
        // Recordatorio permanente: se están viendo los datos de un cliente.
        <div className="fixed left-1/2 top-0 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-b-lg bg-amber-400 px-4 py-1 text-xs font-medium text-navy-950 shadow">
          <Icono nombre="eye" className="h-3.5 w-3.5" />
          Modo soporte · {soporte.nombre}
          <button
            className="rounded bg-navy-950/10 px-2 py-0.5 hover:bg-navy-950/20"
            onClick={() => {
              salirSoporte();
              navegar("/empresas");
            }}
          >
            Salir
          </button>
        </div>
      )}
      <main style={estiloFondoApp(tema)} className={`min-w-0 transition-[padding] duration-200 ${fijo ? "lg:pl-64" : "lg:pl-16"}`}>
        <div className="flex min-h-dvh flex-col px-4 pb-1.5 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
          {/* Columna flexible: una página puede estirar una sección (p. ej. la imagen de inicio). */}
          <div className="flex flex-1 flex-col">
            <Outlet />
          </div>
          <PiePagina />
        </div>
      </main>
    </div>
  );
}
