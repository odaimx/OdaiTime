import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import Bitacora from "../components/Bitacora";
import FiltrosExportacion, { filtrosIniciales, paramsDe, type Filtros } from "../components/FiltrosExportacion";
import Registro, { useFormulario } from "../components/Registro";
import Icono from "../components/Iconos";
import Vista, { useAbrirDesdeUrl, useVista, type ConfigVista } from "../components/Vista";
import { imprimirSecciones } from "../lib/imprimir";
import { Ayuda, Badge, Campos, CamposDomicilio, CamposUbicacion, DOMICILIO_VACIO, domicilioApi, domicilioDe, ErrorBox, Fila, PageHeader, Plegable, useEmpresaScope, type Domicilio } from "../components/ui";
import { api, descargar, fechaCorta, get, patch, post, type AsignacionObra, type Empleado, type Obra, type Sucursal } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useBanda } from "../lib/bandas";
import { periodo } from "../lib/periodo";

type Form = {
  clave: string;
  nombre: string;
  sucursal_id: string;
  domicilio: Domicilio;
  latitud: string;
  longitud: string;
  radio_metros: string;
  fecha_inicio: string;
  fecha_fin: string;
};

const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const VACIO: Form = { clave: "", nombre: "", sucursal_id: "", domicilio: DOMICILIO_VACIO, latitud: "", longitud: "", radio_metros: "150", fecha_inicio: hoyIso(), fecha_fin: "" };

const aForm = (o: Obra): Form => ({
  clave: o.clave,
  nombre: o.nombre,
  sucursal_id: o.sucursal_id,
  domicilio: domicilioDe(o),
  latitud: o.latitud?.toString() ?? "",
  longitud: o.longitud?.toString() ?? "",
  radio_metros: String(o.radio_metros),
  fecha_inicio: o.fecha_inicio,
  fecha_fin: o.fecha_fin ?? "",
});

const vigencia = (o: Obra) => `${fechaCorta(o.fecha_inicio)} – ${o.fecha_fin ? fechaCorta(o.fecha_fin) : "sin fin"}`;
const terminada = (o: Obra) => !!o.fecha_fin && o.fecha_fin < hoyIso();

