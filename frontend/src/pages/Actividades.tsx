import Calendario from "../components/Calendario";
import { PageHeader, useEmpresaScope } from "../components/ui";

/** Calendario de actividades de la empresa (con "Mis pendientes" en el panel lateral). */
export default function Actividades() {
  const { query, listo, selector } = useEmpresaScope();
  return (
    <>
      <PageHeader icono="calendar-check" title="Actividades" action={selector} />
      {listo && <Calendario query={query} />}
    </>
  );
}
