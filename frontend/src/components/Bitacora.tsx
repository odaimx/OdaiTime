import { useCallback, useEffect, useState, type FormEvent } from "react";
import { fechaHora, get, post, type Actividad } from "../lib/api";

const iniciales = (n: string) =>
  n
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

/** Historial de cambios y notas de un registro (tipo chatter de Odoo). */
export default function Bitacora({ modelo, registroId, query = "", recargar = 0 }: { modelo: string; registroId: string; query?: string; recargar?: number }) {
  const [items, setItems] = useState<Actividad[] | null>(null);
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const sep = query ? "&" : "?";

  const cargar = useCallback(() => {
    get<Actividad[]>(`/actividad${query}${sep}modelo=${modelo}&registro_id=${registroId}`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [modelo, registroId, query, sep]);
  useEffect(cargar, [cargar, recargar]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!nota.trim()) return;
    setEnviando(true);
    try {
      await post(`/actividad${query}`, { modelo, registro_id: registroId, mensaje: nota.trim() });
      setNota("");
      cargar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={enviar} className="space-y-2">
        <label className="sr-only" htmlFor={`nota-${registroId}`}>
          Agregar nota
        </label>
        <textarea id={`nota-${registroId}`} className="input min-h-16 resize-y" placeholder="Escribe una nota interna…" value={nota} onChange={(e) => setNota(e.target.value)} />
        {nota.trim() && (
          <div className="flex justify-end">
            <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={enviando}>
              Registrar nota
            </button>
          </div>
        )}
      </form>

      {items === null && <p className="text-sm text-slate-500">Cargando historial…</p>}
      {items?.length === 0 && <p className="text-sm text-slate-500">Sin movimientos todavía.</p>}
      <ol className="space-y-4">
        {items?.map((a) => (
          <li key={a.id} className="flex gap-3">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                a.usuario ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"
              }`}
              aria-hidden="true"
            >
              {a.usuario ? iniciales(a.usuario.nombre) : "OT"}
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p>
                <span className="font-medium text-tinta-900">{a.usuario?.nombre ?? "Sistema"}</span>{" "}
                <span className="text-xs text-slate-500">· {fechaHora(a.created_at)}</span>
              </p>
              {a.mensaje && <p className={`mt-1 whitespace-pre-line text-slate-700 ${a.tipo === "nota" ? "rounded-lg bg-slate-50 px-3 py-2" : ""}`}>{a.mensaje}</p>}
              {a.cambios && (
                <ul className="mt-1 space-y-0.5">
                  {a.cambios.map((c) => (
                    <li key={c.campo} className="text-slate-600">
                      {c.etiqueta}: <span className="text-slate-400 line-through decoration-slate-300">{c.antes ?? "—"}</span>{" "}
                      <span aria-hidden="true">→</span> <span className="font-medium text-tinta-900">{c.despues ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