export default function Obras() {
  const banda = useBanda("empresa");
  const { usuario } = useAuth();
  const puedeEditar = !!usuario && ["superadmin", "admin_empresa", "gerente_sucursal"].includes(usuario.rol);
  const { query, listo, selector } = useEmpresaScope();
  const [obras, setObras] = useState<Obra[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [editando, setEditando] = useState<Obra | "nueva" | null>(null);
  const { form, setForm, cargar: cargarForm, sucio, descartar } = useFormulario<Form>(VACIO);
  const [error, setError] = useState<string | null>(null);
  const [reporte, setReporte] = useState(false);

  const cargar = useCallback(() => {
    if (!listo) return;
    get<Obra[]>(`/obras${query}`).then(setObras);
    get<Sucursal[]>(`/sucursales${query}`).then((s) => setSucursales(s.filter((x) => x.activa)));
  }, [query, listo]);
  useEffect(cargar, [cargar]);

  function abrir(o: Obra | "nueva") {
    setError(null);
    cargarForm(o === "nueva" ? { ...VACIO, sucursal_id: sucursales[0]?.id ?? "" } : aForm(o));
    setEditando(o);
  }

  async function guardar(): Promise<boolean> {
    setError(null);
    const datos = {
      clave: form.clave.trim().toUpperCase(),
      nombre: form.nombre,
      sucursal_id: form.sucursal_id,
      ...domicilioApi(form.domicilio),
      latitud: form.latitud ? Number(form.latitud) : null,
      longitud: form.longitud ? Number(form.longitud) : null,
      radio_metros: Number(form.radio_metros) || 150,
      fecha_inicio: form.fecha_inicio,
      fecha_fin: form.fecha_fin || null,
    };
    try {
      const r = editando === "nueva" ? await post<Obra>(`/obras${query}`, datos) : await patch<Obra>(`/obras/${(editando as Obra).id}${query}`, datos);
      cargarForm(aForm(r));
      setEditando(r);
      setObras((lista) => (lista.some((x) => x.id === r.id) ? lista.map((x) => (x.id === r.id ? r : x)) : [...lista, r]));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function alternar(o: Obra) {
    const r = await patch<Obra>(`/obras/${o.id}${query}`, { activa: !o.activa });
    setEditando(r);
    cargar();
  }

  const config: ConfigVista<Obra> = {
    id: "obras",
    tituloReporte: "Otras zonas",
    clave: (o) => o.id,
    eliminar: puedeEditar ? { borrar: (o) => api(`/obras/${o.id}${query}`, { method: "DELETE" }), despues: cargar } : undefined,
    onAbrir: abrir,
    acciones: listo && (
      <>
        {puedeEditar && (
          <button className="btn-primary" onClick={() => abrir("nueva")} disabled={!sucursales.length} title={sucursales.length ? undefined : "Primero da de alta una sucursal"}>
            <Icono nombre="map-pin-plus" /> Nuevo
          </button>
        )}
        <button className="btn-secondary" onClick={() => setReporte(true)}>
          <Icono nombre="file-chart-column" /> Horas por zona
        </button>
      </>
    ),
    actividades: { modelo: "obra", query, listo },
    vacio: "Aún no hay zonas. Crea una (obra, punto de venta, evento…) para asignar empleados y validar su checada en ese lugar.",
    ordenInicial: { clave: "clave", dir: "asc" },
    columnas: [
      { clave: "clave", titulo: "Clave", fija: true, buscable: true, enlace: true, valor: (o) => o.clave, render: (o) => <span className="font-mono text-xs font-semibold text-brand-600">{o.clave}</span> },
      {
        enlace: true,
        clave: "nombre",
        titulo: "Nombre",
        buscable: true,
        valor: (o) => o.nombre,
        render: (o) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-tinta-900">{o.nombre}</p>
            {o.direccion && <p className="truncate text-xs text-slate-500">{o.direccion}</p>}
          </div>
        ),
      },
      { clave: "sucursal", titulo: "Sucursal", agrupable: true, buscable: true, valor: (o) => `${o.sucursal.clave} · ${o.sucursal.nombre}` },
      { clave: "vigencia", titulo: "Vigencia", valor: (o) => o.fecha_inicio, render: vigencia },
      { clave: "asignados", titulo: "Empleados hoy", valor: (o) => o.empleados_asignados, render: (o) => <span className="tabular-nums">{o.empleados_asignados}</span> },
      {
        clave: "geocerca",
        titulo: "Geocerca",
        agrupable: true,
        valor: (o) => (o.latitud != null && o.longitud != null ? `${o.radio_metros} m` : "Sin ubicación"),
        render: (o) => (o.latitud != null && o.longitud != null ? `${o.radio_metros} m` : <span className="text-slate-400">Sin ubicación</span>),
      },
      {
        clave: "estado",
        titulo: "Estado",
        agrupable: true,
        valor: (o) => (!o.activa ? "Inactiva" : terminada(o) ? "Terminada" : "Activa"),
        render: (o) => <Badge ok={o.activa && !terminada(o)}>{!o.activa ? "Inactiva" : terminada(o) ? "Terminada" : "Activa"}</Badge>,
      },
    ],
    filtros: [
      { clave: "sin_ubicacion", titulo: "Sin ubicación (geocerca)", grupo: "datos", prueba: (o) => o.latitud == null || o.longitud == null },
      { clave: "activas", titulo: "Activas", grupo: "estado", prueba: (o) => o.activa && !terminada(o) },
      { clave: "terminadas", titulo: "Terminadas", grupo: "estado", prueba: (o) => terminada(o) },
      { clave: "inactivas", titulo: "Inactivas", grupo: "estado", prueba: (o) => !o.activa },
    ],
    filtrosIniciales: ["activas"],
    kanban: (o) => (
      <div className="space-y-1 pr-6">
        <div className="flex items-center gap-2">
          <span className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-brand-700">{o.clave}</span>
          <p className="truncate font-semibold text-tinta-900">{o.nombre}</p>
        </div>
        <p className="truncate text-xs text-slate-500">{o.sucursal.clave} · {o.sucursal.nombre}</p>
        <p className="text-xs text-slate-600">{vigencia(o)}</p>
        <div className="flex gap-1 pt-1">
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">{o.empleados_asignados} empleado(s) hoy</span>
          {o.latitud == null || o.longitud == null ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Sin ubicación</span> : null}
        </div>
      </div>
    ),
  };
  const vista = useVista(config, obras);
  useAbrirDesdeUrl(obras, (x) => x.id, abrir);
  const enOrden = vista.ordenados;
  const indice = editando && editando !== "nueva" ? enOrden.findIndex((x) => x.id === editando.id) : -1;

  const set = (k: keyof Form) => (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: ev.target.value });

  return (
    <>
      <PageHeader submenu={banda} icono="map-pin" title="Otras zonas" action={selector} />
      <Vista vista={vista} />
      {reporte && <ReporteObras obras={obras} query={query} onCerrar={() => setReporte(false)} />}

      {editando && (
        <Registro
          titulo={editando === "nueva" ? "Nueva zona" : `${editando.clave} · ${editando.nombre}`}
          onImprimir={
            editando === "nueva"
              ? undefined
              : () =>
                  imprimirSecciones(`Zona · ${editando.clave} ${editando.nombre}`, [
                    {
                      campos: [
                        ["Clave", editando.clave],
                        ["Nombre", editando.nombre],
                        ["Sucursal", `${editando.sucursal.clave} · ${editando.sucursal.nombre}`],
                        ["Dirección", editando.direccion],
                        ["Vigencia", vigencia(editando)],
                        ["Latitud", editando.latitud],
                        ["Longitud", editando.longitud],
                        ["Radio para checar", `${editando.radio_metros} m`],
                        ["Empleados asignados hoy", editando.empleados_asignados],
                        ["Estado", editando.activa ? "Activa" : "Inactiva"],
                      ],
                    },
                  ])
          }
          indice={indice >= 0 ? indice : undefined}
          total={enOrden.length}
          onIr={(i) => abrir(enOrden[i])}
          sucio={puedeEditar && sucio}
          onGuardar={puedeEditar ? guardar : undefined}
          onDescartar={descartar}
          onCerrar={() => setEditando(null)}
          ancho="lg"
        >
          <form onSubmit={(e: FormEvent) => (e.preventDefault(), guardar())} className="space-y-4">
            <fieldset disabled={!puedeEditar}>
              <Campos>
                <Fila etiqueta="Clave" htmlFor="ob-clave">
                  <input id="ob-clave" className="input uppercase" required maxLength={20} pattern="[A-Za-z0-9_\-]+" title="Letras, números, guion o guion bajo" value={form.clave} onChange={set("clave")} />
                </Fila>
                <Fila etiqueta="Nombre" htmlFor="ob-nombre">
                  <input id="ob-nombre" className="input" required value={form.nombre} onChange={set("nombre")} />
                </Fila>
                <Fila etiqueta="Sucursal" htmlFor="ob-suc" ayuda="La zona usa la zona horaria, el turno y la configuración de checadas de esta sucursal.">
                  <select id="ob-suc" className="input" required value={form.sucursal_id} onChange={set("sucursal_id")}>
                    {sucursales.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.clave} · {s.nombre}
                      </option>
                    ))}
                  </select>
                </Fila>
                <div className="hidden md:block" />
                <Fila etiqueta="Inicio" htmlFor="ob-ini">
                  <input id="ob-ini" className="input" type="date" required value={form.fecha_inicio} onChange={set("fecha_inicio")} />
                </Fila>
                <Fila etiqueta="Fin" htmlFor="ob-fin" ayuda="Déjalo vacío si aún no tiene fecha de término. Después del fin, ya no se valida la checada en esta zona.">
                  <input id="ob-fin" className="input" type="date" min={form.fecha_inicio} value={form.fecha_fin} onChange={set("fecha_fin")} />
                </Fila>
                <CamposDomicilio prefijo="ob" valor={form.domicilio} onCambio={(domicilio) => setForm({ ...form, domicilio })} />
                <CamposUbicacion
                  lugar="la zona"
                  latitud={form.latitud}
                  longitud={form.longitud}
                  radio={form.radio_metros}
                  domicilio={form.domicilio}
                  deshabilitado={!puedeEditar}
                  onCambio={(c) => setForm({ ...form, ...c })}
                />
              </Campos>
            </fieldset>

            {editando !== "nueva" && <Asignaciones obra={editando} query={query} puedeEditar={puedeEditar} onCambio={cargar} />}

            {editando !== "nueva" && puedeEditar && (
              <div className="flex justify-end">
                <button type="button" className="text-sm text-slate-500 hover:text-tinta-900 hover:underline" onClick={() => alternar(editando)}>
                  {editando.activa ? "Desactivar zona" : "Activar zona"}
                </button>
              </div>
            )}
            {editando !== "nueva" && (
              <Plegable titulo="Historial de cambios">
                <Bitacora modelo="obra" registroId={editando.id} query={query} />
              </Plegable>
            )}
            <ErrorBox message={error} />
            <button type="submit" className="sr-only">
              Guardar
            </button>
          </form>
        </Registro>
      )}
    </>
  );
}

