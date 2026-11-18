import type { ReactNode } from "react";

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

/** Nota para las pantallas donde aplica la LFT. */
export function FuenteLFT({ articulos, className = "" }: { articulos?: string; className?: string }) {
  return (
    <p className={`flex flex-wrap items-center gap-x-1 text-xs text-slate-500 ${className}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 006 0zM17 7l-3 7a3 3 0 006 0z" />
      </svg>
      Basado en la Ley Federal del Trabajo{articulos && ` (${articulos})`}. Consulta la fuente oficial:
      <a href={LFT_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
        texto vigente (Cámara de Diputados)
      </a>
      ·
      <a href={STPS_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
        STPS
      </a>
    </p>
  );
}
