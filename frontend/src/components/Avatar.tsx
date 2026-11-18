import { useEffect, useState } from "react";
import { imagenProtegida } from "../lib/api";

const iniciales = (n: string) =>
  n
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

// Colores de las iniciales (como Odoo): siempre el mismo para la misma persona.
const COLORES = ["bg-orange-400", "bg-teal-500", "bg-amber-600", "bg-purple-600", "bg-sky-600", "bg-rose-500", "bg-emerald-600", "bg-indigo-500"];
const colorDe = (n: string) => COLORES[[...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORES.length];

/** Foto del empleado o sus iniciales. Pide la miniatura de 128 px para tamaños chicos
 * (listados) y la de 512 px para la ficha. `version` cambia cuando se actualiza la foto. */
export default function Avatar({ empleadoId, nombre, version, query = "", tam = 40, cuadrado = false }: { empleadoId: string; nombre: string; version: string | null; query?: string; tam?: number; cuadrado?: boolean }) {
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
    <img src={url} alt={`Foto de ${nombre}`} style={estilo} className={`shrink-0 object-cover ${cuadrado ? "rounded-md" : "rounded-full ring-2 ring-white"}`} />
  ) : (
    <span style={estilo} className={`flex shrink-0 items-center justify-center font-semibold text-white ${colorDe(nombre)} ${cuadrado ? "rounded-md" : "rounded-full"}`} aria-hidden="true">
      {iniciales(nombre)}
    </span>
  );
}
