import { Navigate } from "react-router";
import { PageHeader } from "../components/ui";
import { usePortal } from "../lib/portal";

/** Entrada del portal del trabajador: lleva a lo que su empresa le permite. */
export default function InicioPortal() {
  const p = usePortal(true);
  if (!p) return <p className="p-6 text-sm text-slate-500">Cargando…</p>;
  if (p.checar) return <Navigate to="/checar" replace />;
  if (p.historial) return <Navigate to="/mis-registros" replace />;
  return (
    <>
      <PageHeader icono="house" title="Portal" />
      <div className="card mx-auto max-w-md p-6 text-center text-sm text-slate-600">Tu empresa todavía no habilitó opciones en el portal. Si necesitas consultar tu asistencia, pregunta a tu administrador.</div>
    </>
  );
}
