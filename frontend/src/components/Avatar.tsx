import { useEffect, useState } from "react";
import { imagenProtegida } from "../lib/api";

/** Foto del empleado (o una silueta tenue), con marco de esquinas redondeadas. Pide la miniatura de 128 px para tamaños chicos
 * (listados) y la de 512 px para la ficha. `version` cambia cuando se actualiza la foto. */
export default function Avatar({ empleadoId, nombre, version, query = "", tam = 40 }: { empleadoId: string; nombre: string; version: string | null; query?: string; tam?: number; /** Ya no aplica: todas llevan marco redondeado. */ cuadrado?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!version) return setUrl(null);
    let actual: string | null = null;
    const sep = query ? "&" : "?";
    const lado = tam <= 64 ? 128 : 512;
    imagenProtegida(`/empleados/${empleadoId}/foto${query}${sep}tam=${lado}&v=${encodeURIComponent(version)}`)
      .then((u) => {
        actual = u;
        setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => {
      if (actual) URL.revokeObjectURL(actual);
    };
  }, [empleadoId, version, query, tam]);

  const estilo = { width: tam, height: tam };
  const marco = `shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200 ${tam >= 64 ? "p-1 shadow-sm" : ""}`;
  // Sin foto: silueta en tono tenue dentro del mismo marco.
  return (
    <span style={estilo} className={`inline-flex ${marco}`} title={url ? undefined : nombre}>
      {url ? (
        <img src={url} alt={`Foto de ${nombre}`} className="h-full w-full rounded-md object-cover" />
      ) : (
        <svg viewBox="0 0 64 64" className="h-full w-full rounded-md bg-slate-100" aria-label={`Sin foto: ${nombre}`} role="img">
          <circle cx="32" cy="24" r="11" fill="#cbd5e1" />
          <path d="M10 60c2-12 11-19 22-19s20 7 22 19" fill="#cbd5e1" />
        </svg>
      )}
    </span>
  );
}
