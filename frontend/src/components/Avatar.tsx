import { useEffect, useState } from "react";
import { imagenProtegida } from "../lib/api";

const iniciales = (n: string) =>
  n
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

/** Foto del empleado o sus iniciales. Pide la miniatura de 128 px para tamaños chicos
 * (listados) y la de 512 px para la ficha. `version` cambia cuando se actualiza la foto. */
export default function Avatar({ empleadoId, nombre, version, query = "", tam = 40 }: { empleadoId: string; nombre: string; version: string | null; query?: string; tam?: number }) {
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

  const estilo = { width: tam, height: tam, fontSize: Math.max(11, tam * 0.36) };
  return url ? (
    <img src={url} alt={`Foto de ${nombre}`} style={estilo} className="shrink-0 rounded-full object-cover ring-2 ring-white" />
  ) : (
    <span style={estilo} className="flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700" aria-hidden="true">
      {iniciales(nombre)}
    </span>
  );
}
