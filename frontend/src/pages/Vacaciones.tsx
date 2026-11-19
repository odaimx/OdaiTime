import { useCallback, useEffect, useMemo, useState } from "react";
import Icono from "../components/Iconos";
import Vista, { useAbrirDesdeUrl, useVista, type ConfigVista } from "../components/Vista";
import { ErrorBox, Modal, PageHeader, useEmpresaScope } from "../components/ui";
import {
  abrirArchivo,
  fechaCorta,
  fechaHora,
  get,
  post,
  RAMOS,
  subirPut,
  TIPOS_INCAPACIDAD,
  type AlertaIncapacidad,
  type CalendarioEquipo,
  type IncidenciaReg,
  type Obra,
  type SolicitudVacaciones,
  type Sucursal,
} from "../lib/api";
import { ESTADO_VAC, rango } from "./MisVacaciones";

type Pestana = "solicitudes" | "incapacidades" | "calendario";

/** Vacaciones del equipo: solicitudes por aprobar y calendario de quién falta. */
export default function Vacaciones() {
  const { query, listo, selector } = useEmpresaScope();
  const [pestana, setPestana] = useState<Pestana>(() => {
    const v = new URLSearchParams(location.search).get("vista");
    return v === "calendario" || v === "incapacidades" ? v : "solicitudes";
  });
  return (
    <>
      <PageHeader
        icono="tree-palm"
        title="Ausencias"
        action={selector}
        submenu={[
          { etiqueta: "Solicitudes de vacaciones", activo: pestana === "solicitudes", onClick: () => setPestana("solicitudes") },
          { etiqueta: "Incapacidades", activo: pestana === "incapacidades", onClick: () => setPestana("incapacidades") },
          { etiqueta: "Calendario del equipo", activo: pestana === "calendario", onClick: () => setPestana("calendario") },
        ]}
      />
      {listo && (pestana === "solicitudes" ? <Solicitudes query={query} /> : pestana === "incapacidades" ? <Incapacidades query={query} /> : <Calendario query={query} />)}
    </>
  );
}

