import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { ROLES, type Rol } from "../lib/api";
import { useAuth } from "../lib/auth";

const NAV: { to: string; label: string; roles: Rol[]; icon: string }[] = [
  { to: "/", label: "Inicio", roles: ["superadmin", "admin_empresa", "gerente_sucursal", "empleado"], icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { to: "/empresas", label: "Empresas", roles: ["superadmin"], icon: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1" },
  { to: "/sucursales", label: "Sucursales", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11zm0-8a3 3 0 100-6 3 3 0 000 6z" },
  { to: "/empleados", label: "Empleados", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M15 7a3 3 0 11-6 0 3 3 0 016 0zM4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" },
  { to: "/turnos", label: "Turnos", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { to: "/usuarios", label: "Usuarios", roles: ["superadmin", "admin_empresa"], icon: "M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3 3 0 100-6 3 3 0 000 6zm13 9v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0">
      <path d={d} />
    </svg>
  );
}

export default function Layout() {
  const { usuario, logout } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const { pathname } = useLocation();

  // En móvil, el menú se cierra al navegar.
  useEffect(() => setAbierto(false), [pathname]);

  if (!usuario) return null;

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* Barra superior (solo móvil/tablet) */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-navy-900 px-4 py-3 lg:hidden">
        <img src="/logo.png" alt="ODAI" className="h-6 w-auto" />
        <button onClick={() => setAbierto(true)} className="rounded-lg p-2 text-white hover:bg-navy-800" aria-label="Abrir menú">
          <Icon d="M4 6h16M4 12h16M4 18h16" />
        </button>
      </header>

      {abierto && <div className="fixed inset-0 z-40 bg-navy-900/50 lg:hidden" onClick={() => setAbierto(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-navy-900 text-slate-300 transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:translate-x-0 ${
          abierto ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between px-6 py-6">
          <div>
            <img src="/logo.png" alt="ODAI" className="h-8 w-auto" />
            <p className="mt-2 text-xs font-medium tracking-[0.2em] text-accent-500">TIME</p>
          </div>
          <button onClick={() => setAbierto(false)} className="text-slate-400 hover:text-white lg:hidden" aria-label="Cerrar menú">
            ✕
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {NAV.filter((n) => n.roles.includes(usuario.rol)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? "bg-brand-500 text-white" : "hover:bg-navy-800 hover:text-white"
                }`
              }
            >
              <Icon d={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-navy-700 px-4 py-4">
          <p className="truncate text-sm font-medium text-white">{usuario.nombre}</p>
          <p className="truncate text-xs text-slate-400">
            {ROLES[usuario.rol]}
            {usuario.empresa && ` · ${usuario.empresa.nombre}`}
          </p>
          <button onClick={logout} className="mt-3 text-xs font-medium text-accent-500 hover:text-white">
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
