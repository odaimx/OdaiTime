/**
 * Modo soporte del superadmin: el panel de Odai solo administra empresas; para revisar los datos
 * de un cliente se entra explícitamente "como soporte" a una empresa. Vive en sessionStorage, así
 * que se termina al cerrar la pestaña.
 */
import { useSyncExternalStore } from "react";

export type Soporte = { id: string; nombre: string };

const CLAVE = "odai.soporte";
const avisos = new Set<() => void>();
let actual: Soporte | null = leer();

function leer(): Soporte | null {
  try {
    const raw = sessionStorage.getItem(CLAVE);
    return raw ? (JSON.parse(raw) as Soporte) : null;
  } catch {
    return null;
  }
}

function avisar() {
  avisos.forEach((f) => f());
}

export function entrarSoporte(s: Soporte) {
  actual = s;
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: queda solo en memoria */
  }
  avisar();
}

export function salirSoporte() {
  actual = null;
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    /* nada */
  }
  avisar();
}

export function useSoporte(): Soporte | null {
  return useSyncExternalStore(
    (f) => {
      avisos.add(f);
      return () => avisos.delete(f);
    },
    () => actual,
  );
}
