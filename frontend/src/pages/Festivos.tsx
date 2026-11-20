import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArticuloLFT } from "../components/LFT";
import Icono from "../components/Iconos";
import Vista, { useVista, type ConfigVista } from "../components/Vista";
import Registro from "../components/Registro";
import { Campos, ErrorBox, Fila, PageHeader } from "../components/ui";
import { api, get, post, type Empleado, type Empresa, type Festivo } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useBanda } from "../lib/bandas";
import { useSoporte } from "../lib/soporte";

const fecha = (iso: string) => new Date(iso + "T12:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

export default function Festivos() {
  const soporte = useSoporte();
  const { usuario: yo } = useAuth();
  const banda = useBanda(yo?.rol === "superadmin" && !soporte ? "odai" : "empresa");
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
  const [pestana, setPestana] = useState<"opcionales" | "obligatorios">("opcionales");

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

  async function crear(e?: FormEvent): Promise<boolean> {
    e?.preventDefault();
    setError(null);
    if (!form.fecha || form.nombre.trim().length < 3) {
      setError("Escribe la fecha y un nombre de al menos 3 letras.");
      return false;
    }
    try {
      await post(`/festivos?${query}`, form);
      setNuevo(false);
      cargar();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
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

  async function guardarDesignados(): Promise<boolean> {
    if (!designar) return false;
    setError(null);
    try {
      await api(`/festivos/designados?${query}`, { method: "PUT", body: JSON.stringify({ fecha: designar.fecha, empleado_ids: [...seleccion] }) });
      setConteo((c) => ({ ...c, [designar.fecha]: seleccion.size }));
      setDesignar(null);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function generar() {
    const r = await post<{ creados: number }>(`/festivos/generar?anio=${anio}`, {});
    setMensaje(r.creados ? `Se agregaron ${r.creados} días al catálogo ${anio}.` : `El catálogo ${anio} ya estaba completo.`);
    cargar();
  }

  const OPCIONALES = nacional ? "Opcionales" : "Opcionales de la empresa";
  const OBLIGATORIOS = "Obligatorios por ley (art. 74)";
  const nuevoDia = () => {
    setError(null);
    setForm({ fecha: `${anio}-01-01`, nombre: "", tipo: nacional ? "obligatorio" : "opcional" });
    setNuevo(true);
  };
  const config: ConfigVista<Festivo> = {
    id: "festivos",
    tituloReporte: `Días festivos ${anio} · ${pestana === "obligatorios" ? OBLIGATORIOS : OPCIONALES}`,
    clave: (f) => f.id,
    onAbrir: (f) => !nacional && f.aplica && abrirDesignar(f),
    fuentes: "arts. 74 y 75; jornada electoral: art. 74, fr. IX",
    vacio: `No hay días festivos para ${anio}.`,
    ordenInicial: { clave: "fecha", dir: "asc" },
    acciones: esAdmin && (
      <button className="btn-primary" onClick={nuevoDia} title={nacional ? "Agregar al catálogo nacional" : "Agregar día de la empresa"}>
        <Icono nombre="calendar-plus" /> Nuevo
      </button>
    ),
    menuAcciones: nacional ? [{ etiqueta: `Cargar catálogo ${anio}`, icono: "download", onClick: generar }] : [],
    columnas: [
      {
        clave: "fecha",
        titulo: "Fecha",
        fija: true,
        valor: (f) => f.fecha,
        render: (f) => <span className="capitalize text-tinta-900">{fecha(f.fecha)}</span>,
      },
      { clave: "nombre", titulo: "Día festivo", buscable: true, valor: (f) => f.nombre, className: "font-medium text-tinta-900" },
      {
        clave: "tipo",
        titulo: "Tipo",
        agrupable: true,
        ordenGrupos: [OPCIONALES, OBLIGATORIOS],
        valor: (f) => (f.tipo === "obligatorio" ? OBLIGATORIOS : OPCIONALES),
        render: (f) =>
          f.tipo === "obligatorio" ? (
            <span className="rounded-full bg-sky-500 px-2 py-0.5 text-xs font-medium text-white">Obligatorio</span>
          ) : (
            <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-medium text-white">Opcional</span>
          ),
      },
      { clave: "origen", titulo: "Origen", agrupable: true, valor: (f) => (f.origen === "empresa" ? "De la empresa" : "Nacional") },
      {
        clave: "aplica",
        titulo: "Aplica",
        agrupable: true,
        valor: (f) => f.aplica,
        render: (f) =>
          f.tipo === "obligatorio" ? (
            <span className="text-xs font-medium text-sky-700">Siempre</span>
          ) : !nacional && f.origen === "nacional" ? (
            <span onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" className="h-4 w-4 accent-brand-500" disabled={!esAdmin} checked={f.aplica} onChange={(e) => aplicar(f, e.target.checked)} aria-label="Aplica en la empresa" />
            </span>
          ) : (
            <span className="text-xs text-slate-500">{f.aplica ? "Sí" : "—"}</span>
          ),
      },
      {
        clave: "personal",
        titulo: "Personal que trabaja",
        alinear: "derecha",
        valor: (f) => conteo[f.fecha] ?? 0,
        render: (f) =>
          !nacional && f.aplica ? (
            <button
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                abrirDesignar(f);
              }}
            >
              <Icono nombre="users" className="h-3.5 w-3.5" /> {conteo[f.fecha] ?? 0}
            </button>
          ) : (
            <span className="text-slate-300">—</span>
          ),
      },
    ],
    eliminar: { puede: (f) => f.editable, borrar: (f) => api(`/festivos/${f.id}`, { method: "DELETE" }), despues: cargar },
    filtros: [
      { clave: "aplican", titulo: "Aplican en la empresa", grupo: "aplica", prueba: (f) => f.aplica },
      { clave: "no_aplican", titulo: "No aplican", grupo: "aplica", prueba: (f) => !f.aplica },
      { clave: "propios", titulo: "De la empresa", grupo: "origen", prueba: (f) => f.origen === "empresa" },
      { clave: "proximos", titulo: "Próximos", grupo: "fecha", prueba: (f) => f.fecha >= new Date().toLocaleDateString("en-CA") },
    ],
  };
  const vista = useVista(
    config,
    (lista ?? []).filter((f) => (pestana === "obligatorios" ? f.tipo === "obligatorio" : f.tipo !== "obligatorio")),
  );

  return (
    <>
      <PageHeader
        icono="calendar-heart"
        title="Días festivos"
        submenu={banda}
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
          </div>
        }
      />

      {mensaje && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>}
      <ErrorBox message={!nuevo ? error : null} />

      <div className="oculto-con-registro mb-3 inline-flex rounded-lg bg-slate-100 p-1 text-sm" role="tablist">
        {(
          [
            ["opcionales", OPCIONALES],
            ["obligatorios", OBLIGATORIOS],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={pestana === k}
            onClick={() => setPestana(k)}
            className={`rounded-md px-3 py-1.5 font-medium ${pestana === k ? "bg-white text-tinta-900 shadow-sm" : "text-slate-600 hover:text-tinta-900"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <Vista vista={vista} />
      <p className="oculto-con-registro mt-3 text-xs text-slate-500">
        Obligatorios: se descansan con goce de salario y solo checa el personal designado; si se trabajan se paga salario doble además del del día (<ArticuloLFT art="75" />), más prima dominical si cae en domingo (
        <ArticuloLFT art="71" />).
      </p>

      {designar && (
        <Registro
          flotante
          titulo={`Personal que trabaja · ${designar.nombre}`}
          subtitulo={<span className="capitalize">{fecha(designar.fecha)}</span>}
          sucio
          autoguardar={false}
          imprimir={false}
          onGuardar={guardarDesignados}
          onCerrar={() => setDesignar(null)}
          nota="Solo las personas marcadas podrán registrar entrada ese día."
        >
          <div className="space-y-4">
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
                    <span className="text-tinta-900">{e.nombre_completo}</span>
                    <span className="ml-auto font-mono text-xs text-brand-600">{e.sucursal.clave}</span>
                  </label>
                ))}
              {empleados.length === 0 && <p className="px-2 py-1 text-sm text-slate-500">No hay empleados activos.</p>}
            </div>
            <p className="text-xs text-slate-500">{seleccion.size} persona(s) designada(s).</p>
            <ErrorBox message={error} />
          </div>
        </Registro>
      )}

      {nuevo && (
        <Registro
          flotante
          titulo={nacional ? "Agregar al catálogo nacional" : "Agregar día de la empresa"}
          sucio
          autoguardar={false}
          imprimir={false}
          onGuardar={() => crear()}
          onCerrar={() => setNuevo(false)}
        >
          <form onSubmit={crear} className="space-y-4">
            <Campos>
              <Fila etiqueta="Fecha" htmlFor="fes-fecha">
                <input id="fes-fecha" type="date" className="input" required value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
              </Fila>
              <Fila etiqueta="Nombre" htmlFor="fes-nombre">
                <input id="fes-nombre" className="input" required minLength={3} maxLength={120} placeholder={nacional ? "Jornada electoral federal" : "Aniversario de la empresa"} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              </Fila>
              {nacional && (
                <Fila etiqueta="Tipo" htmlFor="fes-tipo">
                  <select id="fes-tipo" className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                    <option value="obligatorio">Obligatorio (art. 74)</option>
                    <option value="opcional">Opcional</option>
                  </select>
                </Fila>
              )}
            </Campos>
            <ErrorBox message={error} />
          </form>
        </Registro>
      )}
    </>
  );
}
