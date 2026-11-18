import { isValidElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { imprimirFormulario } from "../lib/imprimir";
import Icono, { type NombreIcono } from "./Iconos";

/**
 * Ventana de un registro al estilo Odoo, compartida por todas las pantallas:
 * - Flechas ◀ ▶ para ir al registro anterior o siguiente de la lista (también Alt+← / Alt+→).
 * - Guardado automático al cambiar de registro o al cerrar, si hay cambios.
 * - Botón de nube para guardar a mano y botón para descartar los cambios.
 * El aspecto sale de las clases de index.css, igual que el resto del sistema.
 */

type Estado = "guardado" | "sucio" | "guardando" | "error";

export interface AccionRegistro {
  etiqueta: string;
  icono?: NombreIcono;
  onClick: () => void;
  peligro?: boolean;
  separar?: boolean;
}

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
  /** Opciones del menú ⋮ del registro (p. ej. Imprimir ficha, Dar de baja). */
  acciones?: AccionRegistro[];
  /** Reporte propio del registro para "Imprimir" (si no, se arma con los campos en pantalla). */
  onImprimir?: () => void;
  /** Agrega "Imprimir" (copia de la ventana). Se apaga cuando la pantalla tiene su propio reporte. */
  imprimir?: boolean;
  children: ReactNode;
}

export default function Registro({ titulo, subtitulo, indice, total, onIr, sucio = false, onGuardar, onDescartar, onCerrar, ancho = "lg", acciones = [], imprimir = true, onImprimir, children }: Props) {
  const [menu, setMenu] = useState(false);
  const cuerpo = useRef<HTMLDivElement>(null);
  const opciones: AccionRegistro[] = [...acciones, ...(imprimir ? [{ etiqueta: "Imprimir", icono: "printer" as NombreIcono, onClick: onImprimir ?? (() => cuerpo.current && imprimirFormulario(cuerpo.current, textoDe(titulo), textoDe(subtitulo))), separar: acciones.length > 0 }] : [])];
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

  const menuAcciones = (
    <>
            {opciones.length > 0 && (
              <div className="relative">
                <button type="button" onClick={() => setMenu((m) => !m)} title="Acciones" aria-label="Acciones" className={`rounded-lg p-1.5 ${menu ? "bg-white text-tinta-900 ring-1 ring-brand-500" : "text-slate-600 hover:bg-white hover:text-tinta-900"}`}>
                  <Icono nombre="ellipsis-vertical" className="h-5 w-5" />
                </button>
                {menu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                    <div className="popover left-0 top-10 w-56 p-1">
                      {opciones.map((o) => (
                        <div key={o.etiqueta}>
                          {o.separar && <hr className="my-1 border-slate-100" />}
                          <button
                            type="button"
                            className={`menu-item ${o.peligro ? "text-red-600" : ""}`}
                            onClick={() => {
                              setMenu(false);
                              o.onClick();
                            }}
                          >
                            <span className="w-4">{o.icono && <Icono nombre={o.icono} className="h-4 w-4" />}</span>
                            {o.etiqueta}
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
    </>
  );

  const conFlechas = indice !== undefined && total !== undefined && total > 1 && onIr;
  const etiqueta = { guardado: "Guardado", sucio: "Cambios sin guardar", guardando: "Guardando…", error: "No se pudo guardar" }[estado];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy-900/40 p-3 pt-6 sm:p-4 sm:pt-12" onMouseDown={cerrar}>
      <div className={`registro-hoja card flex max-h-[calc(100dvh-3rem)] w-full flex-col overflow-hidden sm:max-h-[calc(100dvh-7rem)] ${ancho === "lg" ? "max-w-5xl" : "max-w-2xl"}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="no-imprimir flex shrink-0 items-center gap-2 rounded-t-xl border-b border-slate-200 bg-slate-100/70 px-4 py-2.5 sm:px-5">
          {menuAcciones}
          {onGuardar && (
            <>
              <button
                type="button"
                onClick={guardar}
                disabled={!sucio || estado === "guardando"}
                title={`${etiqueta} (Ctrl+S)`}
                aria-label="Guardar"
                className={`rounded-lg p-1.5 transition disabled:cursor-default ${estado === "error" || sucio ? "text-red-600 hover:text-red-700" : "text-emerald-600"}`}
              >
                <Icono nombre={sucio || estado === "error" ? "cloud-upload" : "cloud-check"} className="h-5 w-5" />
              </button>
              {sucio && onDescartar && (
                <button type="button" onClick={onDescartar} title="Descartar cambios" aria-label="Descartar cambios" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-tinta-900">
                  <Icono nombre="undo-2" className="h-5 w-5" />
                </button>
              )}
              <span className={`hidden text-xs sm:inline ${estado === "error" || sucio ? "text-red-600" : "text-emerald-600"}`}>{etiqueta}</span>
            </>
          )}

          <div className="ml-auto flex items-center gap-1">
            {conFlechas && (
              <>
                <span className="mr-1 text-xs tabular-nums text-slate-500">
                  {indice + 1} / {total}
                </span>
                <button type="button" onClick={() => ir(indice - 1)} disabled={indice === 0} aria-label="Registro anterior" title="Anterior (Alt+←)" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30">
                  <Icono nombre="chevron-left" className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => ir(indice + 1)} disabled={indice === total - 1} aria-label="Registro siguiente" title="Siguiente (Alt+→)" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30">
                  <Icono nombre="chevron-right" className="h-5 w-5" />
                </button>
              </>
            )}
            <button type="button" onClick={cerrar} aria-label="Cerrar" className="ml-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-tinta-900">
              <Icono nombre="x" className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div ref={cuerpo} className="min-h-0 overflow-y-auto p-5 pb-12 sm:p-8 sm:pb-14">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-tinta-900">{titulo}</h2>
            {subtitulo && <div className="mt-1 text-sm text-slate-500">{subtitulo}</div>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Imprime solo la ventana del registro (se guarda como PDF desde el diálogo del navegador). */
/** Texto plano de un título que puede venir como JSX. */
function textoDe(n: ReactNode): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textoDe).join("");
  if (isValidElement<{ children?: ReactNode }>(n)) return textoDe(n.props.children);
  return "";
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
