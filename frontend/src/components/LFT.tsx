import { useEffect, useRef, useState, type ReactNode } from "react";
import Icono from "./Iconos";

/** Fuentes oficiales. La Cámara de Diputados publica el texto vigente con todas sus reformas. */
export const LFT_URL = "https://www.diputados.gob.mx/LeyesBiblio/ref/lft.htm";
export const LFT_PDF = "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf";
export const STPS_URL = "https://www.gob.mx/stps";

/** "art. 61" con liga al texto oficial de la LFT. */
export function ArticuloLFT({ art, children }: { art: string; children?: ReactNode }) {
  return (
    <a
      href={LFT_PDF}
      target="_blank"
      rel="noopener noreferrer"
      title={`Consultar el artículo ${art} en el texto oficial de la Ley Federal del Trabajo (Cámara de Diputados)`}
      className="font-medium underline decoration-dotted underline-offset-2 hover:decoration-solid"
    >
      {children ?? `art. ${art}`}
    </a>
  );
}

/** Convierte las menciones "art. 61" / "arts. 60 y 61" de un texto en ligas a la LFT. */
export function TextoLFT({ texto }: { texto: string }) {
  const partes = texto.split(/(arts?\. \d+(?:(?:,| y) \d+)*)/g);
  return (
    <>
      {partes.map((p, i) =>
        /^arts?\. \d/.test(p) ? (
          <ArticuloLFT key={i} art={p.replace(/^arts?\. /, "")}>
            {p}
          </ArticuloLFT>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** Ícono de balanza que abre las fuentes oficiales (LFT y STPS) de la pantalla. */
/** `oscuro`: sobre el encabezado azul. `enGrupo`: como botón del grupo de vistas. */
export function FuentesOficiales({ articulos, oscuro = false, enGrupo = false }: { articulos?: string; oscuro?: boolean; enGrupo?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [abierto]);
  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        title="Fuentes oficiales (Ley Federal del Trabajo)"
        aria-label="Fuentes oficiales"
        className={
          enGrupo
            ? abierto
              ? "btn-vista-activo"
              : "btn-vista"
            : `flex h-8 w-8 items-center justify-center rounded-full transition ${
                oscuro ? "text-oro-300/80 hover:bg-white/10 hover:text-oro-300" : abierto ? "bg-brand-100 text-brand-700" : "text-slate-400 hover:bg-brand-50 hover:text-brand-600"
              }`
        }
      >
        <Icono nombre="scale" className={enGrupo ? "h-4 w-4" : "h-5 w-5"} />
      </button>
      {abierto && (
        <div className={`absolute top-10 z-40 w-72 ${enGrupo ? "right-0" : "left-0"} rounded-xl bg-white p-4 text-sm shadow-xl ring-1 ring-slate-200`}>
          <p className="mb-1 font-semibold text-navy-900">Fuentes oficiales</p>
          {articulos && <p className="mb-3 text-xs text-slate-500">Aplica: {articulos}</p>}
          <ul className="space-y-2">
            <li>
              <a href={LFT_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
                Ley Federal del Trabajo, texto vigente ↗
              </a>
              <p className="text-xs text-slate-500">Cámara de Diputados, con todas sus reformas</p>
            </li>
            <li>
              <a href={LFT_PDF} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
                LFT en PDF ↗
              </a>
            </li>
            <li>
              <a href={STPS_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
                Secretaría del Trabajo (STPS) ↗
              </a>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
