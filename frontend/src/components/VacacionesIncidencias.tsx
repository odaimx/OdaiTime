import Icono from "./Iconos";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { abrirArchivo, api, get, INCIDENCIAS, post, RAMOS, subirPut, TIPOS_INCAPACIDAD, type IncidenciaReg, type Vacaciones } from "../lib/api";
import { ArticuloLFT } from "./LFT";
import { ErrorBox } from "./ui";

const fecha = (iso: string) => new Date(iso + "T12:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

/** Saldo de vacaciones (art. 76) e incidencias de un empleado, dentro de su ficha. */
export default function VacacionesIncidencias({ empleadoId, query, onCambio }: { empleadoId: string; query: string; onCambio?: () => void }) {
  const sep = query ? "&" : "?";
  const [vac, setVac] = useState<Vacaciones | null>(null);
  const [lista, setLista] = useState<IncidenciaReg[]>([]);
  const [abierto, setAbierto] = useState(false);
  const VACIO = { tipo: "vacaciones", fecha_inicio: "", fecha_fin: "", notas: "", folio: "", ramo: "enfermedad_general", tipo_incapacidad: "inicial" };
  const [form, setForm] = useState(VACIO);
  const [certificado, setCertificado] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    get<Vacaciones>(`/asistencia/vacaciones/${empleadoId}${query}`).then(setVac).catch(() => setVac(null));
    get<IncidenciaReg[]>(`/asistencia/incidencias${query}${sep}empleado_id=${empleadoId}`).then(setLista).catch(() => setLista([]));
  }, [empleadoId, query, sep]);
  useEffect(cargar, [cargar]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const incap = form.tipo === "incapacidad";
      const nueva = await post<IncidenciaReg>(`/asistencia/incidencias${query}`, {
        empleado_id: empleadoId,
        ...form,
        fecha_fin: form.fecha_fin || form.fecha_inicio,
        notas: form.notas || null,
        folio: form.folio || null,
        ramo: incap ? form.ramo : null,
        tipo_incapacidad: incap ? form.tipo_incapacidad : null,
      });
      if (incap && certificado) await subirPut(`/asistencia/incidencias/${nueva.id}/certificado${query}`, "archivo", certificado);
      setAbierto(false);
      setForm(VACIO);
      setCertificado(null);
      cargar();
      onCambio?.();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function borrar(id: string) {
    if (!confirm("¿Eliminar esta incidencia?")) return;
    await api(`/asistencia/incidencias/${id}${query}`, { method: "DELETE" });
    cargar();
    onCambio?.();
  }

  return (
    <div className="space-y-4">
      {vac && (
        <div className="grid grid-cols-3 gap-3 rounded-lg bg-brand-50 p-4 text-center">
          <div>
            <p className="text-2xl font-semibold text-brand-700">{vac.dias_disponibles}</p>
            <p className="text-xs text-slate-600">días disponibles</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-tinta-900">{vac.dias_correspondientes}</p>
            <p className="text-xs text-slate-600">
              le corresponden (<ArticuloLFT art="76" />)
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-tinta-900">{vac.dias_tomados}</p>
            <p className="text-xs text-slate-600">tomados</p>
          </div>
          <p className="col-span-3 text-xs text-slate-600">
            {vac.antiguedad_anios === 0
              ? `Aún no cumple un año. El ${fecha(vac.proximo_aniversario)} tendrá derecho a ${vac.dias_proximo_periodo} días.`
              : `Antigüedad: ${vac.antiguedad_anios} año(s). Periodo ${fecha(vac.periodo_inicio)} – ${fecha(vac.periodo_fin)}. Prima vacacional mínima de 25 % (art. 80).`}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-tinta-900">Incidencias</h4>
        <button type="button" className="text-sm font-medium text-brand-600 hover:underline" onClick={() => setAbierto((v) => !v)}>
          {abierto ? "Cancelar" : "+ Registrar"}
        </button>
      </div>

      {abierto && (
        <form onSubmit={guardar} className="space-y-3 rounded-lg border border-slate-200 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <select className="input" aria-label="Tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
              {Object.entries(INCIDENCIAS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input type="date" className="input" aria-label="Desde" required value={form.fecha_inicio} onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })} />
            <input type="date" className="input" aria-label="Hasta" min={form.fecha_inicio} value={form.fecha_fin} onChange={(e) => setForm({ ...form, fecha_fin: e.target.value })} />
          </div>
          {form.tipo === "incapacidad" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <select className="input" aria-label="Ramo" value={form.ramo} onChange={(e) => setForm({ ...form, ramo: e.target.value })}>
                {Object.entries(RAMOS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select className="input" aria-label="Tipo de incapacidad" value={form.tipo_incapacidad} onChange={(e) => setForm({ ...form, tipo_incapacidad: e.target.value })}>
                {Object.entries(TIPOS_INCAPACIDAD).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input className="input" placeholder="Folio (IMSS)" maxLength={40} value={form.folio} onChange={(e) => setForm({ ...form, folio: e.target.value })} />
              <label className="text-sm text-slate-600 sm:col-span-3">
                Certificado (PDF o foto, opcional):{" "}
                <input type="file" accept="application/pdf,image/*" className="text-sm" onChange={(e) => setCertificado(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          )}
          <input className="input" placeholder="Notas (opcional)" maxLength={1000} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          <ErrorBox message={error} />
          <div className="flex justify-end">
            <button className="btn-primary">Guardar</button>
          </div>
        </form>
      )}

      {!abierto && <ErrorBox message={error} />}
      {lista.length === 0 ? (
        <p className="text-sm text-slate-500">Sin incidencias registradas.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {lista.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2">
              <div>
                <p className="font-medium text-tinta-900">{INCIDENCIAS[i.tipo] ?? i.tipo}</p>
                <p className="text-xs text-slate-500">
                  {i.ramo && `${RAMOS[i.ramo]} · ${TIPOS_INCAPACIDAD[i.tipo_incapacidad ?? "inicial"]} · `}
                  {fecha(i.fecha_inicio)}
                  {i.fecha_fin !== i.fecha_inicio && ` – ${fecha(i.fecha_fin)}`}
                  {i.folio && ` · Folio ${i.folio}`}
                  {i.notas && ` · ${i.notas}`}
                </p>
                {i.tipo === "incapacidad" && (
                  <div className="mt-1 flex gap-3 text-xs">
                    {i.tiene_certificado ? (
                      <button type="button" className="text-brand-600 hover:underline" onClick={() => abrirArchivo(`/asistencia/incidencias/${i.id}/certificado${query}`)}>
                        Ver certificado
                      </button>
                    ) : (
                      <span className="text-amber-700">Sin certificado</span>
                    )}
                    <label className="cursor-pointer text-brand-600 hover:underline">
                      {i.tiene_certificado ? "Cambiar" : "Adjuntar"}
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          try {
                            await subirPut(`/asistencia/incidencias/${i.id}/certificado${query}`, "archivo", f);
                            cargar();
                          } catch (err) {
                            setError((err as Error).message);
                          }
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Eliminar" aria-label="Eliminar" onClick={() => borrar(i.id)}>
                <Icono nombre="trash" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
