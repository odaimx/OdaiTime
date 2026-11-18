import { useCallback, useEffect, useState } from "react";
import { colorFecha, FormActividad, textoFecha, TIPOS } from "../components/Actividades";
import Calendario from "../components/Calendario";
import Icono from "../components/Iconos";
import { PageHeader, useEmpresaScope } from "../components/ui";
import { get, type Tarea } from "../lib/api";

/** Mis actividades pendientes y el calendario de la empresa (como "Actividades" de Odoo). */
export default function Actividades() {
  const { query, listo, selector } = useEmpresaScope();
  const [mias, setMias] = useState<Tarea[]>([]);
  const [abierta, setAbierta] = useState<Tarea | null>(null);
  const [rev, setRev] = useState(0);

  const cargar = useCallback(() => {
    if (listo) get<Tarea[]>(`/tareas/mias${query}`).then(setMias);
  }, [listo, query]);
  useEffect(cargar, [cargar, rev]);

  const grupos: [string, Tarea[]][] = [
    ["Vencidas", mias.filter((t) => colorFecha(t.fecha).includes("red"))],
    ["Hoy", mias.filter((t) => colorFecha(t.fecha).includes("amber"))],
    ["Próximas", mias.filter((t) => colorFecha(t.fecha).includes("emerald"))],
  ];

  return (
    <>
      <PageHeader icono="calendar-check" title="Actividades" subtitle="Llamadas, reuniones, tareas y recordatorios programados" action={selector} />
      {listo && (
        <div className="flex flex-col gap-6 xl:flex-row">
          <aside className="h-fit w-full shrink-0 rounded-lg border border-slate-200 bg-white p-4 xl:w-72">
            <h2 className="mb-3 font-semibold text-navy-900">Mis pendientes</h2>
            {mias.length === 0 && <p className="text-sm text-slate-500">No tienes actividades pendientes. 🎉</p>}
            {grupos.map(([titulo, lista]) =>
              lista.length ? (
                <div key={titulo} className="mb-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {titulo} <span className="font-normal">({lista.length})</span>
                  </p>
                  <ul className="space-y-1">
                    {lista.map((t) => (
                      <li key={t.id}>
                        <button className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50" onClick={() => setAbierta(t)}>
                          <span className={`mt-0.5 rounded-md p-1 ring-1 ${TIPOS[t.tipo].color}`}>
                            <Icono nombre={TIPOS[t.tipo].icono} className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-navy-900">{t.resumen}</span>
                            <span className="block truncate text-xs text-slate-500">{t.registro_nombre ?? "General"}</span>
                            <span className={`text-xs ${colorFecha(t.fecha)}`}>{textoFecha(t.fecha)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </aside>
          <div className="min-w-0 flex-1">
            <Calendario key={rev} query={query} />
          </div>
        </div>
      )}
      {abierta && (
        <FormActividad
          tarea={abierta}
          query={query}
          onCerrar={() => setAbierta(null)}
          onGuardado={() => {
            setAbierta(null);
            setRev((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
