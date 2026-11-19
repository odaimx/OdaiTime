import { useCallback, useEffect, useState, type FormEvent } from "react";
import Avatar from "../components/Avatar";
import Registro from "../components/Registro";
import ReglasTarjeta from "../components/ReglasTarjeta";
import { useAuth } from "../lib/auth";
import { useNavigate } from "react-router";
import Icono from "../components/Iconos";
import Vista, { abrirEn, useVista, type ConfigVista } from "../components/Vista";
import { ErrorBox, Modal, PageHeader, useEmpresaScope } from "../components/ui";
import { periodo } from "../lib/periodo";
import { descargar, get, hm, hora, INCIDENCIAS, post, type DetalleAsistencia, type DiaAsistencia, type FilaResumen, type Sucursal } from "../lib/api";

const ESTADOS: Record<string, { label: string; clase: string }> = {
  asistencia: { label: "Asistencia", clase: "bg-emerald-50 text-emerald-700" },
  falta: { label: "Falta", clase: "bg-red-50 text-red-700" },
  descanso: { label: "Descanso", clase: "bg-slate-100 text-slate-500" },
  festivo: { label: "Festivo", clase: "bg-sky-50 text-sky-700" },
  sin_turno: { label: "Sin turno", clase: "bg-amber-50 text-amber-700" },
  fuera: { label: "—", clase: "text-slate-300" },
  ...Object.fromEntries(Object.entries(INCIDENCIAS).map(([k, v]) => [k, { label: v, clase: "bg-brand-50 text-brand-700" }])),
};

