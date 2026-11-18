import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, diasHasta, get, hoyISO, patch, post, type Ref, type ResumenTarea, type Tarea, type TipoTarea } from "../lib/api";
import { ErrorBox, Modal } from "./ui";

/**
 * Actividades programadas al estilo Odoo:
 * - <RelojActividad>: el reloj de cada registro (rojo vencida, ámbar hoy, verde próxima).
 * - <FormActividad>: programar o editar una actividad.
 * - <Calendario>: vista de mes o semana con las actividades.
 */

export const TIPOS: Record<TipoTarea, { label: string; icono: string; color: string }> = {
  llamada: { label: "Llamada", icono: "M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z", color: "bg-sky-100 text-sky-800 ring-sky-200" },
  reunion: { label: "Reunión", icono: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8", color: "bg-violet-100 text-violet-800 ring-violet-200" },
  correo: { label: "Correo", icono: "M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm18 2l-10 7L2 6", color: "bg-amber-100 text-amber-800 ring-amber-200" },
  tarea: { label: "Tarea", icono: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11", color: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  recordatorio: { label: "Recordatorio", icono: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0", color: "bg-rose-100 text-rose-800 ring-rose-200" },
};

const RELOJ = "M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z";

export function Icono({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Color del reloj según la actividad más próxima. */
export function colorFecha(fecha: string | undefined): string {
  if (!fecha) return "text-slate-300 hover:text-slate-500";
  const d = diasHasta(fecha);
  if (d < 0) return "text-red-600";
  if (d === 0) return "text-amber-500";
  return "text-emerald-600";
}

export function textoFecha(fecha: string): string {
  const d = diasHasta(fecha);
  if (d === 0) return "Hoy";
  if (d === 1) return "Mañana";
  if (d === -1) return "Ayer (vencida)";
  if (d < 0) return `Vencida hace ${-d} días`;
  return `En ${d} días`;
}

const horaCorta = (h: string | null) => (h ? h.slice(0, 5) : "");

/**
 * Menú flotante que se dibuja en <body> (para que no lo recorte una tabla con scroll).
 * Se coloca debajo del botón y se cierra con clic afuera, Escape, scroll o al cambiar el tamaño.
 */
export function useFlotante(ancho: number, alinear: "derecha" | "izquierda" = "izquierda") {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const boton = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const abrir = useCallback(() => {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    const left = alinear === "derecha" ? r.right - ancho : r.left;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - ancho - 8)) });
  }, [ancho, alinear]);
  const cerrar = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !boton.current?.contains(t)) setPos(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const mover = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) setPos(null);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", mover, true);
    window.addEventListener("resize", cerrar);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", mover, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [pos, cerrar]);

  const render = (contenido: ReactNode, className = "") =>
    pos &&
    createPortal(
      <div ref={panel} style={{ position: "fixed", top: pos.top, left: pos.left, width: ancho }} className={`popover ${className}`} onClick={(e) => e.stopPropagation()}>
        {contenido}
      </div>,
      document.body,
    );

  return { abierto: pos !== null, abrir, cerrar, alternar: () => (pos ? cerrar() : abrir()), boton, render };
}

