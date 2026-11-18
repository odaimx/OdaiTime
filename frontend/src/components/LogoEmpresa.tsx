import { useState } from "react";
import { api, urlLogo } from "../lib/api";
import { ErrorBox } from "./ui";

/** Logo de la empresa con botones para subirlo o quitarlo. Se ve en el login del
 * subdominio, en el menú y en los reportes. */
export default function LogoEmpresa({
  empresaId,
  version,
  query = "",
  onCambio,
}: {
  empresaId: string;
  version: string | null;
  query?: string;
  onCambio: (version: string | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  async function subir(archivo: File) {
    setError(null);
    setSubiendo(true);
    try {
      const body = new FormData();
      body.append("archivo", archivo);
      const r = await api<{ logo_version: string | null }>(`/tenant/logo${query}`, { method: "PUT", body });
      onCambio(r.logo_version);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  async function quitar() {
    setError(null);
    const r = await api<{ logo_version: string | null }>(`/tenant/logo${query}`, { method: "DELETE" });
    onCambio(r.logo_version);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex h-20 w-40 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-white p-2 hover:border-brand-400" title="Subir logo">
          {version ? (
            <img src={urlLogo(empresaId, version)} alt="Logo de la empresa" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-center text-xs text-slate-500">{subiendo ? "Subiendo…" : "Sin logo"}</span>
          )}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])} />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label className="cursor-pointer font-medium text-brand-600 hover:underline">
            {version ? "Cambiar logo" : "Subir logo"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])} />
          </label>
          {version && (
            <button type="button" className="text-left text-slate-500 hover:text-red-600 hover:underline" onClick={quitar}>
              Quitar
            </button>
          )}
          <span className="text-xs text-slate-500">PNG con fondo transparente, de preferencia.</span>
        </div>
      </div>
      <ErrorBox message={error} />
    </div>
  );
}
