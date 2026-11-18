import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { ROLES, urlLogo, type Rol } from "../lib/api";
import { useAuth } from "../lib/auth";

const NAV: { to: string; label: string; roles: Rol[]; icon: string }[] = [
  { to: "/checar", label: "Checar", roles: ["empleado"], icon: "M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { to: "/mis-registros", label: "Mis registros", roles: ["empleado"], icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
  { to: "/", label: "Inicio", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { to: "/empresas", label: "Empresas", roles: ["superadmin"], icon: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1" },
  { to: "/sucursales", label: "Sucursales", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11zm0-8a3 3 0 100-6 3 3 0 000 6z" },
  { to: "/empleados", label: "Empleados", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M15 7a3 3 0 11-6 0 3 3 0 016 0zM4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" },
  { to: "/asistencia", label: "Tarjeta de asistencia", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" },
  { to: "/checadas", label: "Asistencias", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
  { to: "/reportes", label: "Reportes y nómina", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M9 17v-6m3 6V7m3 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" },
  { to: "/turnos", label: "Turnos", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { to: "/festivos", label: "Días festivos", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM12 14l1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L9 16.3l2-.3z" },
  { to: "/checadas/configuracion", label: "Config. asistencias", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" },
  { to: "/usuarios", label: "Usuarios", roles: ["superadmin", "admin_empresa"], icon: "M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3 3 0 100-6 3 3 0 000 6zm13 9v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0">
      <path d={d} />
    </svg>
  );
}

const FIJO_KEY = "odaitime.menuFijo";

export default function Layout() {
  const { usuario, logout } = useAuth();
  const [abierto, setAbierto] = useState(false); // móvil: panel abierto
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
    <div className="min-h-screen bg-slate-50">
      {/* Barra superior (solo móvil/tablet) */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-navy-900 px-4 py-3 lg:hidden">
        <img src="/logo.png" alt="ODAI" className="h-6 w-auto" />
        <button onClick={() => setAbierto(true)} className="rounded-lg p-2 text-white hover:bg-navy-800" aria-label="Abrir menú">
          <Icon d="M4 6h16M4 12h16M4 18h16" />
        </button>
      </header>

      {abierto && <div className="fixed inset-0 z-40 bg-navy-900/50 lg:hidden" onClick={() => setAbierto(false)} />}

      <aside
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHover(false)}
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-hidden bg-navy-900 text-slate-300 transition-all duration-200 lg:translate-x-0 ${
          abierto ? "translate-x-0" : "-translate-x-full"
        } ${expandido ? "lg:w-64" : "lg:w-16"} ${hover && !fijo ? "lg:shadow-2xl" : ""}`}
      >
        <div className={`flex items-start justify-between py-6 ${expandido ? "px-6" : "px-6 lg:px-3"}`}>
          <div className={oculto}>
            <img src="/logo.png" alt="ODAI" className="h-8 w-auto" />
            <p className="mt-2 text-xs font-medium tracking-[0.2em] text-accent-500">TIME</p>
          </div>
          {!expandido && (
            <span className="hidden h-10 w-10 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white lg:flex" aria-hidden="true">
              OT
            </span>
          )}
          <button onClick={() => setAbierto(false)} className="text-slate-400 hover:text-white lg:hidden" aria-label="Cerrar menú">
            ✕
          </button>
          <button
            onClick={alternarFijo}
            className={`hidden rounded-md p-1 text-slate-400 hover:bg-navy-800 hover:text-white ${expandido ? "lg:block" : ""}`}
            aria-label={fijo ? "Ocultar menú automáticamente" : "Fijar menú abierto"}
            title={fijo ? "Ocultar automáticamente" : "Fijar menú"}
          >
            <svg viewBox="0 0 24 24" fill={fijo ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z" />
            </svg>
          </button>
        </div>

        <nav className={`flex-1 space-y-1 overflow-y-auto overflow-x-hidden ${expandido ? "px-3" : "px-3 lg:px-2"}`}>
          {NAV.filter((n) => n.roles.includes(usuario.rol)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/" || n.to === "/checadas"}
              title={expandido ? undefined : n.label}
              className={({ isActive }) =>
                `flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? "bg-brand-500 text-white" : "hover:bg-navy-800 hover:text-white"
                }`
              }
            >
              <Icon d={n.icon} />
              <span className={oculto}>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={`whitespace-nowrap border-t border-navy-700 py-4 ${expandido ? "px-4" : "px-4 lg:px-2"}`}>
          <div className={oculto}>
            {usuario.empresa?.logo_version && (
              <div className="mb-3 flex h-12 items-center justify-center rounded-lg bg-white p-1.5">
                <img src={urlLogo(usuario.empresa.id, usuario.empresa.logo_version)} alt={usuario.empresa.nombre} className="max-h-full max-w-full object-contain" />
              </div>
            )}
            <p className="truncate text-sm font-medium text-white">{usuario.nombre}</p>
            <p className="truncate text-xs text-slate-400">
              {ROLES[usuario.rol]}
              {usuario.empresa && ` · ${usuario.empresa.nombre}`}
            </p>
            <button onClick={logout} className="mt-3 text-xs font-medium text-accent-500 hover:text-white">
              Cerrar sesión
            </button>
          </div>
          {!expandido && (
            <span className="hidden h-10 w-10 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-white lg:mx-auto lg:flex" aria-hidden="true">
              {usuario.nombre
                .split(" ")
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase()}
            </span>
          )}
        </div>
      </aside>

      {/* El contenido deja espacio para la barra de íconos (o para el menú fijo). */}
      <main className={`min-w-0 p-4 transition-[padding] duration-200 sm:p-6 ${fijo ? "lg:pl-72" : "lg:pl-24"} lg:pr-8 lg:pt-8 lg:pb-8`}>
        <Outlet />
      </main>
    </div>
  );
}
