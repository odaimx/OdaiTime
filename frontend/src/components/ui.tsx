import { useEffect, useState, type ReactNode } from "react";
import { get, type Empresa, type Licencia, type LimiteLicencia } from "../lib/api";
import { useAuth } from "../lib/auth";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  ancho = "md",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  ancho?: "md" | "lg";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-900/40 p-3 pt-6 sm:p-4 sm:pt-16" onMouseDown={onClose}>
      <div className={`card w-full p-5 sm:p-6 ${ancho === "lg" ? "max-w-2xl" : "max-w-lg"}`} onMouseDown={(e) => e.stopPropagation()}>
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
    <select className="input w-full sm:w-64" value={empresaId ?? ""} onChange={(e) => setEmpresaId(e.target.value)}>
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

/** Aviso cuando se llega al límite de la licencia, con liga para comprar más. */
export function AvisoLicencia({ info, onClose }: { info: LimiteLicencia; onClose: () => void }) {
  const vencida = info.codigo === "licencia_vencida";
  return (
    <Modal title={vencida ? "Tu licencia está vencida" : "Ya no hay lugares disponibles"} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-4 rounded-lg bg-brand-50 p-4">
          <div className="text-center">
            <p className="text-3xl font-semibold text-brand-600">
              {info.activos}/{info.max_empleados}
            </p>
            <p className="text-xs text-slate-500">empleados activos</p>
          </div>
          <p className="text-sm text-navy-900">{info.mensaje}</p>
        </div>
        {!vencida && (
          <p className="text-sm text-slate-600">
            Para registrar más empleados amplía tu licencia. También puedes liberar un lugar dando de baja a alguien que ya no labore contigo.
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>
            Ahora no
          </button>
          <a href={info.url_compra} target="_blank" rel="noopener noreferrer" className="btn-primary">
            {vencida ? "Renovar licencia" : "Comprar más licencias"}
          </a>
        </div>
      </div>
    </Modal>
  );
}

/** Barra de uso de la licencia. */
export function UsoLicencia({ lic, compacto = false }: { lic: Licencia; compacto?: boolean }) {
  const pct = Math.min(100, Math.round((lic.activos / lic.max_empleados) * 100));
  const color = lic.vencida || pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-brand-500";
  return (
    <div className={compacto ? "w-full sm:w-56" : ""}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-500">Licencia{lic.vencida && <span className="ml-1 font-medium text-red-600">vencida</span>}</span>
        <span className="font-medium text-navy-900">
          {lic.activos} de {lic.max_empleados} empleados
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {!compacto && lic.disponibles <= Math.max(1, Math.ceil(lic.max_empleados * 0.2)) && (
        <a href={lic.url_compra} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline">
          {lic.disponibles === 0 ? "Sin lugares disponibles · Comprar más" : `Quedan ${lic.disponibles} · Comprar más`}
        </a>
      )}
    </div>
  );
}