export default function TarjetaAsistencia() {
  const navegar = useNavigate();
  const { query, listo, selector } = useEmpresaScope();
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "superadmin" || usuario?.rol === "admin_empresa";
  const sep = query ? "&" : "?";
  const [preset, setPreset] = useState("semana");
  const [rango, setRango] = useState(periodo("semana"));
  const [sucursal, setSucursal] = useState("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [filas, setFilas] = useState<FilaResumen[] | null>(null);
  const [anterior, setAnterior] = useState<FilaResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<DetalleAsistencia | null>(null);
  const [justificar, setJustificar] = useState<DiaAsistencia | null>(null);
  const [formInc, setFormInc] = useState({ tipo: "falta_justificada", notas: "", folio: "" });

  const cargar = useCallback(() => {
    if (!listo) return;
    setError(null);
    const p = new URLSearchParams(rango);
    if (sucursal) p.set("sucursal_id", sucursal);
    get<FilaResumen[]>(`/asistencia/resumen${query}${sep}${p}`)
      .then(setFilas)
      .catch((e) => setError(e.message));
    // Periodo anterior de la misma duración, para comparar los indicadores.
    const ant = periodoAnterior(rango.desde, rango.hasta);
    const pa = new URLSearchParams(ant);
    if (sucursal) pa.set("sucursal_id", sucursal);
    get<FilaResumen[]>(`/asistencia/resumen${query}${sep}${pa}`)
      .then(setAnterior)
      .catch(() => setAnterior(null));
  }, [listo, query, sep, rango, sucursal]);
  useEffect(cargar, [cargar]);

  useEffect(() => {
    if (listo) get<Sucursal[]>(`/sucursales${query}`).then(setSucursales);
  }, [listo, query]);

  async function abrir(empleadoId: string) {
    setDetalle(await get<DetalleAsistencia>(`/asistencia/empleado/${empleadoId}${query}${sep}${new URLSearchParams(rango)}`));
  }

  async function guardarIncidencia(e: FormEvent) {
    e.preventDefault();
    if (!justificar || !detalle) return;
    setError(null);
    try {
      await post(`/asistencia/incidencias${query}`, {
        empleado_id: detalle.empleado.id,
        tipo: formInc.tipo,
        fecha_inicio: justificar.fecha,
        fecha_fin: justificar.fecha,
        notas: formInc.notas || null,
        folio: formInc.folio || null,
      });
      setJustificar(null);
      await abrir(detalle.empleado.id);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const tz = detalle?.zona_horaria;

  const total = (l: FilaResumen[] | null, f: (r: FilaResumen["resumen"]) => number) => (l ?? []).reduce((a, x) => a + f(x.resumen), 0);
  const indicadores = [
    { titulo: "Horas extra", valor: (l: FilaResumen[] | null) => total(l, (r) => r.minutos_dobles + r.minutos_triples), formato: hm, subirEsMalo: true },
    { titulo: "Faltas", valor: (l: FilaResumen[] | null) => total(l, (r) => r.faltas + r.faltas_por_retardos), formato: String, subirEsMalo: true },
    { titulo: "Retardos", valor: (l: FilaResumen[] | null) => total(l, (r) => r.retardos), formato: String, subirEsMalo: true },
    { titulo: "Asistencias", valor: (l: FilaResumen[] | null) => total(l, (r) => r.asistencias), formato: String, subirEsMalo: false },
  ];

  const config: ConfigVista<FilaResumen> = {
    id: "tarjeta_asistencia",
    tituloReporte: `Tarjeta de asistencia · ${rango.desde} al ${rango.hasta}`,
    ajustes: { titulo: "Reglas de la tarjeta de asistencia", contenido: <ReglasTarjeta query={query} esAdmin={esAdmin} /> },
    fuentes: "arts. 59, 66, 68, 71, 73, 74, 75 y 76",
    clave: (f) => f.empleado.id,
    onAbrir: (f) => abrir(f.empleado.id),
    actividades: { modelo: "empleado", query, listo },
    vacio: "No hay empleados en ese periodo.",
    ordenInicial: { clave: "empleado", dir: "asc" },
    columnas: [
      {
        clave: "empleado",
        titulo: "Empleado",
        fija: true,
        buscable: true,
        // El nombre abre la ficha del empleado; la tarjeta de la semana se abre con su ícono.
        enlace: (f) => abrirEn(navegar, "/empleados", f.empleado.id),
        valor: (f) => f.empleado.nombre_completo,
        render: (f) => (
          <div className="flex items-center gap-3">
            <Avatar empleadoId={f.empleado.id} nombre={f.empleado.nombre_completo} version={f.empleado.foto_actualizada} query={query} tam={32} />
            <span className="truncate font-medium text-tinta-900">{f.empleado.nombre_completo}</span>
          </div>
        ),
      },
      {
        clave: "tarjeta",
        titulo: "Tarjeta",
        fija: true,
        valor: () => null,
        render: (f) => (
          <button type="button" className="rounded-md p-1 text-brand-600 hover:bg-brand-50" title="Ver la tarjeta de asistencia del periodo" aria-label="Ver tarjeta de asistencia" onClick={() => abrir(f.empleado.id)}>
            <Icono nombre="clipboard-list" className="h-5 w-5" />
          </button>
        ),
      },
      { clave: "numero", titulo: "Número", buscable: true, visible: false, enlace: (f) => abrirEn(navegar, "/empleados", f.empleado.id), valor: (f) => f.empleado.numero },
      { clave: "sucursal", titulo: "Sucursal", buscable: true, agrupable: true, valor: (f) => f.sucursal.nombre, enlace: (f) => abrirEn(navegar, "/sucursales", f.sucursal.id), render: (f) => <span className="font-mono text-xs font-semibold text-brand-600">{f.sucursal.clave}</span> },
      { clave: "dias", titulo: "Días lab.", alinear: "derecha", sumar: true, valor: (f) => f.resumen.dias_laborables },
      { clave: "asistencias", titulo: "Asistencias", alinear: "derecha", sumar: true, valor: (f) => f.resumen.asistencias },
      {
        clave: "faltas",
        titulo: "Faltas",
        alinear: "derecha",
        sumar: true,
        valor: (f) => f.resumen.faltas + f.resumen.faltas_por_retardos,
        render: (f) => {
          const n = f.resumen.faltas + f.resumen.faltas_por_retardos;
          return <span className={n ? "font-semibold text-red-600" : "text-slate-300"}>{n}</span>;
        },
      },
      {
        clave: "retardos",
        titulo: "Retardos",
        alinear: "derecha",
        sumar: true,
        valor: (f) => f.resumen.retardos,
        render: (f) => (f.resumen.retardos ? <span className="text-amber-700">{f.resumen.retardos} ({f.resumen.minutos_retardo} min)</span> : <span className="text-slate-300">0</span>),
      },
      { clave: "trabajadas", titulo: "Horas trab.", alinear: "derecha", valor: (f) => f.resumen.minutos_trabajados, render: (f) => hm(f.resumen.minutos_trabajados) },
      { clave: "dobles", titulo: "Extra dobles", alinear: "derecha", valor: (f) => f.resumen.minutos_dobles, render: (f) => <Cero v={f.resumen.minutos_dobles} t={hm(f.resumen.minutos_dobles)} /> },
      { clave: "triples", titulo: "Extra triples", alinear: "derecha", valor: (f) => f.resumen.minutos_triples, render: (f) => <Cero v={f.resumen.minutos_triples} t={hm(f.resumen.minutos_triples)} /> },
      { clave: "domingos", titulo: "Domingos", alinear: "derecha", sumar: true, valor: (f) => f.resumen.domingos_trabajados, render: (f) => <Cero v={f.resumen.domingos_trabajados} /> },
      { clave: "descansos", titulo: "Desc. trab.", alinear: "derecha", sumar: true, valor: (f) => f.resumen.descansos_trabajados, render: (f) => <Cero v={f.resumen.descansos_trabajados} /> },
      { clave: "festivos", titulo: "Fest. trab.", alinear: "derecha", sumar: true, valor: (f) => f.resumen.festivos_trabajados, render: (f) => <Cero v={f.resumen.festivos_trabajados} /> },
      {
        clave: "incidencias",
        titulo: "Incidencias",
        valor: (f) => Object.entries(f.resumen.incidencias).map(([k, n]) => `${INCIDENCIAS[k]} ${n}`).join(", "),
        render: (f) => (
          <span className="space-x-1">
            {Object.entries(f.resumen.incidencias).map(([k, n]) => (
              <span key={k} className="whitespace-nowrap rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                {INCIDENCIAS[k]} {n}
              </span>
            ))}
            {f.resumen.minutos_exceso > 0 && <span className="whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">Exceso {hm(f.resumen.minutos_exceso)}</span>}
            {f.resumen.sin_salida > 0 && <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{f.resumen.sin_salida} sin salida</span>}
          </span>
        ),
      },
    ],
    filtros: [
      { clave: "con_faltas", titulo: "Con faltas", grupo: "alertas", prueba: (f) => f.resumen.faltas + f.resumen.faltas_por_retardos > 0 },
      { clave: "con_retardos", titulo: "Con retardos", grupo: "alertas", prueba: (f) => f.resumen.retardos > 0 },
      { clave: "con_extra", titulo: "Con horas extra", grupo: "alertas", prueba: (f) => f.resumen.minutos_dobles + f.resumen.minutos_triples > 0 },
      { clave: "sin_salida", titulo: "Sin salida", grupo: "alertas", prueba: (f) => f.resumen.sin_salida > 0 },
      { clave: "exceso", titulo: "Exceso de horas extra", grupo: "alertas", prueba: (f) => f.resumen.minutos_exceso > 0 },
      { clave: "festivos_trab", titulo: "Trabajaron festivo", grupo: "dias", prueba: (f) => f.resumen.festivos_trabajados > 0 },
      { clave: "domingos_trab", titulo: "Trabajaron domingo", grupo: "dias", prueba: (f) => f.resumen.domingos_trabajados > 0 },
      { clave: "con_incidencias", titulo: "Con incidencias", grupo: "inc", prueba: (f) => Object.keys(f.resumen.incidencias).length > 0 },
    ],
    tarjetas: [
      { filtro: "con_faltas", color: "rojo" },
      { filtro: "con_retardos", color: "naranja" },
      { filtro: "con_extra", color: "morado" },
      { filtro: "sin_salida", color: "azul" },
    ],
    panel: (
      <>
        <SelectorPeriodo preset={preset} rango={rango} onPreset={(k) => (setPreset(k), setRango(periodo(k)))} onRango={(r) => (setPreset(""), setRango(r))} sucursal={sucursal} sucursales={sucursales} onSucursal={setSucursal} />
        {indicadores.map((ind) => {
          const v = ind.valor(filas);
          const a = anterior ? ind.valor(anterior) : null;
          const cambio = a ? Math.round(((v - a) / a) * 100) : null;
          const malo = cambio !== null && (ind.subirEsMalo ? cambio > 0 : cambio < 0);
          return (
            <div key={ind.titulo}>
              <p className="text-sm font-medium text-tinta-900">{ind.titulo}</p>
              <p className="text-lg font-semibold tabular-nums text-tinta-900">
                {ind.formato(v)}
                {cambio !== null && cambio !== 0 && (
                  <span className={`ml-2 text-xs font-medium ${malo ? "text-red-600" : "text-emerald-600"}`} title="Contra el periodo anterior">
                    {cambio > 0 ? "▲" : "▼"} {Math.abs(cambio)}%
                  </span>
                )}
              </p>
            </div>
          );
        })}
      </>
    ),
    kanban: (f) => (
      <div className="pr-6">
        <div className="mb-3 flex items-center gap-3">
          <Avatar empleadoId={f.empleado.id} nombre={f.empleado.nombre_completo} version={f.empleado.foto_actualizada} query={query} tam={44} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-tinta-900">{f.empleado.nombre_completo}</p>
            <p className="text-xs text-slate-500">
              #{f.empleado.numero} · {f.sucursal.nombre}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <Mini titulo="Asist." v={f.resumen.asistencias} />
          <Mini titulo="Faltas" v={f.resumen.faltas + f.resumen.faltas_por_retardos} alerta />
          <Mini titulo="Retardos" v={f.resumen.retardos} aviso />
          <Mini titulo="Extra" v={hm(f.resumen.minutos_dobles + f.resumen.minutos_triples)} />
        </div>
      </div>
    ),
  };
  const vista = useVista(config, filas ?? []);

  /** Reportes en Excel del periodo y sucursal elegidos. */
  async function bajarReporte(ruta: "asistencia" | "detalle", nombre: string) {
    const p = new URLSearchParams(rango);
    if (sucursal) p.set("sucursal_id", sucursal);
    try {
      await descargar(`/reportes/${ruta}.xlsx${query}${sep}${p}`, `${nombre}_${rango.desde.replace(/-/g, "")}_${rango.hasta.replace(/-/g, "")}.xlsx`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const enOrden = vista.ordenados;

  return (
    <>
      <PageHeader
        submenu={[
          { etiqueta: "Tarjeta de asistencia", activo: true },
          {
            etiqueta: "Reportes",
            opciones: [
              { etiqueta: "Resumen del periodo (Excel)", icono: "sheet", onClick: () => bajarReporte("asistencia", "asistencia") },
              { etiqueta: "Detalle diario (Excel)", icono: "sheet", onClick: () => bajarReporte("detalle", "detalle_diario") },
            ],
          },
        ]}
        icono="clipboard-list"
        title="Tarjeta de asistencia" subtitle="Faltas, retardos, horas extra, domingos y festivos del periodo, calculados con la Ley Federal del Trabajo" action={selector} />

      <ErrorBox message={!detalle ? error : null} />

      {filas === null ? <div className="card px-4 py-16 text-center text-slate-500">Calculando…</div> : <Vista vista={vista} />}
      <p className="mt-2 text-xs text-slate-500">
        Horas en formato h:mm. Las horas extra se calculan sobre el horario del turno; los retardos y su conversión a faltas siguen la política de tu empresa (Config. asistencias). Toca un empleado para ver el detalle por día.
      </p>

      {detalle && (
        <Registro
          titulo={detalle.empleado.nombre_completo}
          subtitulo={`${rango.desde} a ${rango.hasta}`}
          indice={Math.max(enOrden.findIndex((f) => f.empleado.id === detalle.empleado.id), 0)}
          total={enOrden.length}
          onIr={(i) => abrir(enOrden[i].empleado.id)}
          onCerrar={() => setDetalle(null)}
        >
          <div className="max-h-[65vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-2">Día</th>
                  <th className="py-2 pr-2">Estado</th>
                  <th className="py-2 pr-2">Checadas</th>
                  <th className="py-2 pr-2 text-right">Trab.</th>
                  <th className="py-2 pr-2 text-right">Extra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detalle.dias.map((d) => {
                  const est = ESTADOS[d.estado] ?? { label: d.estado, clase: "" };
                  const fecha = new Date(d.fecha + "T12:00");
                  return (
                    <tr key={d.fecha} className="align-top">
                      <td className="whitespace-nowrap py-2 pr-2 capitalize text-tinta-900">{fecha.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}</td>
                      <td className="py-2 pr-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${est.clase}`}>{est.label}</span>
                        {d.festivo && (
                          <p className="mt-1 text-xs text-sky-700">
                            {d.festivo} · {d.festivo_obligatorio ? "obligatorio" : "opcional"}
                          </p>
                        )}
                        {d.retardo_min > 0 && <p className="mt-1 text-xs text-amber-700">Retardo {d.retardo_min} min</p>}
                        {d.domingo_trabajado && <p className="mt-1 text-xs text-slate-600">Prima dominical</p>}
                        {(d.descanso_trabajado || d.festivo_trabajado) && <p className="mt-1 text-xs text-slate-600">{d.festivo_trabajado ? "Festivo" : "Descanso"} trabajado: salario doble adicional</p>}
                        {d.observaciones.map((o) => (
                          <p key={o} className="mt-1 text-xs text-red-600">
                            {o}
                          </p>
                        ))}
                        {d.estado === "falta" && (
                          <button
                            className="mt-1 block text-xs font-medium text-brand-600 hover:underline"
                            onClick={() => {
                              setError(null);
                              setFormInc({ tipo: "falta_justificada", notas: "", folio: "" });
                              setJustificar(d);
                            }}
                          >
                            Justificar / registrar incidencia
                          </button>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-xs tabular-nums text-slate-600">
                        {d.entradas.map((e, i) => (
                          <span key={e} className="block">
                            {hora(e, tz)} – {d.salidas[i] ? hora(d.salidas[i], tz) : "?"}
                          </span>
                        ))}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{hm(d.trabajado_min)}</td>
                      <td className="py-2 pr-2 text-right text-xs tabular-nums">
                        {d.dobles_min > 0 && <span className="block">{hm(d.dobles_min)} dobles</span>}
                        {d.triples_min > 0 && <span className="block">{hm(d.triples_min)} triples</span>}
                        {d.exceso_min > 0 && <span className="block text-red-600">{hm(d.exceso_min)} exceso</span>}
                        {!d.extra_min && <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Registro>
      )}

      {justificar && detalle && (
        <Modal title={`Incidencia del ${new Date(justificar.fecha + "T12:00").toLocaleDateString("es-MX", { dateStyle: "long" })}`} onClose={() => setJustificar(null)}>
          <form onSubmit={guardarIncidencia} className="space-y-4">
            <div>
              <label className="label">Tipo</label>
              <select className="input" value={formInc.tipo} onChange={(e) => setFormInc({ ...formInc, tipo: e.target.value })}>
                {Object.entries(INCIDENCIAS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            {formInc.tipo === "incapacidad" && (
              <div>
                <label className="label">Folio de incapacidad (IMSS)</label>
                <input className="input" maxLength={40} value={formInc.folio} onChange={(e) => setFormInc({ ...formInc, folio: e.target.value })} />
              </div>
            )}
            <div>
              <label className="label">Notas</label>
              <input className="input" maxLength={1000} value={formInc.notas} onChange={(e) => setFormInc({ ...formInc, notas: e.target.value })} />
            </div>
            <p className="text-xs text-slate-500">Para rangos de varios días, usa la ficha del empleado › Vacaciones e incidencias.</p>
            <ErrorBox message={error} />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setJustificar(null)}>
                Cancelar
              </button>
              <button className="btn-primary">Guardar</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Cero({ v, t }: { v: number; t?: string }) {
  return <span className={v ? "text-tinta-900" : "text-slate-300"}>{t ?? v}</span>;
}

function Mini({ titulo, v, alerta, aviso }: { titulo: string; v: number | string; alerta?: boolean; aviso?: boolean }) {
  const activo = v !== 0 && v !== "0:00";
  const color = !activo ? "text-slate-300" : alerta ? "text-red-600" : aviso ? "text-amber-600" : "text-tinta-900";
  return (
    <div className="rounded-lg bg-slate-50 py-1.5">
      <p className={`text-base font-semibold tabular-nums ${color}`}>{v}</p>
      <p className="text-[11px] text-slate-500">{titulo}</p>
    </div>
  );
}

function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const d = new Date(desde + "T12:00");
  const h = new Date(hasta + "T12:00");
  const dias = Math.round((h.getTime() - d.getTime()) / 86_400_000) + 1;
  const fin = new Date(d);
  fin.setDate(d.getDate() - 1);
  const ini = new Date(fin);
  ini.setDate(fin.getDate() - dias + 1);
  return { desde: ini.toLocaleDateString("en-CA"), hasta: fin.toLocaleDateString("en-CA") };
}

const PRESETS: [string, string][] = [
  ["semana", "Esta semana"],
  ["semana_pasada", "Semana pasada"],
  ["quincena", "Quincena"],
  ["mes", "Este mes"],
];

/** Periodo y sucursal, en el panel de la derecha (como el selector de fechas de Odoo). */
function SelectorPeriodo({
  preset,
  rango,
  onPreset,
  onRango,
  sucursal,
  sucursales,
  onSucursal,
}: {
  preset: string;
  rango: { desde: string; hasta: string };
  onPreset: (k: string) => void;
  onRango: (r: { desde: string; hasta: string }) => void;
  sucursal: string;
  sucursales: Sucursal[];
  onSucursal: (id: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const etiqueta = PRESETS.find(([k]) => k === preset)?.[1] ?? `${rango.desde} → ${rango.hasta}`;
  return (
    <div className="relative border-slate-100 sm:border-r sm:pr-6">
      <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-tinta-900 hover:bg-slate-100" onClick={() => setAbierto((a) => !a)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
        </svg>
        {etiqueta} ▾
      </button>
      {sucursal && <p className="px-2 text-xs text-slate-500">{sucursales.find((s) => s.id === sucursal)?.nombre}</p>}
      {abierto && (
        <div className="popover right-0 top-11 w-72 space-y-3 p-3 sm:left-0 sm:right-auto">
          <div className="grid grid-cols-2 gap-1">
            {PRESETS.map(([k, l]) => (
              <button key={k} className={preset === k ? "menu-item-activo" : "menu-item"} onClick={() => (onPreset(k), setAbierto(false))}>
                {l}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-medium text-slate-500">
              Desde
              <input type="date" className="input mt-1" value={rango.desde} onChange={(e) => onRango({ ...rango, desde: e.target.value })} />
            </label>
            <label className="text-xs font-medium text-slate-500">
              Hasta
              <input type="date" className="input mt-1" value={rango.hasta} onChange={(e) => onRango({ ...rango, hasta: e.target.value })} />
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-500">
            Sucursal
            <select className="input mt-1" value={sucursal} onChange={(e) => onSucursal(e.target.value)}>
              <option value="">Todas</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.clave} — {s.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
