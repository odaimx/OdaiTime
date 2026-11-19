import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "../components/ui";
import { get, ROLES, type AlertaIncapacidad } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTema } from "../lib/tema";

/** Pantalla de inicio: la imagen general de ODAITIME (la define Odai) a todo lo ancho y alto. */
export default function Inicio() {
  const { usuario } = useAuth();
  const tema = useTema();
  const [alertas, setAlertas] = useState<AlertaIncapacidad[]>([]);
  const gestion = !!usuario?.empresa && usuario.rol !== "empleado";
  useEffect(() => {
    if (gestion) get<AlertaIncapacidad[]>("/asistencia/incapacidades/alertas").then(setAlertas).catch(() => setAlertas([]));
  }, [gestion]);
  if (!usuario) return null;
  const imagen = tema?.imagen_version;

  return (
    <>
      <PageHeader icono="house" title={`Hola, ${usuario.nombre.split(" ")[0]}`} subtitle={`${ROLES[usuario.rol]}${usuario.empresa ? ` · ${usuario.empresa.nombre}` : ""}`} />
      {alertas.length > 0 && (
        <Link to="/vacaciones?vista=incapacidades" className="relative z-10 mb-4 block rounded-lg bg-orange-50 px-4 py-3 text-sm text-orange-900 ring-1 ring-orange-200 hover:bg-orange-100">
          ⚠️ <strong>{alertas.length} aviso(s) de incapacidades</strong>: {alertas[0].mensaje}
          {alertas.length > 1 && " …"} <span className="underline">Ver</span>
        </Link>
      )}
      {imagen && (
        // Llena todo el espacio libre y pasa por detrás del pie (que es transparente).
        <div className="relative -mx-4 -mb-[2.6rem] -mt-5 min-h-64 flex-1 sm:-mx-6 lg:-mx-8">
          <img src={`/api/sistema/imagen-inicio?v=${encodeURIComponent(imagen)}`} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </div>
      )}
    </>
  );
}
