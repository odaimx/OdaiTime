import { PageHeader } from "../components/ui";
import { ROLES } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTema } from "../lib/tema";

/** Pantalla de inicio: la imagen general de ODAITIME (la define Odai) a todo lo ancho y alto. */
export default function Inicio() {
  const { usuario } = useAuth();
  const tema = useTema();
  if (!usuario) return null;
  const imagen = tema?.imagen_version;

  return (
    <>
      <PageHeader icono="house" title={`Hola, ${usuario.nombre.split(" ")[0]}`} subtitle={`${ROLES[usuario.rol]}${usuario.empresa ? ` · ${usuario.empresa.nombre}` : ""}`} />
      {imagen && (
        // Llena todo el espacio libre hasta la línea del pie de página.
        <div className="relative -mx-4 -mb-3 -mt-5 min-h-64 flex-1 sm:-mx-6 lg:-mx-8">
          <img src={`/api/sistema/imagen-inicio?v=${encodeURIComponent(imagen)}`} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </div>
      )}
    </>
  );
}
