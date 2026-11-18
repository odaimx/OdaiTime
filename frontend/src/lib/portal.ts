import { useEffect, useState } from "react";
import { get } from "./api";

export interface PermisosPortal {
  checar: boolean;
  historial: boolean;
}

let cache: Promise<PermisosPortal> | null = null;

/** Qué puede hacer el empleado en el portal (configuración de asistencias de su sucursal). */
export function usePortal(activo: boolean): PermisosPortal | null {
  const [p, setP] = useState<PermisosPortal | null>(null);
  useEffect(() => {
    if (!activo) return;
    cache ??= get<PermisosPortal>("/checadas/portal").catch((e) => {
      cache = null;
      throw e;
    });
    cache.then(setP).catch(() => setP({ checar: false, historial: false }));
  }, [activo]);
  return p;
}

/** Olvida los permisos (al cerrar sesión). */
export function olvidarPortal() {
  cache = null;
}
