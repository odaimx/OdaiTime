import { useEffect, useState, type FormEvent } from "react";
import { api, get, type PoliticaAsistencia } from "../lib/api";
import { ArticuloLFT } from "./LFT";

/** Reglas de la tarjeta de asistencia (retardos, tiempo extra, festivos opcionales).
 * Se abre desde el engrane de Configuración en la Tarjeta de asistencia. */
export default function ReglasTarjeta({ query, esAdmin }: { query: string; esAdmin: boolean }) {
  const [politica, setPolitica] = useState<PoliticaAsistencia | null>(null);
  const [msgPol, setMsgPol] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    get<PoliticaAsistencia>(`/asistencia/politica${query}`).then(setPolitica);
  }, [query]);

  async function guardarPolitica(e: FormEvent) {
    e.preventDefault();
    if (!politica) return;
    setMsgPol(null);
    try {
      setPolitica(await api<PoliticaAsistencia>(`/asistencia/politica${query}`, { method: "PUT", body: JSON.stringify(politica) }));
      setMsgPol({ ok: true, texto: "Reglas guardadas." });
    } catch (err) {
      setMsgPol({ ok: false, texto: (err as Error).message });
    }
  }

  if (!politica) return <p className="text-sm text-slate-500">Cargando…</p>;
  return (
            <form onSubmit={guardarPolitica} className="space-y-4">
              <fieldset disabled={!esAdmin} className="space-y-4">
                <legend className="sr-only">Reglas de la tarjeta de asistencia</legend>
                <div>
                  <h2 className="font-semibold text-navy-900">Reglas de la tarjeta de asistencia</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Aplican a toda la empresa. Los retardos no están en la LFT: dependen de tu reglamento interior de trabajo (<ArticuloLFT art="423" />).
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-navy-900">
                    Retardos que equivalen a una falta
                    <input type="number" min={0} max={31} className="input mt-1" value={politica.retardos_por_falta} onChange={(e) => setPolitica({ ...politica, retardos_por_falta: Number(e.target.value) })} />
                    <span className="mt-1 block text-xs font-normal text-slate-500">0 = no se convierten</span>
                  </label>
                  <label className="text-sm font-medium text-navy-900">
                    Retardo que cuenta como falta (min)
                    <input type="number" min={0} max={480} className="input mt-1" value={politica.retardo_falta_min} onChange={(e) => setPolitica({ ...politica, retardo_falta_min: Number(e.target.value) })} />
                    <span className="mt-1 block text-xs font-normal text-slate-500">0 = no aplica</span>
                  </label>
                  <label className="text-sm font-medium text-navy-900">
                    Tiempo extra mínimo a contar (min)
                    <input type="number" min={0} max={240} className="input mt-1" value={politica.minimo_extra_min} onChange={(e) => setPolitica({ ...politica, minimo_extra_min: Number(e.target.value) })} />
                  </label>
                  <label className="text-sm font-medium text-navy-900 sm:col-span-2">
                    Si se trabaja un festivo opcional (no obligatorio por ley)
                    <select className="input mt-1" value={politica.festivo_opcional_pago} onChange={(e) => setPolitica({ ...politica, festivo_opcional_pago: e.target.value as "doble" | "normal" })}>
                      <option value="doble">Pagar salario doble adicional (igual que un obligatorio)</option>
                      <option value="normal">Pagar como día normal</option>
                    </select>
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      Los obligatorios del <ArticuloLFT art="74" /> siempre se pagan con salario doble adicional (<ArticuloLFT art="75" />).
                    </span>
                  </label>
                  <label className="text-sm font-medium text-navy-900">
                    Contar tiempo extra en bloques de (min)
                    <input type="number" min={1} max={120} className="input mt-1" value={politica.redondeo_extra_min} onChange={(e) => setPolitica({ ...politica, redondeo_extra_min: Number(e.target.value) })} />
                  </label>
                </div>
                <p className="text-xs text-slate-500">
                  Los límites de horas extra los fija la ley: dobles hasta 4 h diarias, 4 días y el tope semanal del año (<ArticuloLFT art="66" />); triples hasta 4 h más por semana (<ArticuloLFT art="68" />).
                </p>
                {msgPol && <p className={`rounded-lg px-3 py-2 text-sm ${msgPol.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{msgPol.texto}</p>}
                {esAdmin && (
                  <div className="flex justify-end">
                    <button className="btn-primary">Guardar reglas</button>
                  </div>
                )}
              </fieldset>
            </form>
  );
}
