import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Ventana de un registro al estilo Odoo, compartida por todas las pantallas:
 * - Flechas ◀ ▶ para ir al registro anterior o siguiente de la lista (también Alt+← / Alt+→).
 * - Guardado automático al cambiar de registro o al cerrar, si hay cambios.
 * - Botón de nube para guardar a mano y botón para descartar los cambios.
 * El aspecto sale de las clases de index.css, igual que el resto del sistema.
 */

type Estado = "guardado" | "sucio" | "guardando" | "error";

interface Props {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  /** Posición actual en la lista (0-based) y total. Sin esto no se muestran flechas. */
  indice?: number;
  total?: number;
  onIr?: (indice: number) => void;
  /** Hay cambios sin guardar. */
  sucio?: boolean;
  /** Guarda; devuelve true si se guardó (si falla, no se cambia de registro ni se cierra). */
  onGuardar?: () => Promise<boolean>;
  onDescartar?: () => void;
  onCerrar: () => void;
  ancho?: "md" | "lg";
  children: ReactNode;
}

function Icono({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const NUBE_SUBIR = "M7 18a4.5 4.5 0 01-.6-8.96A6 6 0 0118 8.5a4 4 0 01-.5 9.5M12 12v8M9 15l3-3 3 3";
const NUBE_OK = "M7 18a4.5 4.5 0 01-.6-8.96A6 6 0 0118 8.5a4 4 0 01-.5 9.5M9.5 15.5l2 2 4-4";
const DESHACER = "M3 7v6h6M3 13a9 9 0 103-6.7L3 9";

export default function Registro({ titulo, subtitulo, indice, total, onIr, sucio = false, onGuardar, onDescartar, onCerrar, ancho = "lg", children }: Props) {
  const [estado, setEstado] = useState<Estado>("guardado");
  const ocupado = useRef(false);

  useEffect(() => {
    if (estado !== "guardando") setEstado(sucio ? "sucio" : "guardado");
  }, [sucio]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = useCallback(async (): Promise<boolean> => {
    if (!sucio || !onGuardar) return true;
    if (ocupado.current) return false;
    ocupado.current = true;
    setEstado("guardando");
    try {
      const ok = await onGuardar();
      setEstado(ok ? "guardado" : "error");
      return ok;
    } catch {
      setEstado("error");
      return false;
    } finally {
      ocupado.current = false;
    }
  }, [sucio, onGuardar]);

  const ir = useCallback(
    async (i: number) => {
      if (!onIr || total === undefined || i < 0 || i >= total) return;
      if (await guardar()) onIr(i);
    },
    [onIr, total, guardar],
  );

  const cerrar = useCallback(async () => {
    if (await guardar()) onCerrar();
  }, [guardar, onCerrar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
      else if (e.altKey && e.key === "ArrowLeft" && indice !== undefined) ir(indice - 1);
      else if (e.altKey && e.key === "ArrowRight" && indice !== undefined) ir(indice + 1);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        guardar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cerrar, ir, guardar, indice]);

  const conFlechas = indice !== undefined && total !== undefined && total > 1 && onIr;
  const etiqueta = { guardado: "Guardado", sucio: "Cambios sin guardar", guardando: "Guardando…", error: "No se pudo guardar" }[estado];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-900/40 p-3 pt-6 sm:p-4 sm:pt-12" onMouseDown={cerrar}>
      <div className={`card w-full ${ancho === "lg" ? "max-w-2xl" : "max-w-lg"}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          {onGuardar && (
            <>
              <button
                type="button"
                onClick={guardar}
                disabled={!sucio || estado === "guardando"}
                title={`${etiqueta} (Ctrl+S)`}
                aria-label="Guardar"
                className={`rounded-lg p-1.5 transition ${sucio ? "bg-brand-500 text-white hover:bg-brand-600" : "text-emerald-600"} disabled:cursor-default ${estado === "error" ? "bg-red-600 text-white" : ""}`}
              >
                <Icono d={sucio || estado === "error" ? NUBE_SUBIR : NUBE_OK} />
              </button>
              {sucio && onDescartar && (
                <button type="button" onClick={onDescartar} title="Descartar cambios" aria-label="Descartar cambios" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-navy-900">
                  <Icono d={DESHACER} />
                </button>
              )}
              <span className={`hidden text-xs sm:inline ${estado === "error" ? "text-red-600" : sucio ? "text-brand-700" : "text-slate-400"}`}>{etiqueta}</span>
            </>
          )}

          <div className="ml-auto flex items-center gap-1">
            {conFlechas && (
              <>
                <span className="mr-1 text-xs tabular-nums text-slate-500">
                  {indice + 1} / {total}
                </span>
                <button type="button" onClick={() => ir(indice - 1)} disabled={indice === 0} aria-label="Registro anterior" title="Anterior (Alt+←)" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30">
                  <Icono d="M15 18l-6-6 6-6" />
                </button>
                <button type="button" onClick={() => ir(indice + 1)} disabled={indice === total - 1} aria-label="Registro siguiente" title="Siguiente (Alt+→)" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30">
                  <Icono d="M9 18l6-6-6-6" />
                </button>
              </>
            )}
            <button type="button" onClick={cerrar} aria-label="Cerrar" className="ml-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-900">
              <Icono d="M18 6L6 18M6 6l12 12" />
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-navy-900">{titulo}</h2>
            {subtitulo && <div className="mt-1 text-sm text-slate-500">{subtitulo}</div>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Estado de un formulario con su versión guardada, para saber si hay cambios. */
export function useFormulario<T>(inicial: T) {
  const [form, setForm] = useState<T>(inicial);
  const [base, setBase] = useState<T>(inicial);
  const cargar = useCallback((v: T) => {
    setForm(v);
    setBase(v);
  }, []);
  const sucio = JSON.stringify(form) !== JSON.stringify(base);
  return { form, setForm, cargar, sucio, descartar: () => setForm(base), marcarGuardado: () => setBase(form) };
}
