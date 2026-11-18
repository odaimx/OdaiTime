/**
 * Colores del tema para todo el sistema (los define Odai). Tailwind 4 genera las clases con
 * variables CSS (--color-brand-500, …), así que basta con cambiar esas variables; los tonos
 * claros y oscuros se calculan con color-mix.
 */

export interface Colores {
  marca?: string | null; // morado
  acento?: string | null; // azul
  marino?: string | null; // azul marino
  titulos?: string | null; // beige
}

export const COLORES_ODAI: Required<{ [K in keyof Colores]: string }> = {
  marca: "#8a64de",
  acento: "#54aaf6",
  marino: "#1a2c4f",
  titulos: "#e2c68f",
};

const mezcla = (c: string, pct: number, con: "white" | "black") => `color-mix(in srgb, ${c} ${pct}%, ${con})`;

export function aplicarTema(colores: Colores) {
  const raiz = document.documentElement.style;
  const set = (v: string, valor: string | null) => (valor ? raiz.setProperty(v, valor) : raiz.removeProperty(v));
  const m = colores.marca;
  set("--color-brand-50", m ? mezcla(m, 8, "white") : null);
  set("--color-brand-100", m ? mezcla(m, 15, "white") : null);
  set("--color-brand-200", m ? mezcla(m, 32, "white") : null);
  set("--color-brand-500", m ?? null);
  set("--color-brand-600", m ? mezcla(m, 88, "black") : null);
  set("--color-brand-700", m ? mezcla(m, 75, "black") : null);
  set("--color-accent-500", colores.acento ?? null);
  const n = colores.marino;
  set("--color-navy-700", n ? mezcla(n, 80, "white") : null);
  set("--color-navy-800", n ? mezcla(n, 90, "white") : null);
  set("--color-navy-900", n ?? null);
  set("--color-navy-950", n ? mezcla(n, 82, "black") : null);
  const t = colores.titulos;
  set("--color-oro-300", t ? mezcla(t, 70, "white") : null);
  set("--color-oro-400", t ?? null);
  set("--color-oro-500", t ? mezcla(t, 85, "black") : null);
}

/** Lee el tema guardado y lo aplica (se llama al arrancar la aplicación). */
export async function cargarTema(): Promise<{ colores: Colores; imagen_version: string | null }> {
  const r = await fetch("/api/sistema/tema");
  const t = r.ok ? await r.json() : { colores: {}, imagen_version: null };
  aplicarTema(t.colores);
  return t;
}
