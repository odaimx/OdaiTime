import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router";
import Layout from "./components/Layout";
import { useAuth } from "./lib/auth";
import type { Rol } from "./lib/api";
import Empleados from "./pages/Empleados";
import Empresas from "./pages/Empresas";
import Inicio from "./pages/Inicio";
import Login from "./pages/Login";
import Sucursales from "./pages/Sucursales";
import Turnos from "./pages/Turnos";
import Usuarios from "./pages/Usuarios";

function Requiere({ roles, children }: { roles: Rol[]; children: ReactElement }) {
  const { usuario } = useAuth();
  return usuario && roles.includes(usuario.rol) ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { usuario } = useAuth();

  if (!usuario) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
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
