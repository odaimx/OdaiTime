import FondoEmpresa from "../components/FondoEmpresa";
import LogoEmpresa from "../components/LogoEmpresa";
import { useEffect, useState } from "react";
import { PageHeader, UsoLicencia } from "../components/ui";
import { get, ROLES, type Licencia } from "../lib/api";
import { cargarTema } from "../lib/tema";
import { useAuth } from "../lib/auth";

type Ready = { status: string; checks: Record<string, string> };

export default function Inicio() {
  const { usuario, refrescar } = useAuth();
  const [ready, setReady] = useState<Ready | null>(null);
  const [lic, setLic] = useState<Licencia | null>(null);
  const [imagen, setImagen] = useState<string | null>(null);
  useEffect(() => {
    cargarTema()
      .then((t) => setImagen(t.imagen_version))
      .catch(() => {});
  }, []);
  const verLicencia = usuario?.rol === "admin_empresa" || usuario?.rol === "gerente_sucursal";

  useEffect(() => {
    if (verLicencia) get<Licencia>("/licencia").then(setLic).catch(() => {});
  }, [verLicencia]);

  useEffect(() => {
    if (usuario?.rol !== "superadmin") return;
    fetch("/api/health/ready")
      .then((r) => r.json())
      .then(setReady)
      .catch(() => setReady({ status: "error", checks: {} }));
  }, [usuario?.rol]);

  if (!usuario) return null;

  return (
    <>
      <PageHeader icono="house" title={`Hola, ${usuario.nombre.split(" ")[0]}`} subtitle={`${ROLES[usuario.rol]}${usuario.empresa ? ` · ${usuario.empresa.nombre}` : ""}`} />

      {imagen && (
        <div className="-mx-4 -mt-5 mb-6 sm:-mx-6 lg:-mx-8">
          <img src={`/api/sistema/imagen-inicio?v=${encodeURIComponent(imagen)}`} alt="" className="h-48 w-full object-cover sm:h-64 lg:h-80" />
        </div>
      )}

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
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
        {lic && (
          <div className="card p-6">
            <h2 className="mb-3 text-sm font-medium text-slate-500">Tu licencia</h2>
            <UsoLicencia lic={lic} />
            {lic.vence && <p className="mt-2 text-xs text-slate-500">Vigente hasta {new Date(lic.vence + "T12:00").toLocaleDateString("es-MX", { dateStyle: "long" })}</p>}
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

        {usuario.rol === "superadmin" && (
        <div className="card p-6">
          <h2 className="text-sm font-medium text-slate-500">Estado del sistema</h2>
          {!ready && <p className="mt-3 text-sm text-slate-500">Verificando…</p>}
          {ready && (
            <ul className="mt-3 space-y-1 text-sm">
              {Object.entries(ready.checks).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-tinta-900">{k === "database" ? "Base de datos" : k === "cache" ? "Caché" : k}</span>
                  <span className={v === "ok" ? "text-emerald-600" : "text-red-600"}>{v}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}
      </div>
    </>
  );
}
