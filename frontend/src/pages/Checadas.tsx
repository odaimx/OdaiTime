import { useCallback, useEffect, useState, type FormEvent } from "react";
import Bitacora from "../components/Bitacora";
import FotoChecada from "../components/FotoChecada";
import { Badge, ErrorBox, Modal, PageHeader, useEmpresaScope } from "../components/ui";
import { fechaHora, get, hoyISO, ORIGENES, patch, post, type Checada, type Empleado, type Sucursal } from "../lib/api";

const haceDias = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA");
};

const localInput = (iso: string) => {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export default function Checadas() {
  const { query, listo, selector } = useEmpresaScope();
  const sep = query ? "&" : "?";
  const [filtros, setFiltros] = useState({ desde: haceDias(6), hasta: hoyISO(), sucursal_id: "", anuladas: false });
  const [checadas, setChecadas] = useState<Checada[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [sel, setSel] = useState<Checada | null>(null);
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ empleado_id: "", tipo: "entrada", momento: "", motivo: "" });
  const [corr, setCorr] = useState({ tipo: "", momento: "", estado: "", motivo: "" });
  const [rev, setRev] = useState(0);

  const cargar = useCallback(() => {
    if (!listo) return;
    const p = new URLSearchParams({ desde: filtros.desde, hasta: filtros.hasta, incluir_anuladas: String(filtros.anuladas) });
    if (filtros.sucursal_id) p.set("sucursal_id", filtros.sucursal_id);
    get<Checada[]>(`/checadas${query}${sep}${p}`).then(setChecadas).catch((e) => setError(e.message));
  }, [listo, query, sep, filtros]);
  useEffect(cargar, [cargar]);

  useEffect(() => {
    if (!listo) return;
    get<Sucursal[]>(`/sucursales${query}`).then(setSucursales);
    get<Empleado[]>(`/empleados${query}`).then(setEmpleados);
  }, [listo, query]);

  function abrir(c: Checada) {
    setError(null);
    setCorr({ tipo: c.tipo, momento: localInput(c.momento), estado: c.estado, motivo: "" });
    setSel(c);
  }

  async function corregir(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    setError(null);
    try {
      const cambios: Record<string, string> = { motivo: corr.motivo };
      if (corr.tipo !== sel.tipo) cambios.tipo = corr.tipo;
      if (corr.momento !== localInput(sel.momento)) cambios.momento = new Date(corr.momento).toISOString();
      if (corr.estado !== sel.estado) cambios.estado = corr.estado;
      const r = await patch<Checada>(`/checadas/${sel.id}${query}`, cambios);
      setSel(r);
      setCorr((x) => ({ ...x, motivo: "" }));
      setRev((n) => n + 1);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function crearManual(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await post(`/checadas/manual${query}`, { ...form, momento: new Date(form.momento).toISOString() });
      setManual(false);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Checadas"
        subtitle="Registros de entrada y salida de todas las sucursales"
        action={
          <div className="flex flex-col gap-3 sm:flex-row">
            {selector}
            {listo && (
              <button
                className="btn-primary"
                onClick={() => {
                  setError(null);
                  setForm({ empleado_id: "", tipo: "entrada", momento: localInput(new Date().toISOString()), motivo: "" });
                  setManual(true);
                }}
              >
                Registrar checada manual
              </button>
            )}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-[10rem_10rem_14rem_auto]">
        <label className="text-xs font-medium text-slate-500">
          Desde
          <input type="date" className="input mt-1" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Hasta
          <input type="date" className="input mt-1" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
        </label>
        <label className="col-span-2 text-xs font-medium text-slate-500 sm:col-span-1">
          Sucursal
          <select className="input mt-1" value={filtros.sucursal_id} onChange={(e) => setFiltros({ ...filtros, sucursal_id: e.target.value })}>
            <option value="">Todas</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.clave} — {s.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex items-end gap-2 pb-2 text-sm text-slate-600 sm:col-span-1">
          <input type="checkbox" className="accent-brand-500" checked={filtros.anuladas} onChange={(e) => setFiltros({ ...filtros, anuladas: e.target.checked })} />
          Incluir anuladas
        </label>
      </div>

      <ErrorBox message={!sel && !manual ? error : null} />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Empleado</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Fecha y hora</th>
              <th className="hidden px-4 py-3 md:table-cell">Origen</th>
              <th className="hidden px-4 py-3 sm:table-cell">Sucursal</th>
              <th className="px-4 py-3">Observaciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {checadas.map((c) => (
              <tr key={c.id} onClick={() => abrir(c)} className={`cursor-pointer hover:bg-brand-50/50 ${c.estado === "anulada" ? "opacity-50" : ""}`}>
                <td className="px-4 py-3">
                  <p className="font-medium text-navy-900">{c.empleado.nombre_completo}</p>
                  <p className="font-mono text-xs text-slate-500">#{c.empleado.numero}</p>
                </td>
                <td className="px-4 py-3 capitalize">{c.tipo}</td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{fechaHora(c.momento)}</td>
                <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{ORIGENES[c.origen]}</td>
                <td className="hidden px-4 py-3 sm:table-cell">
                  <span className="font-mono text-xs font-semibold text-brand-600">{c.sucursal.clave}</span>
                </td>
                <td className="space-x-1 px-4 py-3">
                  {c.retardo_minutos ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Retardo {c.retardo_minutos} min</span> : null}
                  {c.offline && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Sin conexión</span>}
                  {c.corregida && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">Corregida</span>}
                  {c.estado === "anulada" && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">Anulada</span>}
                </td>
              </tr>
            ))}
            {checadas.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No hay checadas en ese periodo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">{checadas.length} registro(s)</p>

      {manual && (
        <Modal title="Registrar checada manual" onClose={() => setManual(false)}>
          <form onSubmit={crearManual} className="space-y-4">
            <div>
              <label className="label">Empleado</label>
              <select className="input" required value={form.empleado_id} onChange={(e) => setForm({ ...form, empleado_id: e.target.value })}>
                <option value="">Selecciona…</option>
                {empleados.map((e) => (
                  <option key={e.id} value={e.id}>
                    #{e.numero} — {e.nombre_completo}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Tipo</label>
                <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                  <option value="entrada">Entrada</option>
                  <option value="salida">Salida</option>
                </select>
              </div>
              <div>
                <label className="label">Fecha y hora</label>
                <input type="datetime-local" className="input" required value={form.momento} onChange={(e) => setForm({ ...form, momento: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">Motivo</label>
              <input className="input" required minLength={3} placeholder="Olvidó checar, falla del kiosco…" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} />
            </div>
            <p className="text-xs text-slate-500">Queda registrada en el historial con tu nombre y el motivo.</p>
            <ErrorBox message={error} />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setManual(false)}>
                Cancelar
              </button>
              <button className="btn-primary">Registrar</button>
            </div>
          </form>
        </Modal>
      )}

      {sel && (
        <Modal title={`${sel.tipo === "entrada" ? "Entrada" : "Salida"} · ${sel.empleado.nombre_completo}`} onClose={() => setSel(null)} ancho="lg">
          <div className="space-y-5">
            <div className="flex flex-wrap gap-4">
              {sel.tiene_foto && <FotoChecada checadaId={sel.id} query={query} className="h-40 w-32" />}
              <dl className="grid flex-1 grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Fecha y hora</dt>
                  <dd className="font-medium text-navy-900">{fechaHora(sel.momento)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Origen</dt>
                  <dd className="font-medium text-navy-900">{ORIGENES[sel.origen]}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Sucursal</dt>
                  <dd className="font-medium text-navy-900">
                    {sel.sucursal.clave} — {sel.sucursal.nombre}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Distancia</dt>
                  <dd className="font-medium text-navy-900">{sel.distancia_m != null ? `${sel.distancia_m} m` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Estado</dt>
                  <dd>
                    <Badge ok={sel.estado === "valida"}>{sel.estado === "valida" ? "Válida" : "Anulada"}</Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Retardo</dt>
                  <dd className="font-medium text-navy-900">{sel.retardo_minutos ? `${sel.retardo_minutos} min` : "—"}</dd>
                </div>
              </dl>
            </div>

            <form onSubmit={corregir} className="space-y-3 rounded-lg bg-slate-50 p-4">
              <p className="text-sm font-medium text-navy-900">Corregir</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <select className="input" aria-label="Tipo" value={corr.tipo} onChange={(e) => setCorr({ ...corr, tipo: e.target.value })}>
                  <option value="entrada">Entrada</option>
                  <option value="salida">Salida</option>
                </select>
                <input type="datetime-local" className="input" aria-label="Fecha y hora" value={corr.momento} onChange={(e) => setCorr({ ...corr, momento: e.target.value })} />
                <select className="input" aria-label="Estado" value={corr.estado} onChange={(e) => setCorr({ ...corr, estado: e.target.value })}>
                  <option value="valida">Válida</option>
                  <option value="anulada">Anulada</option>
                </select>
              </div>
              <input className="input" required minLength={3} placeholder="Motivo de la corrección (obligatorio)" value={corr.motivo} onChange={(e) => setCorr({ ...corr, motivo: e.target.value })} />
              <ErrorBox message={error} />
              <div className="flex justify-end">
                <button className="btn-primary">Guardar corrección</button>
              </div>
            </form>

            <div>
              <h3 className="mb-3 text-sm font-medium text-navy-900">Historial</h3>
              <Bitacora modelo="checada" registroId={sel.id} query={query} recargar={rev} />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
