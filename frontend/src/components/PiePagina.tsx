import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";

type Ready = { status: string; checks: Record<string, string> };

const NOMBRES: Record<string, string> = { database: "Base de datos", cache: "Caché" };

/** Pie de página en una sola línea: derechos, estado del sistema (Odai) y versión. */
export default function PiePagina() {
  const { usuario } = useAuth();
  const [ready, setReady] = useState<Ready | null>(null);
  const esSuper = usuario?.rol === "superadmin";

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

  return (
    <footer className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-300/70 pt-1.5 text-xs font-medium text-slate-700">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>© {new Date().getFullYear()} ODAI. Todos los derechos reservados.</span>
        {esSuper && ready && (
          <>
            <span className="text-slate-400">·</span>
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
      </div>
      <span>ODAITIME v{__VERSION__}</span>
    </footer>
  );
}
