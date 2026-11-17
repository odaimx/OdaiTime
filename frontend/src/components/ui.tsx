import { useEffect, useState, type ReactNode } from "react";
import { get, type Empresa } from "../lib/api";
import { useAuth } from "../lib/auth";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-900/40 p-4 pt-16" onMouseDown={onClose}>
      <div className="card w-full max-w-lg p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-navy-900" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{message}</p>;
}

export function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Empresa sobre la que se trabaja. Los usuarios de una empresa usan la suya;
 * el superadmin elige una del selector. Devuelve el query string para la API.
 */
export function useEmpresaScope() {
  const { usuario } = useAuth();
  const esSuper = usuario?.rol === "superadmin";
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState<string | null>(usuario?.empresa?.id ?? null);

  useEffect(() => {
    if (!esSuper) return;
    get<Empresa[]>("/empresas").then((list) => {
      setEmpresas(list);
      setEmpresaId((actual) => actual ?? list[0]?.id ?? null);
    });
  }, [esSuper]);

  const selector = esSuper ? (
    <select className="input w-64" value={empresaId ?? ""} onChange={(e) => setEmpresaId(e.target.value)}>
      {empresas.length === 0 && <option value="">Sin empresas</option>}
      {empresas.map((e) => (
        <option key={e.id} value={e.id}>
          {e.nombre}
        </option>
      ))}
    </select>
  ) : null;

  const query = esSuper && empresaId ? `?empresa_id=${empresaId}` : "";
  const listo = !esSuper || empresaId !== null;
  return { query, listo, selector, empresaId };
}
