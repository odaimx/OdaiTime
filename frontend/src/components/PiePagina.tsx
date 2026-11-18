import { useEffect, useState } from "react";
import { get, type Licencia } from "../lib/api";
import { useAuth } from "../lib/auth";
import { temaActual } from "../lib/tema";

type Ready = { status: string; checks: Record<string, string> };

const NOMBRES: Record<string, string> = { database: "Base de datos", cache: "Caché" };

const fecha = (iso: string) => new Date(iso + "T12:00").toLocaleDateString("es-MX", { dateStyle: "medium" });

/** Pie de página en una sola línea: derechos, estado del sistema, licencia y versión. */
export default function PiePagina() {
  const { usuario } = useAuth();
  const [servidorDemo, setServidorDemo] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [lic, setLic] = useState<Licencia | null>(null);
  const esSuper = usuario?.rol === "superadmin";
  // Demo: la empresa marcada como demo (presentaciones) o todo el servidor (DEMO=true).
  const demo = servidorDemo || !!usuario?.empresa?.demo;
  const verLicencia = usuario?.rol === "admin_empresa" || usuario?.rol === "gerente_sucursal";

  useEffect(() => {
    temaActual()
      .then((t) => setServidorDemo(!!t.demo))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!esSuper) return;
    const revisar = () =>
      fetch("/api/health/ready")
        .then((r) => r.json())
        .then(setReady)
        .catch(() => setReady({ status: "error", checks: { database: "error", cache: "error" } }));
    revisar();
    const t = setInterval(revisar, 60_000);
    return () => clearInterval(t);
  }, [esSuper]);

  useEffect(() => {
    if (verLicencia && !demo) get<Licencia>("/licencia").then(setLic).catch(() => {});
  }, [verLicencia, demo, usuario?.empresa?.id]);

  const separador = <span className="text-slate-300">·</span>;

  return (
    <footer className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-xs text-slate-400">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>© {new Date().getFullYear()} ODAI. Todos los derechos reservados.</span>

        {esSuper && ready && (
          <>
            {separador}
            <span className="inline-flex items-center gap-3" title="Estado del sistema">
              {Object.entries(ready.checks).map(([k, v]) => (
                <span key={k} className="inline-flex items-center gap-1" title={v === "ok" ? "Funcionando" : v}>
                  <span className={`h-2 w-2 rounded-full ${v === "ok" ? "bg-emerald-500" : "bg-red-500"}`} />
                  {NOMBRES[k] ?? k}
                </span>
              ))}
            </span>
          </>
        )}

        {demo ? (
          <>
            {separador}
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800" title="Empresa de demostración">
              Licencia demo
            </span>
          </>
        ) : (
          lic && (
            <>
              {separador}
              <span className={lic.vencida ? "font-medium text-red-600" : ""}>
                Licencia{lic.vencida ? " vencida" : ""}: {lic.activos} de {lic.max_empleados} empleados
                {lic.vence && !lic.vencida && ` · vigente hasta ${fecha(lic.vence)}`}
              </span>
              {(lic.vencida || lic.disponibles === 0) && (
                <a href={lic.url_compra} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
                  Renovar
                </a>
              )}
            </>
          )
        )}
      </div>
      <span>ODAITIME v{__VERSION__}</span>
    </footer>
  );
}
