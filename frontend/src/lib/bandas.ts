import { useLocation, useNavigate } from "react-router";
import type { ItemSubmenu } from "../components/ui";
import type { NombreIcono } from "../components/Iconos";
import { useAuth } from "./auth";

/**
 * Submenús de cada módulo (banda debajo del título, como Odoo). El menú lateral queda corto;
 * las opciones secundarias y la configuración de cada módulo viven aquí.
 */
export type Area = "empresa" | "empleados" | "usuarios" | "asistencias" | "odai";

/** soloAdmin: no lo ven los gerentes de sucursal. */
type Opcion = { etiqueta: string; ruta: string; icono?: NombreIcono; soloAdmin?: boolean };
type Entrada = { etiqueta: string; ruta?: string; opciones?: Opcion[]; soloAdmin?: boolean };

const BANDAS: Record<Area, Entrada[]> = {
  empresa: [
    { etiqueta: "Mi empresa", ruta: "/mi-empresa", soloAdmin: true },
    { etiqueta: "Sucursales", ruta: "/sucursales" },
    { etiqueta: "Otras zonas", ruta: "/obras" },
    { etiqueta: "Dispositivos", ruta: "/configuracion/dispositivos", soloAdmin: true },
    {
      etiqueta: "Configuración",
      opciones: [
        { etiqueta: "Categorías", ruta: "/configuracion/categorias/sucursal", icono: "tags" },
        { etiqueta: "WhatsApp", ruta: "/configuracion/whatsapp", icono: "phone", soloAdmin: true },
        { etiqueta: "Días festivos", ruta: "/festivos", icono: "calendar-heart" },
      ],
    },
  ],
  empleados: [
    { etiqueta: "Empleados", ruta: "/empleados" },
    { etiqueta: "Configuración", opciones: [{ etiqueta: "Categorías", ruta: "/configuracion/categorias/empleado", icono: "tags" }] },
  ],
  usuarios: [
    { etiqueta: "Usuarios", ruta: "/usuarios" },
    { etiqueta: "Configuración", opciones: [{ etiqueta: "Categorías", ruta: "/configuracion/categorias/usuario", icono: "tags" }] },
  ],
  asistencias: [
    { etiqueta: "Asistencias", ruta: "/checadas" },
    { etiqueta: "Reglas de asistencia", ruta: "/configuracion/reglas" },
    { etiqueta: "Checadas", ruta: "/configuracion/checadas" },
  ],
  odai: [
    { etiqueta: "Empresas", ruta: "/empresas" },
    {
      etiqueta: "Configuración",
      opciones: [
        { etiqueta: "Categorías", ruta: "/configuracion/categorias/empresa", icono: "tags" },
        { etiqueta: "Servidor de correo", ruta: "/configuracion/sistema/correo", icono: "mail" },
        { etiqueta: "Plantillas de correo", ruta: "/configuracion/sistema/plantillas", icono: "mail-check" },
        { etiqueta: "Enlaces de Odai", ruta: "/configuracion/sistema/enlaces", icono: "send" },
        { etiqueta: "Frases", ruta: "/configuracion/sistema/frases", icono: "file-text" },
        { etiqueta: "Color del tema", ruta: "/configuracion/sistema/tema", icono: "palette" },
        { etiqueta: "Pantalla de acceso", ruta: "/configuracion/sistema/acceso", icono: "image" },
        { etiqueta: "Días festivos (catálogo)", ruta: "/festivos", icono: "calendar-heart" },
      ],
    },
  ],
};

/** Área a la que pertenece una ruta de configuración (para mostrar su banda). */
export function areaDeRuta(ruta: string): Area {
  for (const [area, entradas] of Object.entries(BANDAS) as [Area, Entrada[]][]) {
    if (entradas.some((e) => e.ruta === ruta || e.opciones?.some((o) => o.ruta === ruta))) return area;
  }
  return "empresa";
}

export function useBanda(area: Area, extra: ItemSubmenu[] = []): ItemSubmenu[] {
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const { usuario } = useAuth();
  const admin = usuario?.rol === "superadmin" || usuario?.rol === "admin_empresa";
  const ver = <T extends { soloAdmin?: boolean }>(x: T) => admin || !x.soloAdmin;
  return [
    ...BANDAS[area].filter(ver).map<ItemSubmenu>((e) =>
      e.opciones
        ? {
            etiqueta: e.etiqueta,
            activo: e.opciones.some((o) => o.ruta === pathname),
            opciones: e.opciones.filter(ver).map((o) => ({ etiqueta: o.etiqueta, icono: o.icono, onClick: () => navegar(o.ruta) })),
          }
        : { etiqueta: e.etiqueta, activo: e.ruta === pathname, onClick: () => e.ruta !== pathname && navegar(e.ruta!) },
    ),
    ...extra,
  ];
}
