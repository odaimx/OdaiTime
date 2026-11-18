import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Avatar from "../components/Avatar";
import { ArticuloLFT, FuenteLFT } from "../components/LFT";
import Registro from "../components/Registro";
import { ErrorBox, Modal, PageHeader, useEmpresaScope } from "../components/ui";
import { periodo } from "../lib/periodo";
import { get, hm, hora, INCIDENCIAS, post, type DetalleAsistencia, type DiaAsistencia, type FilaResumen, type Sucursal } from "../lib/api";

const ESTADOS: Record<string, { label: string; clase: string }> = {
  asistencia: { label: "Asistencia", clase: "bg-emerald-50 text-emerald-700" },
  falta: { label: "Falta", clase: "bg-red-50 text-red-700" },
  descanso: { label: "Descanso", clase: "bg-slate-100 text-slate-500" },
  festivo: { label: "Festivo", clase: "bg-sky-50 text-sky-700" },
  sin_turno: { label: "Sin turno", clase: "bg-amber-50 text-amber-700" },
  fuera: { label: "—", clase: "text-slate-300" },
  ...Object.fromEntries(Object.entries(INCIDENCIAS).map(([k, v]) => [k, { label: v, clase: "bg-brand-50 text-brand-700" }])),
};

function Th({ children, art, title }: { children: ReactNode; art?: string; title?: string }) {
  return (
    <th className="whitespace-nowrap px-3 py-3 text-right" title={title}>
      {children}
      {art && (
        <span className="ml-1 font-normal normal-case">
          (<ArticuloLFT art={art} />)
        </span>
      )}
    </th>
  );
}

const Num = ({ v, alerta }: { v: number | string; alerta?: boolean }) => (
  <td className={`px-3 py-3 text-right tabular-nums ${alerta ? "font-semibold text-red-600" : v === 0 || v === "—" ? "text-slate-300" : "text-navy-900"}`}>{v}</td>
);

export default function TarjetaAsistencia() {
  const { query, listo, selector } = useEmpresaScope();
  const sep = query ? "&" : "?";
  const [preset, setPreset] = useState("semana");
  const [rango, setRango] = useState(periodo("semana"));
  const [sucursal, setSucursal] = useState("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [filas, setFilas] = useState<FilaResumen[] | null>(null);
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

  return (
    <>
      <PageHeader title="Tarjeta de asistencia" subtitle="Faltas, retardos, horas extra, domingos y festivos del periodo, calculados con la Ley Federal del Trabajo" action={selector} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {[
            ["semana", "Esta semana"],
            ["semana_pasada", "Semana pasada"],
            ["quincena", "Quincena"],
            ["mes", "Mes"],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => {
                setPreset(k);
                setRango(periodo(k));
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${preset === k ? "bg-white text-navy-900 shadow-sm" : "text-slate-600 hover:text-navy-900"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="text-xs font-medium text-slate-500">
          Desde
          <input type="date" className="input mt-1 w-40" value={rango.desde} onChange={(e) => (setPreset(""), setRango({ ...rango, desde: e.target.value }))} />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Hasta
          <input type="date" className="input mt-1 w-40" value={rango.hasta} onChange={(e) => (setPreset(""), setRango({ ...rango, hasta: e.target.value }))} />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Sucursal
          <select className="input mt-1 w-56" value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
            <option value="">Todas</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.clave} — {s.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorBox message={!detalle ? error : null} />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Empleado</th>
              <Th>Días lab.</Th>
              <Th>Asist.</Th>
              <Th title="Faltas injustificadas (+ las que suman los retardos según tu política)">Faltas</Th>
              <Th>Retardos</Th>
              <Th>Horas trab.</Th>
              <Th art="66" title="Pagadas con 100 % adicional">Extra dobles</Th>
              <Th art="68" title="Pagadas con 200 % adicional">Extra triples</Th>
              <Th title="Domingos trabajados: prima dominical de al menos 25 %">
                Domingos <span className="font-normal normal-case">(<ArticuloLFT art="71" />)</span>
              </Th>
              <Th art="73" title="Descanso semanal trabajado: salario doble adicional">Desc. trab.</Th>
              <Th art="75" title="Día de descanso obligatorio trabajado: salario doble adicional">Fest. trab.</Th>
              <th className="px-3 py-3 text-left">Incidencias</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas?.map((f) => {
              const r = f.resumen;
              return (
                <tr key={f.empleado.id} className="cursor-pointer hover:bg-brand-50/50" onClick={() => abrir(f.empleado.id)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar empleadoId={f.empleado.id} nombre={f.empleado.nombre_completo} version={f.empleado.foto_actualizada} query={query} tam={32} />
                      <div>
                        <p className="whitespace-nowrap font-medium text-navy-900">{f.empleado.nombre_completo}</p>
                        <p className="font-mono text-xs text-slate-500">
                          #{f.empleado.numero} · {f.sucursal.clave}
                        </p>
                      </div>
                    </div>
                  </td>
                  <Num v={r.dias_laborables} />
                  <Num v={r.asistencias} />
                  <Num v={r.faltas + r.faltas_por_retardos} alerta={r.faltas + r.faltas_por_retardos > 0} />
                  <td className="px-3 py-3 text-right tabular-nums">{r.retardos ? <span className="text-amber-700">{r.retardos} ({r.minutos_retardo} min)</span> : <span className="text-slate-300">0</span>}</td>
                  <Num v={hm(r.minutos_trabajados)} />
                  <Num v={hm(r.minutos_dobles)} />
                  <Num v={hm(r.minutos_triples)} />
                  <Num v={r.domingos_trabajados} />
                  <Num v={r.descansos_trabajados} />
                  <Num v={r.festivos_trabajados} />
                  <td className="space-x-1 px-3 py-3">
                    {Object.entries(r.incidencias).map(([k, n]) => (
                      <span key={k} className="whitespace-nowrap rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                        {INCIDENCIAS[k]} {n}
                      </span>
                    ))}
                    {r.minutos_exceso > 0 && <span className="whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">Exceso {hm(r.minutos_exceso)}</span>}
                    {r.sin_salida > 0 && <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{r.sin_salida} sin salida</span>}
                  </td>
                </tr>
              );
            })}
            {filas?.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-slate-500">
                  No hay empleados en ese periodo.
                </td>
              </tr>
            )}
            {filas === null && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-slate-500">
                  Calculando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Horas en formato h:mm. Las horas extra se calculan sobre el horario del turno; los retardos y su conversión a faltas siguen la política de tu empresa (Config. asistencias). Toca un empleado para ver el detalle por día.
      </p>
      <FuenteLFT articulos="arts. 59, 66, 68, 71, 73, 74, 75 y 76" className="mt-2" />

      {detalle && (
        <Registro
          titulo={detalle.empleado.nombre_completo}
          subtitulo={`${rango.desde} a ${rango.hasta}`}
          indice={Math.max(filas?.findIndex((f) => f.empleado.id === detalle.empleado.id) ?? 0, 0)}
          total={filas?.length ?? 0}
          onIr={(i) => filas && abrir(filas[i].empleado.id)}
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
                      <td className="whitespace-nowrap py-2 pr-2 capitalize text-navy-900">{fecha.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}</td>
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
