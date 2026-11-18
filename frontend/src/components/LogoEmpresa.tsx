import { useState } from "react";
import { api, urlLogo } from "../lib/api";
import { Ayuda, ErrorBox, ImagenEditable } from "./ui";

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
        <ImagenEditable onCambiar={subir} onQuitar={version ? quitar : undefined}>
          <div className="flex h-20 w-40 items-center justify-center overflow-hidden rounded-lg bg-white p-2 ring-1 ring-slate-200">
            {version ? (
              <img src={urlLogo(empresaId, version)} alt="Logo de la empresa" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-center text-xs text-slate-400">{subiendo ? "Subiendo…" : "Sin logo"}</span>
            )}
          </div>
        </ImagenEditable>
        <Ayuda texto="PNG con fondo transparente, de preferencia. Pasa el mouse sobre el logo para cambiarlo o quitarlo." />
      </div>
      <ErrorBox message={error} />
    </div>
  );
}
