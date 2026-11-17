import { NavLink, Outlet } from "react-router";
import { ROLES, type Rol } from "../lib/api";
import { useAuth } from "../lib/auth";

const NAV: { to: string; label: string; roles: Rol[]; icon: string }[] = [
  { to: "/", label: "Inicio", roles: ["superadmin", "admin_empresa", "gerente_sucursal", "empleado"], icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { to: "/empresas", label: "Empresas", roles: ["superadmin"], icon: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1" },
  { to: "/sucursales", label: "Sucursales", roles: ["superadmin", "admin_empresa", "gerente_sucursal"], icon: "M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11zm0-8a3 3 0 100-6 3 3 0 000 6z" },
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
  if (!usuario) return null;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-64 shrink-0 flex-col bg-navy-900 text-slate-300">
        <div className="px-6 py-6">
          <img src="/logo.png" alt="ODAI" className="h-8 w-auto" />
          <p className="mt-2 text-xs font-medium tracking-[0.2em] text-accent-500">TIME</p>
        </div>

        <nav className="flex-1 space-y-1 px-3">
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

      <main className="min-w-0 flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
