import { Link, Navigate } from "react-router";
import { FotoUsuario, PageHeader } from "../components/ui";
import { useAuth } from "../lib/auth";
import { usePortal } from "../lib/portal";

/** Entrada del portal del trabajador: si puede checar va directo a "Checar". */
export default function InicioPortal() {
  const { usuario } = useAuth();
  const p = usePortal(true);
  if (!p) return <p className="p-6 text-sm text-slate-500">Cargando…</p>;
  if (p.checar) return <Navigate to="/checar" replace />;
  return (
    <>
      <PageHeader icono="house" title="Portal" />
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex flex-col items-center rounded-3xl bg-navy-900 p-6 text-center text-white">
          <FotoUsuario className="mb-4 h-36 w-36" />
          <p className="text-lg font-semibold">Hola, {usuario?.nombre.split(" ")[0]}</p>
        </div>
        <div className="card space-y-2 p-6 text-center">
          <p className="text-lg font-semibold text-tinta-900">El checado desde el celular no está habilitado</p>
          <p className="text-sm text-slate-600">
            Checa en el kiosco o reloj de tu sucursal. Si debes checar desde tu teléfono, pide a tu administrador que lo active.
          </p>
        </div>
        {p.historial && (
          <Link to="/mis-registros" className="btn-primary flex w-full justify-center py-3">
            Ver mis registros
          </Link>
        )}
      </div>
    </>
  );
}
