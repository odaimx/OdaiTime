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
  texto?: string | null; // texto principal
  texto_suave?: string | null; // texto secundario (ayudas, etiquetas tenues)
}

export const COLORES_ODAI: Required<{ [K in keyof Colores]: string }> = {
  marca: "#8a64de",
  acento: "#54aaf6",
  marino: "#1a2c4f",
  titulos: "#e2c68f",
  texto: "#1a2c4f",
  texto_suave: "#64748b",
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
  set("--color-tinta-900", colores.texto ?? null);
  const ts = colores.texto_suave;
  set("--color-slate-500", ts ?? null);
  set("--color-slate-600", ts ? mezcla(ts, 85, "black") : null);
  set("--color-slate-400", ts ? mezcla(ts, 75, "white") : null);
}

export type Enlaces = { url_tienda: string | null; url_soporte: string | null };
export type Tema = {
  colores: Colores;
  imagen_version: string | null;
  demo: boolean;
  url_tienda: string;
  url_soporte: string;
  enlaces: Enlaces;
};

let pendiente: Promise<Tema> | null = null;

/** Lee el tema guardado y lo aplica (se llama al arrancar la aplicación). */
export async function cargarTema(): Promise<Tema> {
  const r = await fetch("/api/sistema/tema");
  const t: Tema = r.ok
    ? await r.json()
    : { colores: {}, imagen_version: null, demo: false, url_tienda: "", url_soporte: "", enlaces: { url_tienda: null, url_soporte: null } };
  aplicarTema(t.colores);
  pendiente = Promise.resolve(t);
  return t;
}

/** El último tema leído (sin volver a pedirlo si ya se cargó). */
export function temaActual(): Promise<Tema> {
  return pendiente ?? cargarTema();
}
