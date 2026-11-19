import type { ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import Layout from "./components/Layout";
import { useAuth } from "./lib/auth";
import type { Rol } from "./lib/api";
import Actividades from "./pages/Actividades";
import Checadas from "./pages/Checadas";
import TarjetaAsistencia from "./pages/TarjetaAsistencia";
import Checar from "./pages/Checar";
import ConfigChecadas from "./pages/ConfigChecadas";
import Empleados from "./pages/Empleados";
import Empresas from "./pages/Empresas";
import Festivos from "./pages/Festivos";
import Inicio from "./pages/Inicio";
import InicioPortal from "./pages/InicioPortal";
import Kiosco from "./pages/Kiosco";
import Login from "./pages/Login";
import Reportes from "./pages/Reportes";
import Restablecer from "./pages/Restablecer";
import MisRegistros from "./pages/MisRegistros";
import MisVacaciones from "./pages/MisVacaciones";
import Vacaciones from "./pages/Vacaciones";
import MiEmpresa from "./pages/MiEmpresa";
import Sucursales from "./pages/Sucursales";
import Obras from "./pages/Obras";
import Configuracion from "./pages/Configuracion";
import Turnos from "./pages/Turnos";
import Usuarios from "./pages/Usuarios";

function Requiere({ roles, children }: { roles: Rol[]; children: ReactElement }) {
  const { usuario } = useAuth();
  return usuario && roles.includes(usuario.rol) ? children : <Navigate to="/" replace />;
}

const GESTION: Rol[] = ["superadmin", "admin_empresa", "gerente_sucursal"];

function AlLogin() {
  // Conserva a dónde iba (p. ej. /checar?qr=… desde el QR del kiosco) para volver tras iniciar sesión.
  const loc = useLocation();
  return <Navigate to="/login" replace state={{ desde: loc.pathname + loc.search }} />;
}

export default function App() {
  const { usuario } = useAuth();

  if (!usuario) {
    return (
      <Routes>
        <Route path="/kiosco" element={<Kiosco />} />
        <Route path="/login" element={<Login />} />
        <Route path="/restablecer" element={<Restablecer />} />
        <Route path="*" element={<AlLogin />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/kiosco" element={<Kiosco />} />
      <Route element={<Layout />}>
        <Route index element={usuario.rol === "empleado" ? <InicioPortal /> : <Inicio />} />
        <Route
          path="checar"
          element={
            <Requiere roles={["empleado"]}>
              <Checar />
            </Requiere>
          }
        />
        <Route
          path="mis-registros"
          element={
            <Requiere roles={["empleado"]}>
              <MisRegistros />
            </Requiere>
          }
        />
        <Route
          path="mis-vacaciones"
          element={
            <Requiere roles={["empleado"]}>
              <MisVacaciones />
            </Requiere>
          }
        />
        <Route
          path="vacaciones"
          element={
            <Requiere roles={GESTION}>
              <Vacaciones />
            </Requiere>
          }
        />
        <Route
          path="checadas"
          element={
            <Requiere roles={GESTION}>
              <Checadas />
            </Requiere>
          }
        />
        <Route
          path="festivos"
          element={
            <Requiere roles={GESTION}>
              <Festivos />
            </Requiere>
          }
        />
        <Route
          path="asistencia"
          element={
            <Requiere roles={GESTION}>
              <TarjetaAsistencia />
            </Requiere>
          }
        />
        <Route
          path="actividades"
          element={
            <Requiere roles={GESTION}>
              <Actividades />
            </Requiere>
          }
        />
        <Route
          path="reportes"
          element={
            <Requiere roles={GESTION}>
              <Reportes />
            </Requiere>
          }
        />
        <Route
          path="checadas/configuracion"
          element={
            <Requiere roles={GESTION}>
              <Navigate to="/configuracion/checadas" replace />
            </Requiere>
          }
        />
        <Route
          path="empresas"
          element={
            <Requiere roles={["superadmin"]}>
              <Empresas />
            </Requiere>
          }
        />
        <Route
          path="sucursales"
          element={
            <Requiere roles={["superadmin", "admin_empresa", "gerente_sucursal"]}>
              <Sucursales />
            </Requiere>
          }
        />
        <Route
          path="configuracion/:seccion/:sub?"
          element={
            <Requiere roles={["superadmin", "admin_empresa", "gerente_sucursal"]}>
              <Configuracion />
            </Requiere>
          }
        />
        <Route
          path="obras"
          element={
            <Requiere roles={["superadmin", "admin_empresa", "gerente_sucursal"]}>
              <Obras />
            </Requiere>
          }
        />
        <Route
          path="empleados"
          element={
            <Requiere roles={["superadmin", "admin_empresa", "gerente_sucursal"]}>
              <Empleados />
            </Requiere>
          }
        />
        <Route
          path="turnos"
          element={
            <Requiere roles={["superadmin", "admin_empresa", "gerente_sucursal"]}>
              <Turnos />
            </Requiere>
          }
        />
        <Route
          path="mi-empresa"
          element={
            usuario.rol === "gerente_sucursal" ? (
              <Navigate to="/sucursales" replace />
            ) : (
              <Requiere roles={["superadmin", "admin_empresa"]}>
                <MiEmpresa />
              </Requiere>
            )
          }
        />
        <Route
          path="usuarios"
          element={
            <Requiere roles={["superadmin", "admin_empresa"]}>
              <Usuarios />
            </Requiere>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
