import { useEffect, useState } from "react";
import { imagenProtegida } from "../lib/api";

export default function FotoChecada({ checadaId, query = "", className = "" }: { checadaId: string; query?: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let actual: string | null = null;
    imagenProtegida(`/checadas/${checadaId}/foto${query}`)
      .then((u) => {
        actual = u;
        setUrl(u);
      })
      .catch(() => setError(true));
    return () => {
      if (actual) URL.revokeObjectURL(actual);
    };
  }, [checadaId, query]);
  if (error) return <p className="text-xs text-slate-400">No se pudo cargar la foto.</p>;
  if (!url) return <div className={`animate-pulse rounded-lg bg-slate-100 ${className}`} />;
  return <img src={url} alt="Foto tomada al checar" className={`rounded-lg object-cover ${className}`} />;
}