/** Reloj de actividades de un registro, con su lista desplegable. */
export function RelojActividad({
  modelo,
  registroId,
  resumen,
  query,
  onCambio,
  alinear = "derecha",
}: {
  modelo: string;
  registroId: string;
  resumen?: ResumenTarea;
  query: string;
  onCambio: () => void;
  alinear?: "derecha" | "izquierda";
}) {
  const flot = useFlotante(320, alinear);
  const abierto = flot.abierto;
  const [lista, setLista] = useState<Tarea[] | null>(null);
  const [form, setForm] = useState<Tarea | "nueva" | null>(null);
  const [terminando, setTerminando] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const sep = query ? "&" : "?";

  const cargar = useCallback(() => {
    get<Tarea[]>(`/tareas${query}${sep}modelo=${modelo}&registro_id=${registroId}`).then(setLista);
  }, [query, sep, modelo, registroId]);

  useEffect(() => {
    if (abierto) cargar();
  }, [abierto, cargar]);

  async function hecha(t: Tarea) {
    await post(`/tareas/${t.id}/hecha${query}`, { comentario: comentario || null });
    setTerminando(null);
    setComentario("");
    cargar();
    onCambio();
  }

  return (
    <div className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        ref={(el) => {
          flot.boton.current = el;
        }}
        type="button"
        onClick={flot.alternar}
        className={`relative rounded-full p-1 transition hover:bg-slate-100 ${colorFecha(resumen?.proxima)}`}
        title={resumen ? `${resumen.pendientes} actividad(es) · ${textoFecha(resumen.proxima)}` : "Programar una actividad"}
        aria-label="Actividades"
      >
        <Icono d={RELOJ} className="h-5 w-5" />
        {resumen && resumen.pendientes > 1 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-navy-900 px-1 text-[10px] font-semibold text-white">{resumen.pendientes}</span>
        )}
      </button>
      {flot.render(
        <>
          <div className="max-h-80 overflow-y-auto p-2">
            {lista === null && <p className="px-3 py-2 text-sm text-slate-500">Cargando…</p>}
            {lista?.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">Sin actividades pendientes.</p>}
            {lista?.map((t) => (
              <div key={t.id} className="rounded-lg px-3 py-2 hover:bg-slate-50">
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 rounded-md p-1 ring-1 ${TIPOS[t.tipo].color}`}>
                    <Icono d={TIPOS[t.tipo].icono} className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-navy-900">{t.resumen}</p>
                    <p className={`text-xs ${colorFecha(t.fecha)}`}>
                      {textoFecha(t.fecha)} {horaCorta(t.hora)} {t.asignado && <span className="text-slate-500">· {t.asignado.nombre}</span>}
                    </p>
                  </div>
                </div>
                {terminando === t.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea className="input text-xs" rows={2} placeholder="Comentario (opcional)" value={comentario} onChange={(e) => setComentario(e.target.value)} autoFocus />
                    <div className="flex justify-end gap-2">
                      <button className="text-xs text-slate-500 hover:underline" onClick={() => setTerminando(null)}>
                        Cancelar
                      </button>
                      <button className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700" onClick={() => hecha(t)}>
                        Marcar como hecha
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 flex gap-3 pl-8 text-xs">
                    <button className="font-medium text-emerald-700 hover:underline" onClick={() => setTerminando(t.id)}>
                      ✓ Hecha
                    </button>
                    <button className="text-slate-500 hover:text-navy-900 hover:underline" onClick={() => (flot.cerrar(), setForm(t))}>
                      Editar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="flex w-full items-center gap-2 border-t border-slate-100 px-5 py-3 text-sm font-medium text-brand-600 hover:bg-brand-50" onClick={() => (flot.cerrar(), setForm("nueva"))}>
            + Programar una actividad
          </button>
        </>,
        "p-0",
      )}
      {form && (
        <FormActividad
          tarea={form === "nueva" ? null : form}
          modelo={modelo}
          registroId={registroId}
          query={query}
          onCerrar={() => setForm(null)}
          onGuardado={() => {
            setForm(null);
            cargar();
            onCambio();
          }}
        />
      )}
    </div>
  );
}

/** Formulario para programar o editar una actividad. */
export function FormActividad({
  tarea,
  modelo = null,
  registroId = null,
  fecha,
  query,
  onCerrar,
  onGuardado,
}: {
  tarea: Tarea | null;
  modelo?: string | null;
  registroId?: string | null;
  fecha?: string;
  query: string;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [usuarios, setUsuarios] = useState<Ref[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [f, setF] = useState({
    tipo: (tarea?.tipo ?? "tarea") as TipoTarea,
    resumen: tarea?.resumen ?? "",
    nota: tarea?.nota ?? "",
    fecha: tarea?.fecha ?? fecha ?? hoyISO(),
    hora: horaCorta(tarea?.hora ?? null),
    asignado_id: tarea?.asignado?.id ?? "",
  });

  useEffect(() => {
    get<Ref[]>(`/tareas/usuarios${query}`).then(setUsuarios).catch(() => setUsuarios([]));
  }, [query]);

  const datos = () => ({
    tipo: f.tipo,
    resumen: f.resumen.trim() || TIPOS[f.tipo].label,
    nota: f.nota || null,
    fecha: f.fecha,
    hora: f.hora || null,
    asignado_id: f.asignado_id || null,
  });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (tarea) await patch(`/tareas/${tarea.id}${query}`, datos());
      else await post(`/tareas${query}`, { ...datos(), modelo, registro_id: registroId });
      onGuardado();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function terminar() {
    if (!tarea) return;
    await patch(`/tareas/${tarea.id}${query}`, datos());
    await post(`/tareas/${tarea.id}/hecha${query}`, { comentario: comentario || null });
    onGuardado();
  }

  async function borrar() {
    if (!tarea || !confirm("¿Eliminar esta actividad?")) return;
    await api(`/tareas/${tarea.id}${query}`, { method: "DELETE" });
    onGuardado();
  }

  return (
    <Modal title={tarea ? "Actividad" : "Programar una actividad"} onClose={onCerrar}>
      <form onSubmit={guardar} className="space-y-4" onClick={(e) => e.stopPropagation()}>
        {tarea?.registro_nombre && (
          <p className="text-sm text-slate-500">
            Sobre: <span className="font-medium text-navy-900">{tarea.registro_nombre}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TIPOS) as TipoTarea[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setF({ ...f, tipo: k })}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ring-1 transition ${f.tipo === k ? TIPOS[k].color + " font-medium" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
            >
              <Icono d={TIPOS[k].icono} className="h-3.5 w-3.5" />
              {TIPOS[k].label}
            </button>
          ))}
        </div>
        <div>
          <label className="label">Resumen</label>
          <input className="input" placeholder={`p. ej. ${f.tipo === "llamada" ? "Llamar para confirmar documentos" : "Revisar contrato"}`} value={f.resumen} onChange={(e) => setF({ ...f, resumen: e.target.value })} maxLength={200} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Fecha límite</label>
            <input type="date" className="input" required value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
          </div>
          <div>
            <label className="label">Hora</label>
            <input type="time" className="input" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="label">Responsable</label>
            <select className="input" value={f.asignado_id} onChange={(e) => setF({ ...f, asignado_id: e.target.value })}>
              <option value="">Yo</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Nota</label>
          <textarea className="input" rows={3} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} />
        </div>
        {tarea && !tarea.hecha_en && (
          <div>
            <label className="label">Comentario al terminar</label>
            <input className="input" placeholder="Opcional" value={comentario} onChange={(e) => setComentario(e.target.value)} />
          </div>
        )}
        {tarea?.hecha_en && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Hecha el {new Date(tarea.hecha_en).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
            {tarea.comentario && <span className="block text-emerald-700">{tarea.comentario}</span>}
          </p>
        )}
        <ErrorBox message={error} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {tarea && (
              <button type="button" className="text-sm text-slate-500 hover:text-red-600 hover:underline" onClick={borrar}>
                Eliminar
              </button>
            )}
          </div>
          <div className="flex gap-3">
            {tarea && !tarea.hecha_en && (
              <button type="button" className="btn-secondary text-emerald-700" onClick={terminar}>
                ✓ Marcar como hecha
              </button>
            )}
            <button type="submit" className="btn-primary">
              {tarea ? "Guardar" : "Programar"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// --- Calendario ---

const iso = (d: Date) => d.toLocaleDateString("en-CA");
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function inicioSemana(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

/** Calendario de actividades (mes o semana). `modelo` limita a un tipo de registro. */
export function Calendario({ query, modelo, extra }: { query: string; modelo?: string; extra?: ReactNode }) {
  const [modo, setModo] = useState<"mes" | "semana">(() => (window.innerWidth < 640 ? "semana" : "mes"));
  const [ref, setRef] = useState(() => new Date());
  const [mias, setMias] = useState(false);
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [form, setForm] = useState<{ tarea: Tarea | null; fecha?: string } | null>(null);
  const sep = query ? "&" : "?";

  const dias = useMemo(() => {
    const ini = modo === "mes" ? inicioSemana(new Date(ref.getFullYear(), ref.getMonth(), 1)) : inicioSemana(ref);
    const n = modo === "mes" ? 42 : 7;
    return Array.from({ length: n }, (_, i) => new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + i));
  }, [modo, ref]);

  const cargar = useCallback(() => {
    const p = new URLSearchParams({ desde: iso(dias[0]), hasta: iso(dias[dias.length - 1]) });
    if (modelo) p.set("modelo", modelo);
    if (mias) p.set("mias", "true");
    get<Tarea[]>(`/tareas/calendario${query}${sep}${p}`).then(setTareas);
  }, [dias, modelo, mias, query, sep]);
  useEffect(cargar, [cargar]);

  const porDia = useMemo(() => {
    const m: Record<string, Tarea[]> = {};
    for (const t of tareas) (m[t.fecha] ??= []).push(t);
    return m;
  }, [tareas]);

  function mover(n: number) {
    const r = new Date(ref);
    if (modo === "mes") r.setMonth(r.getMonth() + n, 1);
    else r.setDate(r.getDate() + 7 * n);
    setRef(r);
  }

  const titulo =
    modo === "mes"
      ? ref.toLocaleDateString("es-MX", { month: "long", year: "numeric" })
      : `${dias[0].toLocaleDateString("es-MX", { day: "numeric", month: "short" })} – ${dias[6].toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}`;
  const hoy = hoyISO();

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <button className="btn-icono" onClick={() => mover(-1)} aria-label="Anterior">
            ‹
          </button>
          <button className="btn-secondary py-1.5" onClick={() => setRef(new Date())}>
            Hoy
          </button>
          <button className="btn-icono" onClick={() => mover(1)} aria-label="Siguiente">
            ›
          </button>
          <h2 className="ml-2 text-lg font-semibold capitalize text-navy-900">{titulo}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {extra}
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="accent-brand-500" checked={mias} onChange={(e) => setMias(e.target.checked)} />
            Solo mías
          </label>
          <div className="flex rounded-lg bg-slate-100 p-1">
            {(["mes", "semana"] as const).map((m) => (
              <button key={m} onClick={() => setModo(m)} className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${modo === m ? "bg-white text-navy-900 shadow-sm" : "text-slate-600"}`}>
                {m}
              </button>
            ))}
          </div>
          <button className="btn-primary py-1.5" onClick={() => setForm({ tarea: null, fecha: hoy })}>
            + Actividad
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-xs font-medium uppercase tracking-wide text-slate-500">
        {DIAS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map((d) => {
          const k = iso(d);
          const fuera = modo === "mes" && d.getMonth() !== ref.getMonth();
          const lista = porDia[k] ?? [];
          return (
            <div
              key={k}
              onClick={() => setForm({ tarea: null, fecha: k })}
              className={`group cursor-pointer border-b border-r border-slate-100 p-1.5 transition hover:bg-brand-50/40 ${modo === "mes" ? "min-h-24 sm:min-h-28" : "min-h-64"} ${fuera ? "bg-slate-50/60" : ""}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${k === hoy ? "bg-brand-500 font-semibold text-white" : fuera ? "text-slate-300" : "text-slate-600"}`}>{d.getDate()}</span>
                <span className="hidden text-xs text-brand-500 group-hover:inline">+</span>
              </div>
              <div className="space-y-1">
                {lista.slice(0, modo === "mes" ? 3 : 20).map((t) => (
                  <button
                    key={t.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setForm({ tarea: t });
                    }}
                    title={`${TIPOS[t.tipo].label}: ${t.resumen}${t.registro_nombre ? ` · ${t.registro_nombre}` : ""}`}
                    className={`flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] ring-1 ${TIPOS[t.tipo].color} ${t.hecha_en ? "line-through opacity-50" : ""} ${!t.hecha_en && t.fecha < hoy ? "ring-red-300" : ""}`}
                  >
                    <Icono d={TIPOS[t.tipo].icono} className="h-3 w-3 shrink-0" />
                    {t.hora && <span className="font-semibold">{horaCorta(t.hora)}</span>}
                    <span className="truncate">{t.resumen}</span>
                  </button>
                ))}
                {modo === "mes" && lista.length > 3 && <p className="px-1 text-[11px] font-medium text-slate-500">+{lista.length - 3} más</p>}
              </div>
            </div>
          );
        })}
      </div>
      {form && (
        <FormActividad
          tarea={form.tarea}
          fecha={form.fecha}
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

/** Pendientes por registro de un modelo (para pintar los relojes de una lista). */
export function useResumenActividades(modelo: string | undefined, query: string, listo = true) {
  const [resumen, setResumen] = useState<Record<string, ResumenTarea>>({});
  const sep = query ? "&" : "?";
  const recargar = useCallback(() => {
    if (!modelo || !listo) return;
    get<Record<string, ResumenTarea>>(`/tareas/resumen${query}${sep}modelo=${modelo}`)
      .then(setResumen)
      .catch(() => setResumen({}));
  }, [modelo, query, sep, listo]);
  useEffect(recargar, [recargar]);
  return { resumen, recargar };
}
