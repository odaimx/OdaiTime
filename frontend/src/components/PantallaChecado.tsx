import { useEffect, useRef, type ReactNode } from "react";
import Icono, { type NombreIcono } from "./Iconos";
import { urlLogo } from "../lib/api";

/**
 * Pantalla de checado (igual en la tablet del kiosco y en el celular):
 *   encabezado con el logo (color del menú del panel) · reloj verde con la fecha ·
 *   foto, nombre, sucursal y GPS · horas laboradas con barra · aviso · botones.
 * Solo se activa el botón que toca; los de comida aparecen solo con horario quebrado.
 */

export type Accion = "entrada" | "salida_comida" | "regreso_comida" | "salida";
export interface MarcaHoy {
  tipo: string;
  momento: string;
  comida?: boolean;
}
export interface Bloque {
  entrada: string;
  salida: string;
}
/** Distancia al centro de la cerca (sucursal u obra) y su radio. */
export type EstadoGps = { metros: number; radio: number } | "buscando" | { error: string } | null;

export const ACCIONES: Record<Accion, { titulo: string; detalle: string; icono: NombreIcono; tono: string; listo: string }> = {
  entrada: { titulo: "Entrada", detalle: "Registrar tu llegada", icono: "log-in", tono: "bg-emerald-100 text-emerald-700", listo: "Entrada registrada" },
  salida_comida: { titulo: "Salida a comer", detalle: "Tomar tu descanso", icono: "coffee", tono: "bg-amber-100 text-amber-700", listo: "Buen provecho" },
  regreso_comida: { titulo: "Regreso de comida", detalle: "Continuar tu jornada", icono: "rotate-ccw", tono: "bg-violet-100 text-violet-700", listo: "Regreso registrado" },
  salida: { titulo: "Salida", detalle: "Finalizar tu jornada", icono: "log-out", tono: "bg-rose-100 text-rose-700", listo: "Salida registrada" },
};

/** Verde pera del reloj. */
const VERDE_PERA = "#8cc63f";

/** Minutos trabajados en la jornada: pares entrada–salida; una entrada abierta cuenta hasta ahora. */
export function minutosTrabajados(marcas: MarcaHoy[], ahora: Date): number {
  let total = 0;
  let abierta: number | null = null;
  for (const m of [...marcas].sort((a, b) => a.momento.localeCompare(b.momento))) {
    const t = new Date(m.momento).getTime();
    if (m.tipo === "entrada") abierta = t;
    else if (abierta !== null) {
      total += t - abierta;
      abierta = null;
    }
  }
  if (abierta !== null) total += Math.max(0, ahora.getTime() - abierta);
  return Math.floor(total / 60000);
}

/** Minutos que marca el turno de hoy (suma de sus bloques; un bloque nocturno cruza la medianoche). */
export function minutosPlaneados(bloques: Bloque[] | null | undefined): number {
  const min = (h: string) => {
    const [hh, mm] = h.split(":").map(Number);
    return hh * 60 + (mm || 0);
  };
  return (bloques ?? []).reduce((t, b) => {
    const d = min(b.salida) - min(b.entrada);
    return t + (d > 0 ? d : d + 1440);
  }, 0);
}

