import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { get, hoyISO, type Ref, type Tarea, type TipoTarea } from "../lib/api";
import { useAuth } from "../lib/auth";
import { colorFecha, FormActividad, textoFecha, TIPOS } from "./Actividades";
import Icono from "./Iconos";

/**
 * Calendario de actividades al estilo Odoo:
 * día, semana, mes y año; mostrar u ocultar fines de semana; minicalendario y filtros
 * (mis actividades, responsables y tipos) en el panel de la derecha.
 */

type Escala = "dia" | "semana" | "mes" | "anio" | "lista";
const ESCALAS: [Escala, string][] = [
  ["dia", "Día"],
  ["semana", "Semana"],
  ["mes", "Mes"],
  ["anio", "Año"],
  ["lista", "Lista"],
];
const DIAS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const DIAS_MINI = ["L", "M", "M", "J", "V", "S", "D"];
const ALTO_HORA = 48; // px por hora en día/semana
const PREF = "odaitime.calendario";

const iso = (d: Date) => d.toLocaleDateString("en-CA");
const sumar = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const lunes = (d: Date) => sumar(d, -((d.getDay() + 6) % 7));
const finDeSemana = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const horaCorta = (h: string | null) => (h ? h.slice(0, 5) : "");

/** Número de semana ISO 8601. */
function semanaIso(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - inicio.getTime()) / 86_400_000 + 1) / 7);
}

/** Días de la cuadrícula de un mes (6 semanas, de lunes a domingo). */
function cuadriculaMes(anio: number, mes: number): Date[] {
  const ini = lunes(new Date(anio, mes, 1));
  return Array.from({ length: 42 }, (_, i) => sumar(ini, i));
}

function leerPrefs(): { escala: Escala; finde: boolean; panel: boolean } {
  const defecto = { escala: (window.innerWidth < 640 ? "dia" : "mes") as Escala, finde: true, panel: window.innerWidth >= 1024 };
  try {
    return { ...defecto, ...JSON.parse(localStorage.getItem(PREF) ?? "{}") };
  } catch {
    return defecto;
  }
}

