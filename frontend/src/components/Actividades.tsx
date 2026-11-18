import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Icono, { type NombreIcono } from "./Iconos";
import { api, diasHasta, get, hoyISO, patch, post, type Ref, type ResumenTarea, type Tarea, type TipoTarea } from "../lib/api";
import { ErrorBox, Modal } from "./ui";

/**
 * Actividades programadas al estilo Odoo:
 * - <RelojActividad>: el reloj de cada registro (rojo vencida, ámbar hoy, verde próxima).
 * - <FormActividad>: programar o editar una actividad.
 * - <Calendario>: vista de mes o semana con las actividades.
 */

export const TIPOS: Record<TipoTarea, { label: string; icono: NombreIcono; color: string; punto: string }> = {
  llamada: { label: "Llamada", icono: "phone", color: "bg-sky-100 text-sky-800 ring-sky-200", punto: "bg-sky-500" },
  reunion: { label: "Reunión", icono: "users", color: "bg-violet-100 text-violet-800 ring-violet-200", punto: "bg-violet-500" },
  correo: { label: "Correo", icono: "mail", color: "bg-amber-100 text-amber-800 ring-amber-200", punto: "bg-amber-500" },
  tarea: { label: "Tarea", icono: "square-check-big", color: "bg-emerald-100 text-emerald-800 ring-emerald-200", punto: "bg-emerald-500" },
  recordatorio: { label: "Recordatorio", icono: "bell", color: "bg-rose-100 text-rose-800 ring-rose-200", punto: "bg-rose-500" },
};

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
        <Icono nombre="clock" className="h-5 w-5" />
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
                    <Icono nombre={TIPOS[t.tipo].icono} className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-tinta-900">{t.resumen}</p>
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
                    <button className="text-slate-500 hover:text-tinta-900 hover:underline" onClick={() => (flot.cerrar(), setForm(t))}>
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
  hora,
  query,
  onCerrar,
  onGuardado,
}: {
  tarea: Tarea | null;
  modelo?: string | null;
  registroId?: string | null;
  fecha?: string;
  hora?: string;
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
    hora: tarea ? horaCorta(tarea.hora) : (hora ?? ""),
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
            Sobre: <span className="font-medium text-tinta-900">{tarea.registro_nombre}</span>
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
              <Icono nombre={TIPOS[k].icono} className="h-3.5 w-3.5" />
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