/** Empleados asignados a la obra: alta en grupo con fechas, terminar y quitar. */
function Asignaciones({ obra, query, puedeEditar, onCambio }: { obra: Obra; query: string; puedeEditar: boolean; onCambio: () => void }) {
  const [lista, setLista] = useState<AsignacionObra[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [agregando, setAgregando] = useState(false);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [inicio, setInicio] = useState(() => (obra.fecha_inicio > hoyIso() ? obra.fecha_inicio : hoyIso()));
  const [fin, setFin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);

  const cargar = useCallback(() => {
    get<AsignacionObra[]>(`/obras/${obra.id}/asignaciones${query}`).then(setLista);
  }, [obra.id, query]);
  useEffect(cargar, [cargar]);
  useEffect(() => {
    if (agregando && !empleados.length) get<Empleado[]>(`/empleados${query}`).then((e) => setEmpleados(e.filter((x) => x.activo)));
  }, [agregando, empleados.length, query]);

  const hoy = hoyIso();
  const vigente = (a: AsignacionObra) => a.fecha_inicio <= hoy && (!a.fecha_fin || a.fecha_fin >= hoy);
  const visibles = verTodas ? lista : lista.filter((a) => !a.fecha_fin || a.fecha_fin >= hoy);
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return empleados.filter((e) => !t || e.nombre_completo.toLowerCase().includes(t) || e.numero.toLowerCase().includes(t));
  }, [empleados, busca]);

  async function accion(f: () => Promise<unknown>) {
    setError(null);
    try {
      await f();
      cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-tinta-900">
          Empleados asignados
          <Ayuda texto="Mientras su asignación esté vigente, el empleado checa con GPS contra la ubicación de la zona. Si lo asignas a otra zona, la asignación anterior se cierra un día antes." />
        </h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="checkbox" checked={verTodas} onChange={(e) => setVerTodas(e.target.checked)} /> Ver terminadas
          </label>
          {puedeEditar && !agregando && (
            <button type="button" className="btn-secondary py-1 text-xs" onClick={() => setAgregando(true)}>
              <Icono nombre="plus" className="h-4 w-4" /> Asignar
            </button>
          )}
        </div>
      </div>

      {agregando && (
        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input className="input sm:col-span-1" placeholder="Buscar empleado…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <div>
              <label className="label">Desde</label>
              <input className="input" type="date" min={obra.fecha_inicio} max={obra.fecha_fin ?? undefined} value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div>
              <label className="label">Hasta (opcional)</label>
              <input className="input" type="date" min={inicio} max={obra.fecha_fin ?? undefined} value={fin} onChange={(e) => setFin(e.target.value)} />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white">
            {filtrados.map((e) => (
              <label key={e.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={elegidos.includes(e.id)} onChange={(ev) => setElegidos((l) => (ev.target.checked ? [...l, e.id] : l.filter((x) => x !== e.id)))} />
                <span className="font-mono text-xs text-slate-500">{e.numero}</span> {e.nombre_completo}
              </label>
            ))}
            {!filtrados.length && <p className="px-3 py-2 text-sm text-slate-400">Sin empleados.</p>}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => (setAgregando(false), setElegidos([]))}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!elegidos.length || !inicio}
              onClick={() =>
                accion(async () => {
                  await post(`/obras/${obra.id}/asignaciones${query}`, { empleado_ids: elegidos, fecha_inicio: inicio, fecha_fin: fin || null });
                  setAgregando(false);
                  setElegidos([]);
                })
              }
            >
              Asignar {elegidos.length || ""}
            </button>
          </div>
        </div>
      )}

      {visibles.length === 0 ? (
        <p className="text-sm text-slate-400">Sin empleados asignados.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {visibles.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-tinta-900">
                  <span className="font-mono text-xs text-slate-500">{a.empleado.numero}</span> {a.empleado.nombre_completo}
                </p>
                <p className="text-xs text-slate-500">
                  {fechaCorta(a.fecha_inicio)} – {a.fecha_fin ? fechaCorta(a.fecha_fin) : "sin fin"}
                  {vigente(a) && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Hoy</span>}
                </p>
              </div>
              {puedeEditar && (
                <div className="flex items-center gap-3 text-xs">
                  {(!a.fecha_fin || a.fecha_fin >= hoy) && a.fecha_inicio <= hoy && (
                    <button type="button" className="text-slate-500 hover:text-tinta-900 hover:underline" onClick={() => accion(() => patch(`/obras/asignaciones/${a.id}${query}`, { fecha_fin: hoy }))}>
                      Terminar hoy
                    </button>
                  )}
                  <button type="button" className="text-red-600 hover:underline" onClick={() => accion(() => api(`/obras/asignaciones/${a.id}${query}`, { method: "DELETE" }))}>
                    Quitar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorBox message={error} />
    </div>
  );
}

/** Excel de horas trabajadas y extras por zona, con los filtros de exportación. */
function ReporteObras({ obras, query, onCerrar }: { obras: Obra[]; query: string; onCerrar: () => void }) {
  const [filtros, setFiltros] = useState<Filtros>(() => ({ ...filtrosIniciales(), preset: "mes", ...periodo("mes") }));
  const [obraId, setObraId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);

  async function bajar() {
    setError(null);
    setBajando(true);
    const p = paramsDe(filtros);
    for (const [k, v] of new URLSearchParams(query.replace(/^\?/, ""))) p.set(k, v);
    if (obraId) p.set("obra_id", obraId);
    try {
      await descargar(`/reportes/obras.xlsx?${p}`, `horas_por_zona_${filtros.desde}_${filtros.hasta}.xlsx`);
      onCerrar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBajando(false);
    }
  }

  return (
    <Registro flotante titulo="Horas por zona" imprimir={false} autoguardar={false} onCerrar={onCerrar} nota="Horas trabajadas y extras de cada empleado en la zona a la que estaba asignado cada día.">
      <div className="space-y-4">
        <Campos>
          <Fila etiqueta="Zona del reporte">
            <select className="input" value={obraId} onChange={(e) => setObraId(e.target.value)}>
              <option value="">Todas</option>
              {obras.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.clave} · {o.nombre}
                </option>
              ))}
            </select>
          </Fila>
        </Campos>
        <FiltrosExportacion query={query} valor={filtros} onCambio={setFiltros} sinZonas />
        <ErrorBox message={error} />
        <div className="flex justify-end">
          <button className="btn-primary" disabled={bajando} onClick={bajar}>
            <Icono nombre="file-chart-column" /> {bajando ? "Generando…" : "Descargar Excel"}
          </button>
        </div>
      </div>
    </Registro>
  );
}
