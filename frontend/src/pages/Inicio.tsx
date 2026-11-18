import FondoEmpresa from "../components/FondoEmpresa";
import LogoEmpresa from "../components/LogoEmpresa";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/ui";
import { ROLES } from "../lib/api";
import { temaActual } from "../lib/tema";
import { useAuth } from "../lib/auth";

export default function Inicio() {
  const { usuario, refrescar } = useAuth();
  const [imagen, setImagen] = useState<string | null>(null);
  useEffect(() => {
    temaActual()
      .then((t) => setImagen(t.imagen_version))
      .catch(() => {});
  }, []);

  if (!usuario) return null;

  return (
    <>
      <PageHeader icono="house" title={`Hola, ${usuario.nombre.split(" ")[0]}`} subtitle={`${ROLES[usuario.rol]}${usuario.empresa ? ` · ${usuario.empresa.nombre}` : ""}`} />

      {imagen && (
        <div className="-mx-4 -mt-5 sm:-mx-6 lg:-mx-8">
          {/* Ocupa todo el alto disponible entre el encabezado y el pie de página. */}
          <img
            src={`/api/sistema/imagen-inicio?v=${encodeURIComponent(imagen)}`}
            alt=""
            className="h-[calc(100dvh-12rem)] min-h-64 w-full object-cover sm:h-[calc(100dvh-9rem)] lg:h-[calc(100dvh-10rem)]"
          />
        </div>
      )}

      <div className={`grid gap-4 empty:hidden sm:gap-6 md:grid-cols-2 ${imagen ? "mt-6" : ""}`}>
        {usuario.rol === "admin_empresa" && usuario.empresa && (
          <div className="card p-6">
            <h2 className="mb-3 text-sm font-medium text-slate-500">Logo de la empresa</h2>
            <LogoEmpresa empresaId={usuario.empresa.id} version={usuario.empresa.logo_version} onCambio={() => refrescar()} />
          </div>
        )}
        {usuario.rol === "admin_empresa" && usuario.empresa && (
          <div className="card p-6">
            <h2 className="mb-3 text-sm font-medium text-slate-500">Fondo principal de la empresa</h2>
            <FondoEmpresa empresaId={usuario.empresa.id} color={usuario.empresa.fondo_color} version={usuario.empresa.fondo_version} onCambio={() => refrescar()} />
          </div>
        )}
        {usuario.sucursales.length > 0 && (
          <div className="card p-6">
            <h2 className="text-sm font-medium text-slate-500">Tus sucursales</h2>
            <ul className="mt-3 space-y-1">
              {usuario.sucursales.map((s) => (
                <li key={s.id} className="text-tinta-900">
                  <span className="font-mono text-xs text-brand-600">{s.clave}</span> {s.nombre}
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>
    </>
  );
}
