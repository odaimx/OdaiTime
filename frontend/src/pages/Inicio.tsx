import { useEffect, useState } from "react";
import { PageHeader } from "../components/ui";
import { ROLES } from "../lib/api";
import { useAuth } from "../lib/auth";

type Ready = { status: string; checks: Record<string, string> };

export default function Inicio() {
  const { usuario } = useAuth();
  const [ready, setReady] = useState<Ready | null>(null);

  useEffect(() => {
    fetch("/api/health/ready")
      .then((r) => r.json())
      .then(setReady)
      .catch(() => setReady({ status: "error", checks: {} }));
  }, []);

  if (!usuario) return null;

  return (
    <>
      <PageHeader title={`Hola, ${usuario.nombre.split(" ")[0]}`} subtitle={`${ROLES[usuario.rol]}${usuario.empresa ? ` · ${usuario.empresa.nombre}` : ""}`} />

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        {usuario.sucursales.length > 0 && (
          <div className="card p-6">
            <h2 className="text-sm font-medium text-slate-500">Tus sucursales</h2>
            <ul className="mt-3 space-y-1">
              {usuario.sucursales.map((s) => (
                <li key={s.id} className="text-navy-900">
                  <span className="font-mono text-xs text-brand-600">{s.clave}</span> {s.nombre}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card p-6">
          <h2 className="text-sm font-medium text-slate-500">Estado del sistema</h2>
          {!ready && <p className="mt-3 text-sm text-slate-500">Verificando…</p>}
          {ready && (
            <ul className="mt-3 space-y-1 text-sm">
              {Object.entries(ready.checks).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-navy-900">{k === "database" ? "Base de datos" : k === "cache" ? "Caché" : k}</span>
                  <span className={v === "ok" ? "text-emerald-600" : "text-red-600"}>{v}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