/** Distancia en metros entre dos coordenadas (haversine). */
export function distanciaM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (g: number) => (g * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** "Martes 24 de octubre del 2026". */
export function fechaLarga(d: Date, tz?: string): string {
  const partes = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const dia = v("weekday");
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${v("day")} de ${v("month")} del ${v("year")}`;
}

const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
const horaCorta = (iso: string, tz?: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: tz });

function etiquetaMarca(m: MarcaHoy) {
  if (m.comida) return m.tipo === "salida" ? "Comida" : "Regreso";
  return m.tipo === "entrada" ? "Entrada" : "Salida";
}

// ------------------------------------------------------------------ Piezas

/** Rectángulo del título con el logo de la empresa, del mismo color que el menú del panel. */
export function EncabezadoEmpresa({ nombre, empresaId, logoVersion, detalle, derecha }: { nombre?: string | null; empresaId?: string | null; logoVersion?: string | null; detalle?: ReactNode; derecha?: ReactNode }) {
  return (
    <header className="flex items-center gap-3 rounded-2xl bg-navy-950 px-4 py-3 text-white shadow-sm">
      {empresaId && logoVersion ? (
        <span className="flex h-11 max-w-[9rem] shrink-0 items-center rounded-lg bg-white px-2 py-1">
          <img src={urlLogo(empresaId, logoVersion)} alt="" className="max-h-full max-w-full object-contain" />
        </span>
      ) : (
        <img src="/logo.png" alt="ODAI" className="h-8 shrink-0" />
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate font-semibold text-oro-400">{nombre ?? "Registro de asistencia"}</p>
        {detalle && <p className="truncate text-xs text-slate-300">{detalle}</p>}
      </div>
      {derecha}
    </header>
  );
}

/** Hora actual grande en verde pera y la fecha completa debajo. */
export function Reloj({ ahora, tz, grande = false }: { ahora: Date; tz?: string; grande?: boolean }) {
  return (
    <div className="min-w-0 text-right leading-tight">
      <p className={`font-bold tabular-nums tracking-tight ${grande ? "text-6xl" : "text-5xl"}`} style={{ color: VERDE_PERA }}>
        {ahora.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz })}
        <span className={grande ? "text-2xl" : "text-xl"}>:{String(ahora.getSeconds()).padStart(2, "0")}</span>
      </p>
      <p className={`text-slate-500 ${grande ? "text-base" : "text-xs"}`}>{fechaLarga(ahora, tz)}</p>
    </div>
  );
}

/** Aviso de resultado o de error, con X para cerrar. Los errores duran más en pantalla. */
export function AvisoChecado({ ok, texto, detalle, onCerrar }: { ok: boolean; texto: string; detalle?: string; onCerrar: () => void }) {
  // La pantalla se repinta cada segundo (reloj): el temporizador no depende de onCerrar.
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;
  useEffect(() => {
    const t = setTimeout(() => cerrar.current(), ok ? 6000 : 25000);
    return () => clearTimeout(t);
  }, [ok, texto]);
  return (
    <div role={ok ? "status" : "alert"} className={`flex items-start gap-3 rounded-2xl p-4 ring-1 ${ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-800 ring-red-200"}`}>
      <Icono nombre={ok ? "check" : "triangle-exclamation-point"} className="mt-0.5 h-6 w-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{texto}</p>
        {detalle && <p className="text-sm opacity-80">{detalle}</p>}
      </div>
      <button type="button" onClick={onCerrar} className="-m-1 rounded-lg p-2 hover:bg-black/5" aria-label="Cerrar aviso">
        <Icono nombre="x" className="h-5 w-5" />
      </button>
    </div>
  );
}

function LineaGps({ gps }: { gps: EstadoGps }) {
  if (gps === null) return null;
  if (gps === "buscando") return <p className="text-xs text-slate-500">Buscando GPS…</p>;
  if ("error" in gps) return <p className="text-xs text-red-600">{gps.error}</p>;
  const dentro = gps.metros <= gps.radio;
  return (
    <p className={`flex items-center gap-1 text-xs font-medium ${dentro ? "text-emerald-600" : "text-red-600"}`}>
      <Icono nombre="map-pin" className="h-3.5 w-3.5" />
      {dentro ? "GPS OK" : "Fuera de la cerca"} · {gps.metros.toFixed(1)} m
    </p>
  );
}

// ------------------------------------------------------------------ Pantalla

export default function PantallaChecado({
  nombre,
  subtitulo,
  gps = null,
  foto,
  marcas,
  acciones,
  bloques,
  tz,
  ahora,
  ocupado,
  grande = false,
  aviso,
  onAccion,
}: {
  nombre: string;
  /** Sucursal (u obra) donde checa. */
  subtitulo?: string;
  gps?: EstadoGps;
  foto: ReactNode;
  marcas: MarcaHoy[];
  acciones: { accion: Accion; habilitada: boolean }[];
  /** Bloques del turno de hoy, para la barra de horas. */
  bloques?: Bloque[] | null;
  tz?: string;
  ahora: Date;
  ocupado?: boolean;
  /** Tamaño tablet (botones más altos). */
  grande?: boolean;
  /** Aviso de resultado o de error, arriba de los botones. */
  aviso?: ReactNode;
  onAccion: (a: Accion) => void;
}) {
  const trabajado = minutosTrabajados(marcas, ahora);
  const planeado = minutosPlaneados(bloques);
  const dentro = marcas.length > 0 && marcas[marcas.length - 1].tipo === "entrada";
  const pct = planeado ? Math.min(100, Math.round((trabajado / planeado) * 100)) : dentro ? 100 : 0;
  return (
    <div className="space-y-4">
      {/* Foto a la derecha y, a un costado, nombre, sucursal y GPS. */}
      <div className="card flex flex-row-reverse items-stretch gap-4 p-2">
        {/* La foto ocupa casi todo el alto del rectángulo, en su propio marco. */}
        <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200 ${grande ? "h-36 w-32" : "h-28 w-24"}`}>{foto}</div>
        <div className="min-w-0 flex-1 space-y-0.5 self-center py-2 pl-2">
          <p className={`font-bold leading-tight text-tinta-900 ${grande ? "text-3xl" : "text-xl"}`}>{nombre}</p>
          {subtitulo && <p className="truncate text-sm text-slate-500">{subtitulo}</p>}
          <LineaGps gps={gps} />
        </div>
      </div>

      <div className="card space-y-2 p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-tinta-900">Horas laboradas</p>
          <p className="text-sm text-slate-500">
            <span className={`font-bold tabular-nums ${grande ? "text-3xl" : "text-2xl"} ${dentro ? "text-emerald-600" : "text-tinta-900"}`}>{hm(trabajado)}</span>
            {planeado > 0 && <span> de {hm(planeado)} h</span>}
          </p>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la jornada">
          <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, backgroundColor: VERDE_PERA }} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500">{dentro ? "En jornada" : marcas.length ? "Fuera" : "Sin registros hoy"}</span>
          {marcas.map((m) => (
            <span key={m.momento} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {etiquetaMarca(m)} {horaCorta(m.momento, tz)}
            </span>
          ))}
        </div>
      </div>

      {aviso}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {acciones.map(({ accion, habilitada }) => {
          const a = ACCIONES[accion];
          return (
            <button
              key={accion}
              type="button"
              disabled={!habilitada || ocupado}
              onClick={() => onAccion(accion)}
              className={`card flex items-center gap-4 p-4 text-left transition ${grande ? "sm:p-6" : ""} ${
                habilitada ? "ring-2 ring-transparent hover:ring-brand-300 active:scale-[0.98]" : "cursor-not-allowed opacity-40 grayscale"
              }`}
            >
              <span className={`flex shrink-0 items-center justify-center rounded-2xl ${a.tono} ${grande ? "h-16 w-16" : "h-12 w-12"}`}>
                <Icono nombre={a.icono} className={grande ? "h-8 w-8" : "h-6 w-6"} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block font-bold text-tinta-900 ${grande ? "text-xl" : "text-base"}`}>{a.titulo}</span>
                <span className="block text-sm text-slate-500">{a.detalle}</span>
              </span>
              {habilitada && <Icono nombre="chevron-right" className="h-5 w-5 shrink-0 text-slate-400" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
