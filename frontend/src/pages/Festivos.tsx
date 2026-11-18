import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArticuloLFT } from "../components/LFT";
import { ErrorBox, Modal, PageHeader } from "../components/ui";
import { api, get, post, type Empleado, type Empresa, type Festivo } from "../lib/api";
import { useAuth } from "../lib/auth";

const fecha = (iso: string) => new Date(iso + "T12:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

export default function Festivos() {
  const { usuario } = useAuth();
  const esSuper = usuario?.rol === "superadmin";
  const esAdmin = esSuper || usuario?.rol === "admin_empresa";
  const [anio, setAnio] = useState(new Date().getFullYear());
  // Superadmin: "" = catálogo nacional; o una empresa para ver su selección.
  const [empresaId, setEmpresaId] = useState("");
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [lista, setLista] = useState<Festivo[] | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState({ fecha: "", nombre: "", tipo: "opcional" });
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [designar, setDesignar] = useState<Festivo | null>(null);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [buscar, setBuscar] = useState("");
  const [conteo, setConteo] = useState<Record<string, number>>({});

  const query = esSuper && empresaId ? `empresa_id=${empresaId}&` : "";
  const nacional = esSuper && !empresaId;

  const cargar = useCallback(() => {
    get<Festivo[]>(`/festivos?${query}anio=${anio}`).then(setLista).catch((e) => setError(e.message));
  }, [query, anio]);
  useEffect(cargar, [cargar]);

  useEffect(() => {
    if (esSuper) get<Empresa[]>("/empresas").then(setEmpresas);
  }, [esSuper]);

  async function aplicar(f: Festivo, aplica: boolean) {
    await api(`/festivos/${f.id}/aplicar?${query}`, { method: "PUT", body: JSON.stringify({ aplica }) });
    cargar();
  }

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await post(`/festivos?${query}`, form);
      setNuevo(false);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function borrar(f: Festivo) {
    if (!confirm(`¿Eliminar “${f.nombre}”?`)) return;
    await api(`/festivos/${f.id}`, { method: "DELETE" });
    cargar();
  }

  // Cuántos designados tiene cada festivo que aplica (para mostrarlo en la lista).
  useEffect(() => {
    if (nacional || !lista) return;
    const aplican = lista.filter((f) => f.aplica);
    Promise.all(aplican.map((f) => get<{ empleado_ids: string[] }>(`/festivos/designados?${query}fecha=${f.fecha}`).then((r) => [f.fecha, r.empleado_ids.length] as const)))
      .then((pares) => setConteo(Object.fromEntries(pares)))
      .catch(() => {});
  }, [lista, nacional, query]);

  async function abrirDesignar(f: Festivo) {
    setError(null);
    setBuscar("");
    const [emps, des] = await Promise.all([
      get<Empleado[]>(`/empleados${esSuper ? `?empresa_id=${empresaId}` : ""}`),
      get<{ empleado_ids: string[] }>(`/festivos/designados?${query}fecha=${f.fecha}`),
    ]);
    setEmpleados(emps);
    setSeleccion(new Set(des.empleado_ids));
    setDesignar(f);
  }

  async function guardarDesignados() {
    if (!designar) return;
    setError(null);
    try {
      await api(`/festivos/designados?${query}`, { method: "PUT", body: JSON.stringify({ fecha: designar.fecha, empleado_ids: [...seleccion] }) });
      setConteo((c) => ({ ...c, [designar.fecha]: seleccion.size }));
      setDesignar(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function generar() {
    const r = await post<{ creados: number }>(`/festivos/generar?anio=${anio}`, {});
    setMensaje(r.creados ? `Se agregaron ${r.creados} días al catálogo ${anio}.` : `El catálogo ${anio} ya estaba completo.`);
    cargar();
  }

  const obligatorios = lista?.filter((f) => f.tipo === "obligatorio") ?? [];
  const otros = lista?.filter((f) => f.tipo !== "obligatorio") ?? [];

  return (
    <>
      <PageHeader fuentes="arts. 74 y 75; jornada electoral: art. 74, fr. IX"
        title="Días festivos"
        subtitle={
          nacional
            ? "Catálogo nacional que ven todas las empresas. Aquí se actualiza cuando cambia la ley o se publica una jornada electoral."
            : "Los obligatorios por ley aplican siempre. Elige qué días opcionales otorga tu empresa y agrega los propios."
        }
        action={
          <div className="flex flex-col gap-3 sm:flex-row">
            {esSuper && (
              <select className="input w-full sm:w-64" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                <option value="">Catálogo nacional (Odai)</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            )}
            <select className="input w-28" aria-label="Año" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
              {[-1, 0, 1, 2].map((d) => {
                const a = new Date().getFullYear() + d;
                return (
                  <option key={a} value={a}>
                    {a}
                  </option>
                );
              })}
            </select>
            {nacional && (
              <button className="btn-secondary" onClick={generar}>
                Cargar año {anio}
              </button>
            )}
            {esAdmin && (
              <button
                className="btn-primary"
                onClick={() => {
                  setError(null);
                  setForm({ fecha: `${anio}-01-01`, nombre: "", tipo: nacional ? "obligatorio" : "opcional" });
                  setNuevo(true);
                }}
              >
                {nacional ? "Agregar al catálogo" : "Agregar día de la empresa"}
              </button>
            )}
          </div>
        }
      />

      {mensaje && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>}
      <ErrorBox message={!nuevo ? error : null} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-semibold text-navy-900">
            Descanso obligatorio <span className="text-sm font-normal text-slate-500">(<ArticuloLFT art="74" />)</span>
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Se descansan con goce de salario. Ese día <strong>solo pueden checar las personas que la empresa designe</strong> para trabajar; a ellas se les paga <strong>salario doble además del salario del día</strong> (<ArticuloLFT art="75" />) y, si cae en domingo, también prima dominical (<ArticuloLFT art="71" />).
          </p>
          <ul className="mt-4 divide-y divide-slate-100">
            {obligatorios.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="font-medium text-navy-900">{f.nombre}</p>
                  <p className="text-xs capitalize text-slate-500">{fecha(f.fecha)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">Siempre aplica</span>
                  {!nacional && f.aplica && (
                    <button className="whitespace-nowrap text-xs font-medium text-brand-600 hover:underline" onClick={() => abrirDesignar(f)}>
                      Personal que trabaja ({conteo[f.fecha] ?? 0})
                    </button>
                  )}
                  {f.editable && (
                    <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => borrar(f)}>
                      Eliminar
                    </button>
                  )}
                </div>
              </li>
            ))}
            {lista && obligatorios.length === 0 && <li className="py-3 text-sm text-slate-500">Se calculan con el art. 74 (aún no hay catálogo cargado para {anio}).</li>}
          </ul>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold text-navy-900">Opcionales y de la empresa</h2>
          <p className="mt-1 text-sm text-slate-500">
            La ley no los obliga. {nacional ? "Cada empresa decide cuáles otorga." : "Marca los que tu empresa otorga; el pago si se trabajan se define en Config. asistencias."}
          </p>
          <ul className="mt-4 divide-y divide-slate-100">
            {otros.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <label className={`flex flex-1 items-center gap-3 ${!nacional && f.origen === "nacional" && esAdmin ? "cursor-pointer" : ""}`}>
                  {!nacional && f.origen === "nacional" && (
                    <input type="checkbox" className="h-4 w-4 accent-brand-500" disabled={!esAdmin} checked={f.aplica} onChange={(e) => aplicar(f, e.target.checked)} />
                  )}
                  <span>
                    <span className="block font-medium text-navy-900">{f.nombre}</span>
                    <span className="block text-xs capitalize text-slate-500">{fecha(f.fecha)}</span>
                  </span>
                </label>
                <div className="flex items-center gap-3">
                  {f.origen === "empresa" && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">De la empresa</span>}
                  {!nacional && f.aplica && (
                    <button className="whitespace-nowrap text-xs font-medium text-brand-600 hover:underline" onClick={() => abrirDesignar(f)}>
                      Personal que trabaja ({conteo[f.fecha] ?? 0})
                    </button>
                  )}
                  {f.editable && (
                    <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => borrar(f)}>
                      Eliminar
                    </button>
                  )}
                </div>
              </li>
            ))}
            {lista && otros.length === 0 && <li className="py-3 text-sm text-slate-500">Sin días opcionales para {anio}.</li>}
          </ul>
        </section>
      </div>

      {designar && (
        <Modal title={`Personal que trabaja · ${designar.nombre}`} onClose={() => setDesignar(null)} ancho="md">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              <span className="capitalize">{fecha(designar.fecha)}</span>. Solo las personas marcadas podrán registrar entrada ese día.
            </p>
            <input className="input" placeholder="Buscar empleado…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {empleados
                .filter((e) => e.nombre_completo.toLowerCase().includes(buscar.toLowerCase()) || e.numero.includes(buscar))
                .map((e) => (
                  <label key={e.id} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="accent-brand-500"
                      checked={seleccion.has(e.id)}
                      onChange={() =>
                        setSeleccion((s) => {
                          const n = new Set(s);
                          if (n.has(e.id)) n.delete(e.id);
                          else n.add(e.id);
                          return n;
                        })
                      }
                    />
                    <span className="font-mono text-xs text-slate-500">#{e.numero}</span>
                    <span className="text-navy-900">{e.nombre_completo}</span>
                    <span className="ml-auto font-mono text-xs text-brand-600">{e.sucursal.clave}</span>
                  </label>
                ))}
              {empleados.length === 0 && <p className="px-2 py-1 text-sm text-slate-500">No hay empleados activos.</p>}
            </div>
            <p className="text-xs text-slate-500">{seleccion.size} persona(s) designada(s).</p>
            <ErrorBox message={error} />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setDesignar(null)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={guardarDesignados}>
                Guardar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {nuevo && (
        <Modal title={nacional ? "Agregar al catálogo nacional" : "Agregar día de la empresa"} onClose={() => setNuevo(false)} ancho="md">
          <form onSubmit={crear} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Fecha</label>
                <input type="date" className="input" required value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
              </div>
              {nacional && (
                <div>
                  <label className="label">Tipo</label>
                  <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                    <option value="obligatorio">Obligatorio (art. 74)</option>
                    <option value="opcional">Opcional</option>
                  </select>
                </div>
              )}
            </div>
            <div>
              <label className="label">Nombre</label>
              <input className="input" required minLength={3} maxLength={120} placeholder={nacional ? "Jornada electoral federal" : "Aniversario de la empresa"} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <ErrorBox message={error} />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setNuevo(false)}>
                Cancelar
              </button>
              <button className="btn-primary">Agregar</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
