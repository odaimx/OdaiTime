import { useEffect, useState } from "react";
import { PageHeader } from "../components/ui";
import { get, hora, ORIGENES, type Checada } from "../lib/api";

export default function MisRegistros() {
  const [checadas, setChecadas] = useState<Checada[] | null>(null);
  useEffect(() => {
    get<Checada[]>("/checadas/mias").then(setChecadas).catch(() => setChecadas([]));
  }, []);

  // Agrupa por día.
  const dias = new Map<string, Checada[]>();
  for (const c of checadas ?? []) {
    const d = new Date(c.momento).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
    dias.set(d, [...(dias.get(d) ?? []), c]);
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader icono="list-checks" title="Mis registros" subtitle="Últimos 15 días" />
      {checadas === null && <p className="text-sm text-slate-500">Cargando…</p>}
      {checadas?.length === 0 && <p className="card p-6 text-center text-slate-500">Aún no tienes checadas.</p>}
      <div className="space-y-4">
        {[...dias.entries()].map(([dia, lista]) => (
          <section key={dia}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{dia}</h2>
            <ul className="card divide-y divide-slate-100">
              {lista
                .slice()
                .reverse()
                .map((c) => (
                  <li key={c.id} className={`flex items-center justify-between px-4 py-3 text-sm ${c.estado === "anulada" ? "opacity-50" : ""}`}>
                    <div>
                      <p className="font-medium capitalize text-navy-900">
                        {c.tipo}
                        {c.retardo_minutos ? <span className="ml-2 text-xs font-normal text-amber-700">retardo {c.retardo_minutos} min</span> : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {ORIGENES[c.origen]} · {c.sucursal.clave}
                        {c.estado === "anulada" && " · anulada"}
                        {c.corregida && c.estado !== "anulada" && " · corregida"}
                      </p>
                    </div>
                    <span className="tabular-nums text-slate-700">{hora(c.momento)}</span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
