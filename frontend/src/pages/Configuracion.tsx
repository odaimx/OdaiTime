import { Navigate, useParams } from "react-router";
import { GestorCategorias, TITULOS_CATEGORIAS } from "../components/Categorias";
import ConfigSistema, { SECCIONES_SISTEMA, type Pestana } from "../components/ConfigSistema";
import ReglasTarjeta from "../components/ReglasTarjeta";
import { PageHeader, useEmpresaScope } from "../components/ui";
import { useAuth } from "../lib/auth";
import type { ModeloCategoria } from "../lib/api";
import ConfigChecadas from "./ConfigChecadas";

/** Menú Configuración: cada opción es una pantalla propia (antes estaban dentro de listas y formularios). */
export default function Configuracion() {
  const { seccion = "", sub = "" } = useParams();
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "superadmin" || usuario?.rol === "admin_empresa";
  const { query, listo, selector } = useEmpresaScope();

  if (seccion === "checadas" || seccion === "dispositivos" || seccion === "whatsapp") {
    return <ConfigChecadas key={seccion} seccion={seccion === "checadas" ? "config" : seccion} />;
  }
  if (seccion === "reglas") {
    return (
      <>
        <PageHeader icono="settings" title="Reglas de asistencia" subtitle="Retardos, faltas y tiempo extra de la tarjeta de asistencia." action={selector} />
        {listo && (
          <div className="card p-5">
            <ReglasTarjeta query={query} esAdmin={esAdmin} />
          </div>
        )}
      </>
    );
  }
  if (seccion === "categorias") {
    const modelo = (["empleado", "sucursal", "usuario", "empresa"].includes(sub) ? sub : "empleado") as ModeloCategoria;
    return (
      <>
        <PageHeader icono="settings" title={TITULOS_CATEGORIAS[modelo]} action={modelo === "empresa" ? undefined : selector} />
        {(listo || modelo === "empresa") && <GestorCategorias key={modelo} modelo={modelo} query={modelo === "empresa" ? "" : query} puedeEditar={esAdmin || usuario?.rol === "gerente_sucursal"} incrustado />}
      </>
    );
  }
  if (seccion === "sistema" && usuario?.rol === "superadmin") {
    const s = (SECCIONES_SISTEMA.find(([k]) => k === sub)?.[0] ?? "tema") as Pestana;
    const titulo = SECCIONES_SISTEMA.find(([k]) => k === s)?.[1] ?? "Sistema";
    return (
      <>
        <PageHeader icono="settings" title={titulo} subtitle="Se aplica a todas las empresas." />
        <div className="card p-5">
          <ConfigSistema key={s} seccion={s} />
        </div>
      </>
    );
  }
  return <Navigate to="/" replace />;
}
