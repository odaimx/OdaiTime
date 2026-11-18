import { useState } from "react";
import { api, urlFondo } from "../lib/api";
import Icono from "./Iconos";
import { ErrorBox } from "./ui";

const SUGERIDOS = ["#ffffff", "#f8fafc", "#f1ecfc", "#eaf4fe", "#fdf6e9", "#eef7f1", "#13204a"];

/** Fondo principal de la empresa: un color o una imagen. Se ve detrás de las pantallas y en su login. */
export default function FondoEmpresa({
  empresaId,
  color,
  version,
  query = "",
  onCambio,
}: {
  empresaId: string;
  color: string | null | undefined;
  version: string | null | undefined;
  query?: string;
  onCambio: (f: { fondo_color: string | null; fondo_version: string | null }) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  async function ejecutar(f: () => Promise<{ fondo_color: string | null; fondo_version: string | null }>) {
    setError(null);
    try {
      onCambio(await f());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const ponerColor = (c: string) => ejecutar(() => api(`/tenant/fondo/color${query}`, { method: "PUT", body: JSON.stringify({ color: c }) }));
  async function subir(archivo: File) {
    setSubiendo(true);
    const body = new FormData();
    body.append("archivo", archivo);
    await ejecutar(() => api(`/tenant/fondo/imagen${query}`, { method: "PUT", body }));
    setSubiendo(false);
  }

  const vista = version ? { backgroundImage: `url(${urlFondo(empresaId, version)})`, backgroundSize: "cover", backgroundPosition: "center" } : { backgroundColor: color ?? "#ffffff" };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="h-20 w-36 shrink-0 rounded-lg ring-1 ring-slate-200" style={vista} aria-label="Vista previa del fondo" />
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {SUGERIDOS.map((c) => (
              <button key={c} type="button" onClick={() => ponerColor(c)} className={`h-7 w-7 rounded-full ring-1 ring-slate-300 ${color === c ? "ring-2 ring-brand-500 ring-offset-1" : ""}`} style={{ backgroundColor: c }} aria-label={`Color ${c}`} />
            ))}
            <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full ring-1 ring-slate-300" title="Otro color" style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}>
              <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={color ?? "#ffffff"} onChange={(e) => ponerColor(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="inline-flex cursor-pointer items-center gap-1 font-medium text-brand-600 hover:underline">
              <Icono nombre="image" className="h-4 w-4" /> {subiendo ? "Subiendo…" : "Usar una imagen"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])} />
            </label>
            {(color || version) && (
              <button type="button" className="text-slate-500 hover:text-red-600 hover:underline" onClick={() => ejecutar(() => api(`/tenant/fondo${query}`, { method: "DELETE" }))}>
                Quitar fondo
              </button>
            )}
          </div>
        </div>
      </div>
      <ErrorBox message={error} />
    </div>
  );
}