function Solicitudes({ query }: { query: string }) {
  const [lista, setLista] = useState<SolicitudVacaciones[]>([]);
  const [abierta, setAbierta] = useState<SolicitudVacaciones | null>(null);
  const cargar = useCallback(() => {
    get<SolicitudVacaciones[]>(`/vacaciones/solicitudes${query}`).then(setLista);
  }, [query]);
  useEffect(cargar, [cargar]);

  const config: ConfigVista<SolicitudVacaciones> = {
    id: "vacaciones",
    tituloReporte: "Solicitudes de vacaciones",
    clave: (s) => s.id,
    onAbrir: setAbierta,
    vacio: "No hay solicitudes. Los empleados piden vacaciones desde su portal (Mis vacaciones).",
    ordenInicial: { clave: "solicitada", dir: "desc" },
    columnas: [
      { clave: "numero", titulo: "Número", buscable: true, visible: false, valor: (s) => s.empleado.numero },
      { clave: "empleado", titulo: "Empleado", fija: true, buscable: true, enlace: true, valor: (s) => s.empleado.nombre_completo },
      { clave: "fechas", titulo: "Fechas", valor: (s) => s.fecha_inicio, render: (s) => rango(s.fecha_inicio, s.fecha_fin) },
      { clave: "dias", titulo: "Días", valor: (s) => s.dias, render: (s) => <span className="tabular-nums">{s.dias}</span> },
      { clave: "motivo", titulo: "Motivo", buscable: true, valor: (s) => s.motivo },
      {
        clave: "estado",
        titulo: "Estado",
        agrupable: true,
        valor: (s) => ESTADO_VAC[s.estado].texto,
        render: (s) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_VAC[s.estado].clase}`}>{ESTADO_VAC[s.estado].texto}</span>,
      },
      { clave: "solicitada", titulo: "Solicitada", valor: (s) => s.created_at, render: (s) => fechaHora(s.created_at) },
    ],
    filtros: [
      { clave: "pendientes", titulo: "Por aprobar", grupo: "estado", prueba: (s) => s.estado === "pendiente" },
      { clave: "aprobadas", titulo: "Aprobadas", grupo: "estado", prueba: (s) => s.estado === "aprobada" },
      { clave: "rechazadas", titulo: "Rechazadas o canceladas", grupo: "estado", prueba: (s) => s.estado === "rechazada" || s.estado === "cancelada" },
    ],
    tarjetas: [
      { filtro: "pendientes", color: "naranja" },
      { filtro: "aprobadas", color: "verde" },
    ],
    filtrosIniciales: ["pendientes"],
  };
  const vista = useVista(config, lista);
  useAbrirDesdeUrl(lista, (s) => s.id, setAbierta);

  return (
    <>
      <Vista vista={vista} />
      {abierta && (
        <Responder
          s={abierta}
          query={query}
          onCerrar={() => setAbierta(null)}
          onCambio={(r) => {
            setLista((l) => l.map((x) => (x.id === r.id ? r : x)));
            setAbierta(r);
          }}
        />
      )}
    </>
  );
}

function Responder({ s, query, onCerrar, onCambio }: { s: SolicitudVacaciones; query: string; onCerrar: () => void; onCambio: (s: SolicitudVacaciones) => void }) {
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>(s.avisos);
  const [ocupado, setOcupado] = useState(false);
  const futura = s.fecha_inicio > new Date().toISOString().slice(0, 10);

  async function accion(que: "aprobar" | "rechazar" | "cancelar") {
    setError(null);
    setOcupado(true);
    try {
      const r = await post<SolicitudVacaciones>(`/vacaciones/solicitudes/${s.id}/${que}${query}`, { comentario: comentario || null });
      setAvisos(r.avisos);
      setComentario("");
      onCambio(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal title={`Vacaciones · ${s.empleado.nombre_completo}`} onClose={onCerrar}>
      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="label">Fechas</dt>
          <dd className="text-tinta-900">{rango(s.fecha_inicio, s.fecha_fin)}</dd>
        </div>
        <div>
          <dt className="label">Días hábiles</dt>
          <dd className="text-tinta-900">{s.dias}</dd>
        </div>
        <div>
          <dt className="label">Estado</dt>
          <dd>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_VAC[s.estado].clase}`}>{ESTADO_VAC[s.estado].texto}</span>
          </dd>
        </div>
        <div>
          <dt className="label">Solicitada</dt>
          <dd className="text-tinta-900">{fechaHora(s.created_at)}</dd>
        </div>
        {s.motivo && (
          <div className="col-span-2">
            <dt className="label">Motivo</dt>
            <dd className="text-tinta-900">{s.motivo}</dd>
          </div>
        )}
        {s.comentario && (
          <div className="col-span-2">
            <dt className="label">Respuesta</dt>
            <dd className="text-tinta-900">{s.comentario}</dd>
          </div>
        )}
      </dl>
      {avisos.map((a) => (
        <p key={a} className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {a}
        </p>
      ))}
      {(s.estado === "pendiente" || (s.estado === "aprobada" && futura)) && (
        <div className="space-y-3">
          <div>
            <label className="label">Comentario para el empleado {s.estado === "pendiente" && "(obligatorio al rechazar)"}</label>
            <textarea className="input" rows={2} maxLength={1000} value={comentario} onChange={(e) => setComentario(e.target.value)} />
          </div>
          <ErrorBox message={error} />
          <div className="flex flex-wrap justify-end gap-2">
            {s.estado === "pendiente" ? (
              <>
                <button className="btn-secondary text-red-600" disabled={ocupado} onClick={() => accion("rechazar")}>
                  Rechazar
                </button>
                <button className="btn-primary" disabled={ocupado} onClick={() => accion("aprobar")}>
                  <Icono nombre="check" /> Aprobar
                </button>
              </>
            ) : (
              <button className="btn-secondary text-red-600" disabled={ocupado} onClick={() => accion("cancelar")}>
                Cancelar vacaciones
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">Se avisa al empleado por correo. Al aprobar, las vacaciones aparecen en su tarjeta de asistencia.</p>
        </div>
      )}
    </Modal>
  );
}

// --- Incapacidades ---

const ALERTA_COLOR: Record<AlertaIncapacidad["tipo"], string> = {
  por_vencer: "bg-orange-50 text-orange-800",
  sin_alta: "bg-red-50 text-red-700",
  sin_certificado: "bg-amber-50 text-amber-800",
};

function Incapacidades({ query }: { query: string }) {
  const [lista, setLista] = useState<IncidenciaReg[]>([]);
  const [alertas, setAlertas] = useState<AlertaIncapacidad[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sep = query ? "&" : "?";
  const cargar = useCallback(() => {
    const desde = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    get<IncidenciaReg[]>(`/asistencia/incidencias${query}${sep}desde=${desde}`).then((l) => setLista(l.filter((i) => i.tipo === "incapacidad")));
    get<AlertaIncapacidad[]>(`/asistencia/incapacidades/alertas${query}`).then(setAlertas);
  }, [query, sep]);
  useEffect(cargar, [cargar]);
  const hoy = new Date().toISOString().slice(0, 10);

  async function adjuntar(i: IncidenciaReg, f: File) {
    setError(null);
    try {
      await subirPut(`/asistencia/incidencias/${i.id}/certificado${query}`, "archivo", f);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const config: ConfigVista<IncidenciaReg> = {
    id: "incapacidades",
    tituloReporte: "Incapacidades",
    clave: (i) => i.id,
    vacio: "Sin incapacidades en el último año. Se registran en la ficha del empleado (Vacaciones e incidencias).",
    ordenInicial: { clave: "inicio", dir: "desc" },
    columnas: [
      { clave: "empleado", titulo: "Empleado", fija: true, buscable: true, valor: (i) => i.empleado.nombre_completo },
      { clave: "ramo", titulo: "Ramo", agrupable: true, valor: (i) => RAMOS[i.ramo ?? ""] ?? "—" },
      { clave: "tipo", titulo: "Tipo", agrupable: true, valor: (i) => TIPOS_INCAPACIDAD[i.tipo_incapacidad ?? ""] ?? "—" },
      { clave: "inicio", titulo: "Fechas", valor: (i) => i.fecha_inicio, render: (i) => rango(i.fecha_inicio, i.fecha_fin) },
      { clave: "folio", titulo: "Folio", buscable: true, valor: (i) => i.folio },
      {
        clave: "certificado",
        titulo: "Certificado",
        agrupable: true,
        valor: (i) => (i.tiene_certificado ? "Adjunto" : "Falta"),
        render: (i) => (
          <span className="flex gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
            {i.tiene_certificado ? (
              <button className="text-brand-600 hover:underline" onClick={() => abrirArchivo(`/asistencia/incidencias/${i.id}/certificado${query}`)}>
                Ver
              </button>
            ) : (
              <span className="text-amber-700">Falta</span>
            )}
            <label className="cursor-pointer text-brand-600 hover:underline">
              {i.tiene_certificado ? "Cambiar" : "Adjuntar"}
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && adjuntar(i, e.target.files[0])} />
            </label>
          </span>
        ),
      },
    ],
    filtros: [
      { clave: "vigentes", titulo: "Vigentes", grupo: "estado", prueba: (i) => i.fecha_inicio <= hoy && hoy <= i.fecha_fin },
      { clave: "sin_certificado", titulo: "Sin certificado", grupo: "datos", prueba: (i) => !i.tiene_certificado },
    ],
    tarjetas: [
      { filtro: "vigentes", color: "azul" },
      { filtro: "sin_certificado", color: "naranja" },
    ],
  };
  const vista = useVista(config, lista);

  return (
    <div className="space-y-4">
      {alertas.length > 0 && (
        <div className="space-y-2">
          {alertas.map((a) => (
            <p key={`${a.tipo}-${a.incidencia.id}`} className={`rounded-lg px-3 py-2 text-sm ${ALERTA_COLOR[a.tipo]}`}>
              ⚠️ {a.mensaje}
            </p>
          ))}
        </div>
      )}
      <ErrorBox message={error} />
      <Vista vista={vista} />
    </div>
  );
}

// --- Calendario del equipo ---

const COLORES: Record<string, string> = {
  vacaciones: "bg-sky-500",
  solicitud: "bg-sky-200 ring-1 ring-inset ring-sky-400",
  incapacidad: "bg-rose-400",
  permiso_con_goce: "bg-violet-400",
  permiso_sin_goce: "bg-violet-300",
  falta_justificada: "bg-amber-400",
};
const LEYENDA: [string, string][] = [
  ["vacaciones", "Vacaciones"],
  ["solicitud", "Vacaciones por aprobar"],
  ["incapacidad", "Incapacidad"],
  ["permiso_con_goce", "Permiso con goce"],
  ["permiso_sin_goce", "Permiso sin goce"],
  ["falta_justificada", "Falta justificada"],
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Calendario({ query }: { query: string }) {
  const [mes, setMes] = useState(() => {
    const h = new Date();
    return new Date(h.getFullYear(), h.getMonth(), 1);
  });
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [obras, setObras] = useState<Obra[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [obraId, setObraId] = useState("");
  const [soloAusentes, setSoloAusentes] = useState(true);
  const [datos, setDatos] = useState<CalendarioEquipo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<Sucursal[]>(`/sucursales${query}`).then((s) => setSucursales(s.filter((x) => x.activa)));
    get<Obra[]>(`/obras${query}`)
      .then((o) => setObras(o.filter((x) => x.activa)))
      .catch(() => setObras([]));
  }, [query]);

  const dias = useMemo(() => {
    const fin = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
    return Array.from({ length: fin }, (_, i) => new Date(mes.getFullYear(), mes.getMonth(), i + 1));
  }, [mes]);

  useEffect(() => {
    const p = new URLSearchParams(query.replace(/^\?/, ""));
    p.set("desde", iso(dias[0]));
    p.set("hasta", iso(dias[dias.length - 1]));
    if (sucursalId) p.set("sucursal_id", sucursalId);
    if (obraId) p.set("obra_id", obraId);
    setError(null);
    get<CalendarioEquipo>(`/vacaciones/calendario?${p}`)
      .then(setDatos)
      .catch((e) => setError((e as Error).message));
  }, [query, dias, sucursalId, obraId]);

  const hoy = iso(new Date());
  const porEmpleado = useMemo(() => {
    const m = new Map<string, CalendarioEquipo["ausencias"]>();
    for (const a of datos?.ausencias ?? []) m.set(a.empleado_id, [...(m.get(a.empleado_id) ?? []), a]);
    return m;
  }, [datos]);
  const ausenciaEn = (empleadoId: string, d: string) => porEmpleado.get(empleadoId)?.find((a) => a.fecha_inicio <= d && d <= a.fecha_fin);
  const filas = (datos?.empleados ?? []).filter((e) => !soloAusentes || porEmpleado.has(e.id));
  const faltanEn = (d: string) => (datos?.empleados ?? []).filter((e) => ausenciaEn(e.id, d) && !ausenciaEn(e.id, d)?.pendiente).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button className="btn-flecha" aria-label="Mes anterior" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}>
            <Icono nombre="chevron-left" />
          </button>
          <span className="w-40 text-center font-semibold capitalize text-tinta-900">{mes.toLocaleDateString("es-MX", { month: "long", year: "numeric" })}</span>
          <button className="btn-flecha" aria-label="Mes siguiente" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}>
            <Icono nombre="chevron-right" />
          </button>
        </div>
        <select className="input w-auto" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} aria-label="Sucursal">
          <option value="">Todas las sucursales</option>
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.clave} · {s.nombre}
            </option>
          ))}
        </select>
        {obras.length > 0 && (
          <select className="input w-auto" value={obraId} onChange={(e) => setObraId(e.target.value)} aria-label="Obra">
            <option value="">Todas las obras</option>
            {obras.map((o) => (
              <option key={o.id} value={o.id}>
                {o.clave} · {o.nombre}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={soloAusentes} onChange={(e) => setSoloAusentes(e.target.checked)} /> Solo quien falta en el mes
        </label>
      </div>
      <ErrorBox message={error} />

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-48 bg-white px-3 py-2 text-left font-semibold text-slate-600">Empleado</th>
              {dias.map((d) => {
                const k = iso(d);
                const finde = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <th key={k} className={`min-w-7 px-0.5 py-1 text-center font-medium ${finde ? "bg-slate-50 text-slate-400" : "text-slate-600"} ${k === hoy ? "text-brand-600" : ""}`}>
                    <div className="text-[10px] uppercase">{d.toLocaleDateString("es-MX", { weekday: "narrow" })}</div>
                    <div className={k === hoy ? "mx-auto w-5 rounded-full bg-brand-500 text-white" : ""}>{d.getDate()}</div>
                  </th>
                );
              })}
            </tr>
            <tr className="border-b border-slate-200">
              <td className="sticky left-0 z-10 bg-white px-3 pb-1 text-[11px] text-slate-500">Faltan</td>
              {dias.map((d) => {
                const n = faltanEn(iso(d));
                return (
                  <td key={iso(d)} className="pb-1 text-center text-[11px] font-semibold tabular-nums text-rose-600">
                    {n || ""}
                  </td>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filas.map((e) => (
              <tr key={e.id} className="border-b border-slate-100">
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                  <p className="truncate font-medium text-tinta-900">{e.nombre_completo}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {e.sucursal.clave}
                    {e.obra && ` · ${e.obra}`}
                  </p>
                </td>
                {dias.map((d) => {
                  const k = iso(d);
                  const a = ausenciaEn(e.id, k);
                  const finde = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <td key={k} className={`p-0.5 ${finde ? "bg-slate-50" : ""}`} title={a ? `${a.etiqueta}: ${rango(a.fecha_inicio, a.fecha_fin)}` : undefined}>
                      {a && <div className={`h-5 rounded ${COLORES[a.tipo] ?? "bg-slate-400"}`} />}
                    </td>
                  );
                })}
              </tr>
            ))}
            {datos && filas.length === 0 && (
              <tr>
                <td colSpan={dias.length + 1} className="px-3 py-6 text-center text-sm text-slate-400">
                  {soloAusentes ? "Nadie falta este mes." : "Sin empleados."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
        {LEYENDA.map(([k, t]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-5 rounded ${COLORES[k]}`} /> {t}
          </span>
        ))}
        <span className="text-slate-400">Periodo: {fechaCorta(iso(dias[0]))} – {fechaCorta(iso(dias[dias.length - 1]))}</span>
      </div>
    </div>
  );
}
