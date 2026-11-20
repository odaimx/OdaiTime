/**
 * Cola del kiosco sin conexión (IndexedDB). Guarda número, PIN cifrado, botón, foto y hora;
 * se envía al reconectar y el servidor comprueba el PIN. La llave de cifrado (AES-GCM) se crea
 * en la tablet y no se puede exportar: el PIN no queda legible en el almacenamiento.
 */

export interface PendienteKiosco {
  id?: number;
  numero: string;
  pin: { iv: number[]; datos: ArrayBuffer } | null;
  accion: string;
  momento: string;
  foto: Blob | null;
}

const BD = "odaitime-kiosco";

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    const r = indexedDB.open(BD, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("cola", { keyPath: "id", autoIncrement: true });
      r.result.createObjectStore("llaves");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

function pedir<T>(almacen: string, modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((ok, mal) => {
        const req = f(db.transaction(almacen, modo).objectStore(almacen));
        req.onsuccess = () => ok(req.result as T);
        req.onerror = () => mal(req.error);
      }),
  );
}

async function llave(): Promise<CryptoKey> {
  const guardada = await pedir<CryptoKey | undefined>("llaves", "readonly", (s) => s.get("pin"));
  if (guardada) return guardada;
  const nueva = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await pedir("llaves", "readwrite", (s) => s.put(nueva, "pin"));
  return nueva;
}

export async function cifrarPin(pin: string): Promise<PendienteKiosco["pin"]> {
  if (!pin) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await llave(), new TextEncoder().encode(pin));
  return { iv: [...iv], datos };
}

export async function descifrarPin(p: PendienteKiosco["pin"]): Promise<string> {
  if (!p) return "";
  const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(p.iv) }, await llave(), p.datos);
  return new TextDecoder().decode(claro);
}

export const agregar = (p: PendienteKiosco) => pedir<number>("cola", "readwrite", (s) => s.add(p));
export const listar = () => pedir<PendienteKiosco[]>("cola", "readonly", (s) => s.getAll());
export const quitar = (id: number) => pedir<undefined>("cola", "readwrite", (s) => s.delete(id));
export const contar = () => pedir<number>("cola", "readonly", (s) => s.count());

/** Hora corregida con la diferencia contra el reloj del servidor (medida al estar en línea). */
const DESFASE = "odaitime.kiosco.desfase";
export function guardarDesfase(horaServidor: string) {
  try {
    localStorage.setItem(DESFASE, String(Date.parse(horaServidor) - Date.now()));
  } catch {
    /* sin almacenamiento */
  }
}
export function horaCorregida(): Date {
  let d = 0;
  try {
    d = Number(localStorage.getItem(DESFASE) ?? 0) || 0;
  } catch {
    d = 0;
  }
  return new Date(Date.now() + d);
}