export default function Calendario({ query, modelo }: { query: string; modelo?: string }) {
  const { usuario } = useAuth();
  const inicial = leerPrefs();
  const [escala, setEscala] = useState<Escala>(inicial.escala);
  const [finde, setFinde] = useState(inicial.finde);
  const [panel, setPanel] = useState(inicial.panel);
  const [ref, setRef] = useState(() => new Date());
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [usuarios, setUsuarios] = useState<Ref[]>([]);
  const [ocultosResp, setOcultosResp] = useState<Set<string>>(new Set());
  const [ocultosTipo, setOcultosTipo] = useState<Set<TipoTarea>>(new Set());
  const [soloMias, setSoloMias] = useState(false);
  const [menuEscala, setMenuEscala] = useState(false);
  const [pendientes, setPendientes] = useState<Tarea[] | null>(null); // null = botón visible
  const conPendientes = useRef(false);
  useEffect(() => {
    conPendientes.current = pendientes !== null;
  }, [pendientes]);
  const [form, setForm] = useState<{ tarea: Tarea | null; fecha?: string; hora?: string } | null>(null);
  const sep = query ? "&" : "?";

  useEffect(() => {
    try {
      localStorage.setItem(PREF, JSON.stringify({ escala, finde, panel }));
    } catch {
      /* sin almacenamiento */
    }
  }, [escala, finde, panel]);

  useEffect(() => {
    get<Ref[]>(`/tareas/usuarios${query}`).then(setUsuarios).catch(() => setUsuarios([]));
  }, [query]);

  // Rango visible según la escala.
  const [desde, hasta] = useMemo((): [Date, Date] => {
    if (escala === "dia") return [ref, ref];
    if (escala === "semana") return [lunes(ref), sumar(lunes(ref), 6)];
    if (escala === "mes") {
      const c = cuadriculaMes(ref.getFullYear(), ref.getMonth());
      return [c[0], c[41]];
    }
    if (escala === "lista") return [new Date(ref.getFullYear(), ref.getMonth(), 1), new Date(ref.getFullYear(), ref.getMonth() + 1, 0)];
    return [new Date(ref.getFullYear(), 0, 1), new Date(ref.getFullYear(), 11, 31)];
  }, [escala, ref]);

  const verPendientes = useCallback(() => {
    get<Tarea[]>(`/tareas/mias${query}`).then(setPendientes);
  }, [query]);

  const cargar = useCallback(() => {
    const p = new URLSearchParams({ desde: iso(desde), hasta: iso(hasta) });
    if (modelo) p.set("modelo", modelo);
    get<Tarea[]>(`/tareas/calendario${query}${sep}${p}`).then(setTareas);
    if (conPendientes.current) verPendientes(); // refresca la lista si está a la vista
  }, [desde, hasta, modelo, query, sep, verPendientes]);
  useEffect(cargar, [cargar]);

  const visibles = useMemo(
    () =>
      tareas.filter(
        (t) =>
          !ocultosTipo.has(t.tipo) &&
          (soloMias ? t.asignado?.id === usuario?.id : !ocultosResp.has(t.asignado?.id ?? "")),
      ),
    [tareas, ocultosTipo, ocultosResp, soloMias, usuario],
  );
  const porDia = useMemo(() => {
    const m: Record<string, Tarea[]> = {};
    for (const t of visibles) (m[t.fecha] ??= []).push(t);
    for (const l of Object.values(m)) l.sort((a, b) => (a.hora ?? "").localeCompare(b.hora ?? ""));
    return m;
  }, [visibles]);

  function mover(n: number) {
    if (escala === "dia") setRef(sumar(ref, n));
    else if (escala === "semana") setRef(sumar(ref, 7 * n));
    else if (escala === "mes" || escala === "lista") setRef(new Date(ref.getFullYear(), ref.getMonth() + n, 1));
    else setRef(new Date(ref.getFullYear() + n, ref.getMonth(), 1));
  }

  const titulo =
    escala === "dia"
      ? ref.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : escala === "semana"
        ? `${desde.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} – ${hasta.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}`
        : escala === "mes" || escala === "lista"
          ? ref.toLocaleDateString("es-MX", { month: "long", year: "numeric" })
          : String(ref.getFullYear());

  const nueva = (fecha: string, hora?: string) => setForm({ tarea: null, fecha, hora });
  const abrir = (t: Tarea) => setForm({ tarea: t });
  const alternar = <V,>(set: Set<V>, v: V) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {/* Barra */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="btn-icono" onClick={() => mover(-1)} aria-label="Anterior">
            <Icono nombre="arrow-left" />
          </button>
          <button className="btn-icono" onClick={() => mover(1)} aria-label="Siguiente">
            <Icono nombre="arrow-right" />
          </button>
          <div className="relative">
            <button
              className={`inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-navy-900 ${menuEscala ? "bg-brand-50 ring-1 ring-brand-500" : "bg-slate-100 hover:bg-slate-200"}`}
              onClick={() => setMenuEscala((a) => !a)}
            >
              {ESCALAS.find(([k]) => k === escala)?.[1]}
              <Icono nombre={menuEscala ? "chevron-up" : "chevron-down"} className="h-3.5 w-3.5" />
            </button>
            {menuEscala && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuEscala(false)} />
                <div className="popover left-0 top-11 w-56 p-1">
                  {ESCALAS.map(([k, l]) => (
                    <button
                      key={k}
                      className={escala === k ? "menu-item font-semibold text-navy-900" : "menu-item"}
                      onClick={() => {
                        setEscala(k);
                        setMenuEscala(false);
                      }}
                    >
                      <span className="w-4">{escala === k && <Icono nombre="check" className="h-3.5 w-3.5" />}</span>
                      {l}
                    </button>
                  ))}
                  <hr className="my-1 border-slate-100" />
                  <button className="menu-item font-medium text-navy-900" onClick={() => setFinde((f) => !f)}>
                    <span className="w-4">{finde && <Icono nombre="check" className="h-3.5 w-3.5" />}</span>
                    Mostrar fines de semana
                  </button>
                </div>
              </>
            )}
          </div>
          <button className="inline-flex h-9 items-center rounded-md bg-slate-100 px-3 text-sm font-medium text-navy-900 hover:bg-slate-200" onClick={() => setRef(new Date())}>
            Hoy
          </button>
          <h2 className="ml-2 text-base font-semibold capitalize text-navy-900 sm:text-lg">{titulo}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="btn-primary h-9 py-0" onClick={() => nueva(iso(ref))}>
            <Icono nombre="calendar-plus" /> Actividad
          </button>
          <button className={panel ? "btn-icono-activo" : "btn-icono"} onClick={() => setPanel((p) => !p)} title="Panel lateral" aria-label="Panel lateral">
            <Icono nombre="panel-right" />
          </button>
        </div>
      </div>

      <div className="flex">
        <div className="min-w-0 flex-1">
          {escala === "mes" && <VistaMes refDate={ref} finde={finde} porDia={porDia} onNueva={nueva} onAbrir={abrir} />}
          {(escala === "semana" || escala === "dia") && (
            <VistaHoras dias={escala === "dia" ? [ref] : Array.from({ length: 7 }, (_, i) => sumar(desde, i)).filter((d) => finde || !finDeSemana(d))} porDia={porDia} onNueva={nueva} onAbrir={abrir} />
          )}
          {escala === "lista" && <VistaLista tareas={visibles} onAbrir={abrir} />}
          {escala === "anio" && (
            <VistaAnio
              anio={ref.getFullYear()}
              porDia={porDia}
              onDia={(d) => {
                setRef(d);
                setEscala("dia");
              }}
            />
          )}
        </div>

        {panel && (
          <aside className="hidden w-64 shrink-0 border-l border-slate-200 p-4 md:block">
            <MiniMes
              valor={ref}
              porDia={porDia}
              onElegir={(d) => {
                setRef(d);
                if (escala === "anio") setEscala("mes");
              }}
            />
            <div className="mt-6 space-y-2">
              <p className="text-sm font-semibold text-navy-900">Mis calendarios</p>
              <label className="flex items-center gap-2 text-sm text-navy-900">
                <input type="checkbox" className="accent-brand-500" checked={soloMias} onChange={(e) => setSoloMias(e.target.checked)} />
                Solo mis actividades
              </label>
              {!soloMias &&
                usuarios.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" className="accent-navy-900" checked={!ocultosResp.has(u.id)} onChange={() => setOcultosResp((s) => alternar(s, u.id))} />
                    <span className="truncate">{u.id === usuario?.id ? `${u.nombre} (yo)` : u.nombre}</span>
                  </label>
                ))}
            </div>
            <div className="mt-6 space-y-2">
              <p className="text-sm font-semibold text-navy-900">Tipos de actividad</p>
              {(Object.keys(TIPOS) as TipoTarea[]).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="accent-brand-500" checked={!ocultosTipo.has(k)} onChange={() => setOcultosTipo((s) => alternar(s, k))} />
                  <span className={`h-2.5 w-2.5 rounded-full ${TIPOS[k].punto}`} />
                  {TIPOS[k].label}
                </label>
              ))}
            </div>
            <div className="mt-6">
              {pendientes === null ? (
                <button className="btn-secondary w-full" onClick={verPendientes}>
                  <Icono nombre="list-checks" /> Mis pendientes
                </button>
              ) : (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-navy-900">Mis pendientes ({pendientes.length})</p>
                    <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-navy-900" onClick={() => setPendientes(null)} aria-label="Ocultar pendientes">
                      <Icono nombre="x" className="h-4 w-4" />
                    </button>
                  </div>
                  {pendientes.length === 0 && <p className="text-sm text-slate-500">No tienes actividades pendientes.</p>}
                  <ul className="max-h-80 space-y-1 overflow-y-auto">
                    {pendientes.map((t) => (
                      <li key={t.id}>
                        <button className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50" onClick={() => abrir(t)}>
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TIPOS[t.tipo].punto}`} />
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
              )}
            </div>
          </aside>
        )}
      </div>

      {form && (
        <FormActividad
          tarea={form.tarea}
          fecha={form.fecha}
          hora={form.hora}
          query={query}
          onCerrar={() => setForm(null)}
          onGuardado={() => {
            setForm(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

function Evento({ t, onAbrir, compacto = true }: { t: Tarea; onAbrir: (t: Tarea) => void; compacto?: boolean }) {
  const vencida = !t.hecha_en && t.fecha < hoyISO();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onAbrir(t);
      }}
      title={`${TIPOS[t.tipo].label}: ${t.resumen}${t.registro_nombre ? ` · ${t.registro_nombre}` : ""}${t.asignado ? ` · ${t.asignado.nombre}` : ""}`}
      className={`flex w-full items-center gap-1 overflow-hidden rounded px-1.5 py-0.5 text-left text-[11px] ring-1 ${TIPOS[t.tipo].color} ${t.hecha_en ? "line-through opacity-50" : ""} ${vencida ? "ring-red-400" : ""}`}
    >
      <Icono nombre={TIPOS[t.tipo].icono} className="h-3 w-3 shrink-0" />
      {t.hora && <span className="shrink-0 font-semibold">{horaCorta(t.hora)}</span>}
      <span className="truncate">{t.resumen}</span>
      {!compacto && t.registro_nombre && <span className="truncate opacity-70">· {t.registro_nombre}</span>}
    </button>
  );
}

function NumeroDia({ d, tenue = false }: { d: Date; tenue?: boolean }) {
  const hoy = iso(d) === hoyISO();
  return (
    <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm ${hoy ? "bg-red-500 font-semibold text-white" : tenue ? "text-slate-300" : "text-navy-900"}`}>{d.getDate()}</span>
  );
}

function VistaMes({
  refDate,
  finde,
  porDia,
  onNueva,
  onAbrir,
}: {
  refDate: Date;
  finde: boolean;
  porDia: Record<string, Tarea[]>;
  onNueva: (fecha: string) => void;
  onAbrir: (t: Tarea) => void;
}) {
  const dias = cuadriculaMes(refDate.getFullYear(), refDate.getMonth());
  const semanas = Array.from({ length: 6 }, (_, i) => dias.slice(i * 7, i * 7 + 7));
  const cols = finde ? 7 : 5;
  const plantilla = { gridTemplateColumns: `2rem repeat(${cols}, minmax(0, 1fr))` };
  return (
    <div>
      <div className="grid border-b border-slate-200 text-center text-xs font-semibold text-navy-900" style={plantilla}>
        <div />
        {DIAS.slice(0, cols).map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      {semanas.map((sem) => (
        <div key={iso(sem[0])} className="grid" style={plantilla}>
          <div className="border-b border-r border-slate-200 bg-slate-50 pt-1 text-center text-[10px] text-slate-500">{semanaIso(sem[0])}</div>
          {sem
            .filter((d) => finde || !finDeSemana(d))
            .map((d) => {
              const k = iso(d);
              const lista = porDia[k] ?? [];
              const fuera = d.getMonth() !== refDate.getMonth();
              return (
                <div key={k} onClick={() => onNueva(k)} className="group min-h-24 cursor-pointer border-b border-r border-slate-200 p-1 transition hover:bg-brand-50/40 sm:min-h-32">
                  <div className="mb-1 flex justify-center">
                    <NumeroDia d={d} tenue={fuera} />
                  </div>
                  <div className="space-y-0.5">
                    {lista.slice(0, 3).map((t) => (
                      <Evento key={t.id} t={t} onAbrir={onAbrir} />
                    ))}
                    {lista.length > 3 && <p className="px-1 text-[11px] font-medium text-slate-500">+{lista.length - 3} más</p>}
                  </div>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

function VistaHoras({
  dias,
  porDia,
  onNueva,
  onAbrir,
}: {
  dias: Date[];
  porDia: Record<string, Tarea[]>;
  onNueva: (fecha: string, hora?: string) => void;
  onAbrir: (t: Tarea) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 7 * ALTO_HORA; // abre en las 7:00
  }, []);
  const plantilla = { gridTemplateColumns: `3.5rem repeat(${dias.length}, minmax(0, 1fr))` };
  const unico = dias.length === 1;
  return (
    <div>
      <div className="grid border-b border-slate-200" style={plantilla}>
        <div className="border-r border-slate-200 pt-1 text-center text-[10px] text-slate-500">S{semanaIso(dias[0])}</div>
        {dias.map((d) => (
          <div key={iso(d)} className="border-r border-slate-200 py-1.5 text-center">
            <p className="text-xs font-semibold text-navy-900">{DIAS[(d.getDay() + 6) % 7]}</p>
            <NumeroDia d={d} />
          </div>
        ))}
      </div>
      {/* Todo el día: actividades sin hora */}
      <div className="grid border-b border-slate-200 bg-slate-50/60" style={plantilla}>
        <div className="border-r border-slate-200 px-1 py-1 text-right text-[10px] leading-tight text-slate-500">Todo el día</div>
        {dias.map((d) => (
          <div key={iso(d)} onClick={() => onNueva(iso(d))} className="min-h-8 cursor-pointer space-y-0.5 border-r border-slate-200 p-1 hover:bg-brand-50/40">
            {(porDia[iso(d)] ?? [])
              .filter((t) => !t.hora)
              .map((t) => (
                <Evento key={t.id} t={t} onAbrir={onAbrir} compacto={!unico} />
              ))}
          </div>
        ))}
      </div>
      <div ref={scroll} className="max-h-[65vh] overflow-y-auto">
        <div className="relative grid" style={plantilla}>
          <div className="border-r border-slate-200">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ height: ALTO_HORA }} className="pr-1 text-right text-[10px] text-slate-500">
                {h > 0 && `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {dias.map((d) => {
            const k = iso(d);
            const conHora = (porDia[k] ?? []).filter((t) => t.hora);
            // Las que empiezan en la misma hora se reparten el ancho.
            const porHora: Record<number, Tarea[]> = {};
            for (const t of conHora) (porHora[Number(t.hora!.slice(0, 2))] ??= []).push(t);
            return (
              <div key={k} className="relative border-r border-slate-200">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} style={{ height: ALTO_HORA }} onClick={() => onNueva(k, `${String(h).padStart(2, "0")}:00`)} className="cursor-pointer border-b border-slate-100 hover:bg-brand-50/40" />
                ))}
                {conHora.map((t) => {
                  const [h, m] = t.hora!.split(":").map(Number);
                  const grupo = porHora[h];
                  const i = grupo.indexOf(t);
                  return (
                    <div
                      key={t.id}
                      className="absolute px-0.5"
                      style={{ top: (h + m / 60) * ALTO_HORA + 1, height: ALTO_HORA - 2, left: `${(i * 100) / grupo.length}%`, width: `${100 / grupo.length}%` }}
                    >
                      <div className="h-full [&>button]:h-full [&>button]:items-start">
                        <Evento t={t} onAbrir={onAbrir} compacto={!unico} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Las actividades del mes en forma de lista, agrupadas por día. */
function VistaLista({ tareas, onAbrir }: { tareas: Tarea[]; onAbrir: (t: Tarea) => void }) {
  const orden = [...tareas].sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.hora ?? "").localeCompare(b.hora ?? ""));
  if (!orden.length) return <p className="px-4 py-16 text-center text-sm text-slate-500">No hay actividades en este mes.</p>;
  let dia = "";
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-slate-200 text-left font-medium text-navy-900">
        <tr>
          <th className="px-4 py-2.5">Hora</th>
          <th className="px-3 py-2.5">Actividad</th>
          <th className="px-3 py-2.5">Sobre</th>
          <th className="px-3 py-2.5">Responsable</th>
          <th className="px-3 py-2.5">Estado</th>
        </tr>
      </thead>
      <tbody>
        {orden.map((t) => {
          const nuevoDia = t.fecha !== dia;
          dia = t.fecha;
          const d = new Date(t.fecha + "T12:00");
          return (
            <Fragment key={t.id}>
              {nuevoDia && (
                <tr key={`d-${t.fecha}`} className="bg-slate-50">
                  <td colSpan={5} className={`px-4 py-2 text-xs font-semibold capitalize ${t.fecha === hoyISO() ? "text-red-600" : "text-navy-900"}`}>
                    {d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
                  </td>
                </tr>
              )}
              <tr key={t.id} className="cursor-pointer border-b border-slate-100 hover:bg-brand-50/40" onClick={() => onAbrir(t)}>
                <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-600">{t.hora ? horaCorta(t.hora) : "Todo el día"}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${TIPOS[t.tipo].punto}`} />
                    <span className={`font-medium text-navy-900 ${t.hecha_en ? "line-through opacity-60" : ""}`}>{t.resumen}</span>
                    <span className="text-xs text-slate-500">{TIPOS[t.tipo].label}</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{t.registro_nombre ?? "General"}</td>
                <td className="px-3 py-2 text-slate-600">{t.asignado?.nombre ?? "—"}</td>
                <td className="px-3 py-2">
                  {t.hecha_en ? (
                    <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white">Hecha</span>
                  ) : t.fecha < hoyISO() ? (
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-medium text-white">Vencida</span>
                  ) : (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">Pendiente</span>
                  )}
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function VistaAnio({ anio, porDia, onDia }: { anio: number; porDia: Record<string, Tarea[]>; onDia: (d: Date) => void }) {
  return (
    <div className="grid grid-cols-1 gap-6 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => (
        <div key={m}>
          <p className="mb-2 text-center text-sm font-semibold capitalize text-navy-900">{new Date(anio, m, 1).toLocaleDateString("es-MX", { month: "long" })}</p>
          <Mes anio={anio} mes={m} porDia={porDia} onElegir={onDia} />
        </div>
      ))}
    </div>
  );
}

/** Mes pequeño (año y panel lateral). Los días con actividades llevan un punto. */
function Mes({ anio, mes, porDia, onElegir, seleccion }: { anio: number; mes: number; porDia: Record<string, Tarea[]>; onElegir: (d: Date) => void; seleccion?: Date }) {
  const dias = cuadriculaMes(anio, mes);
  const sel = seleccion ? iso(seleccion) : "";
  return (
    <div className="grid grid-cols-7 gap-y-0.5 text-center text-xs">
      {DIAS_MINI.map((d, i) => (
        <span key={i} className="py-1 font-semibold text-navy-900">
          {d}
        </span>
      ))}
      {dias.map((d) => {
        const k = iso(d);
        const fuera = d.getMonth() !== mes;
        const hoy = k === hoyISO();
        const tiene = !fuera && (porDia[k]?.length ?? 0) > 0;
        return (
          <button
            key={k}
            onClick={() => onElegir(d)}
            className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-full transition ${hoy ? "bg-red-500 font-semibold text-white" : k === sel ? "bg-brand-100 font-semibold text-brand-700" : fuera ? "text-slate-300" : "text-navy-900 hover:bg-slate-100"}`}
          >
            {d.getDate()}
            {tiene && !hoy && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-brand-500" />}
          </button>
        );
      })}
    </div>
  );
}

function MiniMes({ valor, porDia, onElegir }: { valor: Date; porDia: Record<string, Tarea[]>; onElegir: (d: Date) => void }) {
  const [mes, setMes] = useState(() => new Date(valor.getFullYear(), valor.getMonth(), 1));
  useEffect(() => setMes(new Date(valor.getFullYear(), valor.getMonth(), 1)), [valor]);
  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} aria-label="Mes anterior">
          <Icono nombre="chevron-left" className="h-4 w-4" />
        </button>
        <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} aria-label="Mes siguiente">
          <Icono nombre="chevron-right" className="h-4 w-4" />
        </button>
        <span className="ml-1 text-sm font-semibold text-navy-900">{mes.toLocaleDateString("es-MX", { month: "short", year: "numeric" })}</span>
      </div>
      <Mes anio={mes.getFullYear()} mes={mes.getMonth()} porDia={porDia} onElegir={onElegir} seleccion={valor} />
    </div>
  );
}

