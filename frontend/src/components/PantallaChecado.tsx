import type { ReactNode } from "react";
import Icono, { type NombreIcono } from "./Iconos";

/**
 * Pantalla de checado (igual en la tablet del kiosco y en el celular): foto y nombre, horas
 * trabajadas en la jornada y los botones. Solo se activa el que toca; los de comida aparecen
 * solo con horario quebrado.
 */

export type Accion = "entrada" | "salida_comida" | "regreso_comida" | "salida";
export interface MarcaHoy {
  tipo: string;
  momento: string;
  comida?: boolean;
}

export const ACCIONES: Record<Accion, { titulo: string; detalle: string; icono: NombreIcono; tono: string; listo: string }> = {
  entrada: { titulo: "Entrada", detalle: "Registrar tu llegada", icono: "log-in", tono: "bg-emerald-100 text-emerald-700", listo: "Entrada registrada" },
  salida_comida: { titulo: "Salida a comer", detalle: "Tomar tu descanso", icono: "coffee", tono: "bg-amber-100 text-amber-700", listo: "Buen provecho" },
  regreso_comida: { titulo: "Regreso de comida", detalle: "Continuar tu jornada", icono: "rotate-ccw", tono: "bg-violet-100 text-violet-700", listo: "Regreso registrado" },
  salida: { titulo: "Salida", detalle: "Finalizar tu jornada", icono: "log-out", tono: "bg-rose-100 text-rose-700", listo: "Salida registrada" },
};

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

const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
const horaCorta = (iso: string, tz?: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: tz });

function etiquetaMarca(m: MarcaHoy) {
  if (m.comida) return m.tipo === "salida" ? "Comida" : "Regreso";
  return m.tipo === "entrada" ? "Entrada" : "Salida";
}

export default function PantallaChecado({
  nombre,
  subtitulo,
  foto,
  marcas,
  acciones,
  tz,
  ahora,
  ocupado,
  grande = false,
  onAccion,
}: {
  nombre: string;
  subtitulo?: string;
  foto: ReactNode;
  marcas: MarcaHoy[];
  acciones: { accion: Accion; habilitada: boolean }[];
  tz?: string;
  ahora: Date;
  ocupado?: boolean;
  /** Tamaño tablet (botones más altos). */
  grande?: boolean;
  onAccion: (a: Accion) => void;
}) {
  const trabajado = minutosTrabajados(marcas, ahora);
  const dentro = marcas.length > 0 && marcas[marcas.length - 1].tipo === "entrada";
  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-4 p-4 sm:p-5">
        <div className="shrink-0">{foto}</div>
        <div className="min-w-0 flex-1">
          <p className={`truncate font-bold text-tinta-900 ${grande ? "text-2xl" : "text-lg"}`}>{nombre}</p>
          {subtitulo && <p className="truncate text-sm text-slate-500">{subtitulo}</p>}
          {marcas.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {marcas.map((m) => (
                <span key={m.momento} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  {etiquetaMarca(m)} {horaCorta(m.momento, tz)}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Hoy llevas</p>
          <p className={`font-bold tabular-nums ${dentro ? "text-emerald-600" : "text-tinta-900"} ${grande ? "text-4xl" : "text-2xl"}`}>{hm(trabajado)}</p>
          <p className="text-xs text-slate-500">{dentro ? "En jornada" : marcas.length ? "Fuera" : "Sin registros"}</p>
        </div>
      </div>

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
