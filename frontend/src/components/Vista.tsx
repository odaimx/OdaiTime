import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ResumenTarea } from "../lib/api";
import { Calendario, Icono, RelojActividad, useFlotante, useResumenActividades } from "./Actividades";
import { FuentesOficiales } from "./LFT";

/**
 * Vistas de datos al estilo Odoo, iguales en todo el sistema:
 * - Búsqueda con facetas: al escribir se elige en qué campo buscar (Enter = el primero).
 * - Menú (flecha) con Filtros, Agrupar por y Favoritos guardados.
 * - Vista de lista o kanban (y calendario de actividades), con su ícono.
 * - Columnas que cada quien muestra u oculta, orden ascendente/descendente en los títulos.
 * - Total de registros y paginación con registros por página configurables.
 * - Reloj de actividades programadas en cada registro.
 * Las preferencias se guardan en el navegador por pantalla.
 */

type Valor = string | number | boolean | null | undefined;

export interface Columna<T> {
  clave: string;
  titulo: string;
  /** Valor para ordenar, buscar, agrupar y exportar. */
  valor: (r: T) => Valor;
  /** Cómo se dibuja en la lista (por defecto, el valor). */
  render?: (r: T) => ReactNode;
  /** Visible al inicio (se puede cambiar en "Personalizar columnas"). */
  visible?: boolean;
  /** No se puede ocultar. */
  fija?: boolean;
  buscable?: boolean;
  agrupable?: boolean;
  alinear?: "derecha";
  /** Suma la columna al pie de la lista. */
  sumar?: boolean;
  className?: string;
}

export interface Filtro<T> {
  clave: string;
  titulo: string;
  prueba: (r: T) => boolean;
  /** Los filtros del mismo grupo se combinan con "o"; los de grupos distintos, con "y". */
  grupo?: string;
}

export interface ConfigVista<T> {
  /** Identificador para guardar las preferencias (p. ej. "empleados"). */
  id: string;
  columnas: Columna<T>[];
  filtros?: Filtro<T>[];
  filtrosIniciales?: string[];
  ordenInicial?: Orden;
  clave: (r: T) => string;
  onAbrir?: (r: T) => void;
  /** Tarjeta del kanban. Sin esto no hay vista kanban. */
  kanban?: (r: T) => ReactNode;
  /** Actividades programadas: modelo del registro (empleado, sucursal, turno). */
  actividades?: { modelo: string; query: string; listo?: boolean };
  /** Artículos de la LFT que aplican: muestra el ícono de fuentes oficiales. */
  fuentes?: string;
  vacio?: string;
  /** Botones extra en la barra (p. ej. "Nuevo"). */
  acciones?: ReactNode;
  /** Tarjetas con contador arriba de la lista; al tocarlas se aplica su filtro (como en Odoo). */
  tarjetas?: { filtro: string; color: ColorTarjeta }[];
  /** Panel a la derecha de las tarjetas (periodo, indicadores). */
  panel?: ReactNode;
  /** Vista con la que abre la primera vez (luego se recuerda la que elija cada quien). */
  modoInicial?: "lista" | "kanban";
}

export type ColorTarjeta = "naranja" | "morado" | "azul" | "rojo" | "verde" | "gris";
const COLORES: Record<ColorTarjeta, string> = {
  naranja: "bg-orange-50 text-orange-800 ring-orange-200",
  morado: "bg-brand-50 text-brand-700 ring-brand-200",
  azul: "bg-sky-50 text-sky-800 ring-sky-200",
  rojo: "bg-red-50 text-red-700 ring-red-200",
  verde: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  gris: "bg-slate-50 text-slate-700 ring-slate-200",
};

export type Orden = { clave: string; dir: "asc" | "desc" } | null;
type Modo = "lista" | "kanban" | "calendario";
interface Busqueda {
  columna: string;
  texto: string;
}
interface Favorito {
  nombre: string;
  filtros: string[];
  agrupar: string[];
  busquedas: Busqueda[];
}
interface Prefs {
  modo: Modo;
  ocultas: string[];
  visibles: string[];
  orden: Orden;
  porPagina: number;
}

const POR_PAGINA = [20, 40, 80, 200, 500];
const SIN_DEFINIR = "Sin definir";

function leer<V>(k: string, defecto: V): V {
  try {
    const v = localStorage.getItem(k);
    return v ? { ...defecto, ...JSON.parse(v) } : defecto;
  } catch {
    return defecto;
  }
}
function leerLista<V>(k: string): V[] {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "[]") as V[];
  } catch {
    return [];
  }
}
function guardar(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: las preferencias duran mientras la página esté abierta */
  }
}

/** Minúsculas y sin acentos, para buscar "jose" y encontrar "José". */
export const normalizar = (v: Valor) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function comparar(a: Valor, b: Valor): number {
  const vacioA = a === null || a === undefined || a === "";
  const vacioB = b === null || b === undefined || b === "";
  if (vacioA || vacioB) return vacioA === vacioB ? 0 : vacioA ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(b) - Number(a);
  return String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
}

const textoValor = (v: Valor) => (v === true ? "Sí" : v === false ? "No" : v === null || v === undefined || v === "" ? "" : String(v));

// --- Íconos ---
const I = {
  buscar: "M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.35-4.35",
  flecha: "M6 9l6 6 6-6",
  filtro: "M22 3H2l8 9.46V19l4 2v-8.54z",
  capas: "M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5",
  estrella: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  lista: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  kanban: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  calendario: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  ajustes: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  x: "M18 6L6 18M6 6l12 12",
  basura: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  descargar: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
};

export function useVista<T>(config: ConfigVista<T>, datos: T[]) {
  const pk = `odaitime.vista.${config.id}`;
  const fk = `odaitime.favoritos.${config.id}`;
  const [prefs, setPrefs] = useState<Prefs>(() =>
    leer<Prefs>(pk, {
      modo: config.kanban && (window.innerWidth < 640 || config.modoInicial === "kanban") ? "kanban" : "lista",
      ocultas: [],
      visibles: [],
      orden: config.ordenInicial ?? null,
      porPagina: 80,
    }),
  );
  const [filtros, setFiltros] = useState<string[]>(config.filtrosIniciales ?? []);
  const [agrupar, setAgrupar] = useState<string[]>([]);
  const [busquedas, setBusquedas] = useState<Busqueda[]>([]);
  const [favoritos, setFavoritos] = useState<Favorito[]>(() => leerLista<Favorito>(fk));
  const [pagina, setPagina] = useState(0);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  const cambiarPrefs = useCallback(
    (p: Partial<Prefs>) =>
      setPrefs((a) => {
        const n = { ...a, ...p };
        guardar(pk, n);
        return n;
      }),
    [pk],
  );

  useEffect(() => setPagina(0), [filtros, busquedas, agrupar, prefs.orden, prefs.porPagina]);

  const columnas = config.columnas;
  const visibles = columnas.filter((c) => c.fija || (c.visible !== false ? !prefs.ocultas.includes(c.clave) : prefs.visibles.includes(c.clave)));

  const filtrados = useMemo(() => {
    const defs = config.filtros ?? [];
    const activos = defs.filter((f) => filtros.includes(f.clave));
    const grupos = new Map<string, Filtro<T>[]>();
    for (const f of activos) grupos.set(f.grupo ?? f.clave, [...(grupos.get(f.grupo ?? f.clave) ?? []), f]);
    const porColumna = new Map<string, string[]>();
    for (const b of busquedas) porColumna.set(b.columna, [...(porColumna.get(b.columna) ?? []), normalizar(b.texto)]);
    return datos.filter((r) => {
      for (const fs of grupos.values()) if (!fs.some((f) => f.prueba(r))) return false;
      for (const [clave, textos] of porColumna) {
        const col = columnas.find((c) => c.clave === clave);
        if (!col) continue;
        const v = normalizar(col.valor(r));
        if (!textos.some((t) => v.includes(t))) return false;
      }
      return true;
    });
  }, [datos, filtros, busquedas, config.filtros, columnas]);

  const ordenados = useMemo(() => {
    const o = prefs.orden;
    const col = o && columnas.find((c) => c.clave === o.clave);
    if (!o || !col) return filtrados;
    const s = o.dir === "asc" ? 1 : -1;
    return [...filtrados].sort((a, b) => s * comparar(col.valor(a), col.valor(b)));
  }, [filtrados, prefs.orden, columnas]);

  // Con agrupación, el orden de los registros sigue los grupos (para las flechas del registro).
  const grupos = useMemo(() => (agrupar.length ? agruparPor(ordenados, agrupar.map((k) => columnas.find((c) => c.clave === k)!).filter(Boolean)) : null), [ordenados, agrupar, columnas]);
  const enOrden = useMemo(() => (grupos ? aplanar(grupos) : ordenados), [grupos, ordenados]);

  const total = ordenados.length;
  const porPagina = prefs.porPagina;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const pag = Math.min(pagina, paginas - 1);
  const enPagina = grupos ? ordenados : ordenados.slice(pag * porPagina, (pag + 1) * porPagina);

  function guardarFavorito(nombre: string) {
    const n = [...favoritos.filter((f) => f.nombre !== nombre), { nombre, filtros, agrupar, busquedas }];
    setFavoritos(n);
    guardar(fk, n);
  }
  function borrarFavorito(nombre: string) {
    const n = favoritos.filter((f) => f.nombre !== nombre);
    setFavoritos(n);
    guardar(fk, n);
  }
  function aplicarFavorito(f: Favorito) {
    setFiltros(f.filtros);
    setAgrupar(f.agrupar);
    setBusquedas(f.busquedas);
  }

  return {
    config,
    datos,
    prefs,
    cambiarPrefs,
    filtros,
    setFiltros,
    agrupar,
    setAgrupar,
    busquedas,
    setBusquedas,
    favoritos,
    guardarFavorito,
    borrarFavorito,
    aplicarFavorito,
    visibles,
    total,
    pagina: pag,
    paginas,
    setPagina,
    porPagina,
    enPagina,
    grupos,
    /** Registros en el orden en que se ven (para las flechas ◀ ▶ del registro). */
    ordenados: enOrden,
    seleccion,
    setSeleccion,
  };
}

export type EstadoVista<T> = ReturnType<typeof useVista<T>>;

interface Grupo<T> {
  clave: string;
  etiqueta: string;
  registros: T[];
  subgrupos: Grupo<T>[] | null;
}

function agruparPor<T>(datos: T[], cols: Columna<T>[]): Grupo<T>[] {
  const [col, ...resto] = cols;
  const m = new Map<string, T[]>();
  for (const r of datos) {
    const k = textoValor(col.valor(r)) || SIN_DEFINIR;
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m.entries()]
    .sort(([a], [b]) => (a === SIN_DEFINIR ? 1 : b === SIN_DEFINIR ? -1 : comparar(a, b)))
    .map(([k, regs]) => ({ clave: `${col.clave}:${k}`, etiqueta: k, registros: regs, subgrupos: resto.length ? agruparPor(regs, resto) : null }));
}

function aplanar<T>(gs: Grupo<T>[]): T[] {
  return gs.flatMap((g) => (g.subgrupos ? aplanar(g.subgrupos) : g.registros));
}

// --- Componente ---

export default function Vista<T>({ vista }: { vista: EstadoVista<T> }) {
  const { config, prefs } = vista;
  const act = config.actividades;
  const { resumen, recargar } = useResumenActividades(act?.modelo, act?.query ?? "", act?.listo ?? true);

  return (
    <div>
      <BarraControl vista={vista} />
      {(config.tarjetas?.length || config.panel) && <Tarjetas vista={vista} />}
      {vista.seleccion.size > 0 && <BarraSeleccion vista={vista} />}
      {prefs.modo === "calendario" && act ? (
        <Calendario query={act.query} modelo={act.modelo} />
      ) : prefs.modo === "kanban" && config.kanban ? (
        <Kanban vista={vista} resumen={resumen} recargar={recargar} />
      ) : (
        <Lista vista={vista} resumen={resumen} recargar={recargar} />
      )}
    </div>
  );
}

function BarraControl<T>({ vista }: { vista: EstadoVista<T> }) {
  const { config, prefs } = vista;
  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="flex items-center gap-2 lg:order-1">
        {config.acciones}
        {config.fuentes !== undefined && <FuentesOficiales articulos={config.fuentes || undefined} />}
      </div>
      <Buscador vista={vista} />
      <div className="flex items-center justify-between gap-3 lg:order-3 lg:justify-end">
        <Paginador vista={vista} />
        <div className="flex gap-1" role="group" aria-label="Tipo de vista">
          <BotonModo vista={vista} modo="lista" icono={I.lista} titulo="Lista" />
          {config.kanban && <BotonModo vista={vista} modo="kanban" icono={I.kanban} titulo="Kanban" />}
          {config.actividades && <BotonModo vista={vista} modo="calendario" icono={I.calendario} titulo="Calendario de actividades" />}
        </div>
      </div>
      {prefs.modo === "calendario" && <span className="sr-only">Calendario</span>}
    </div>
  );
}

function Tarjetas<T>({ vista }: { vista: EstadoVista<T> }) {
  const { config } = vista;
  const filtros = config.filtros ?? [];
  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-stretch lg:justify-between">
      <div className="flex flex-wrap gap-3">
        {config.tarjetas?.map((t) => {
          const f = filtros.find((x) => x.clave === t.filtro);
          if (!f) return null;
          const n = vista.datos.filter(f.prueba).length;
          const activo = vista.filtros.includes(f.clave);
          return (
            <button
              key={t.filtro}
              onClick={() => vista.setFiltros(activo ? vista.filtros.filter((k) => k !== f.clave) : [...vista.filtros.filter((k) => !config.tarjetas?.some((c) => c.filtro === k)), f.clave])}
              className={`min-w-32 rounded-xl px-5 py-3 text-center ring-1 transition hover:shadow-sm ${COLORES[t.color]} ${activo ? "ring-2 ring-offset-1" : ""}`}
              aria-pressed={activo}
            >
              <span className="block text-2xl font-bold tabular-nums">{n}</span>
              <span className="text-sm font-medium">{f.titulo}</span>
            </button>
          );
        })}
      </div>
      {config.panel && <div className="card flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3">{config.panel}</div>}
    </div>
  );
}

function BotonModo<T>({ vista, modo, icono, titulo }: { vista: EstadoVista<T>; modo: Modo; icono: string; titulo: string }) {
  const activo = vista.prefs.modo === modo;
  return (
    <button className={activo ? "btn-icono-activo" : "btn-icono"} onClick={() => vista.cambiarPrefs({ modo })} title={titulo} aria-label={titulo} aria-pressed={activo}>
      <Icono d={icono} className="h-4 w-4" />
    </button>
  );
}

function Buscador<T>({ vista }: { vista: EstadoVista<T> }) {
  const { config } = vista;
  const [texto, setTexto] = useState("");
  const [sugerido, setSugerido] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const menu = useFlotante(Math.min(820, window.innerWidth - 16), "derecha");
  const caja = useRef<HTMLDivElement>(null);
  const buscables = config.columnas.filter((c) => c.buscable);

  function agregar(columna: string) {
    if (!texto.trim()) return;
    vista.setBusquedas([...vista.busquedas, { columna, texto: texto.trim() }]);
    setTexto("");
    setSugerido(0);
  }

  const facetas: { clave: string; icono: string; etiqueta: ReactNode; quitar: () => void }[] = [];
  const nombresFiltro = (config.filtros ?? []).filter((f) => vista.filtros.includes(f.clave)).map((f) => f.titulo);
  if (nombresFiltro.length) facetas.push({ clave: "f", icono: I.filtro, etiqueta: nombresFiltro.join(" o "), quitar: () => vista.setFiltros([]) });
  if (vista.agrupar.length)
    facetas.push({
      clave: "g",
      icono: I.capas,
      etiqueta: vista.agrupar.map((k) => config.columnas.find((c) => c.clave === k)?.titulo).join(" › "),
      quitar: () => vista.setAgrupar([]),
    });
  const porCol = new Map<string, string[]>();
  for (const b of vista.busquedas) porCol.set(b.columna, [...(porCol.get(b.columna) ?? []), b.texto]);
  for (const [col, textos] of porCol)
    facetas.push({
      clave: `b:${col}`,
      icono: I.buscar,
      etiqueta: (
        <>
          <span className="font-semibold">{config.columnas.find((c) => c.clave === col)?.titulo}:</span> {textos.join(" o ")}
        </>
      ),
      quitar: () => vista.setBusquedas(vista.busquedas.filter((b) => b.columna !== col)),
    });

  return (
    <div className="relative min-w-0 flex-1 lg:order-2 lg:mx-auto lg:max-w-2xl" ref={caja}>
      <div
        ref={(el) => {
          menu.boton.current = el;
        }}
        className="flex min-h-10 items-center rounded-lg border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-200"
        onClick={() => input.current?.focus()}
      >
        <Icono d={I.buscar} className="ml-3 h-4 w-4 shrink-0 text-slate-400" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 px-2 py-1">
          {facetas.map((f) => (
            <span key={f.clave} className="faceta">
              <span className="flex items-center self-stretch bg-brand-500 px-1.5 text-white">
                <Icono d={f.icono} className="h-3 w-3" />
              </span>
              <span className="truncate px-1 py-0.5">{f.etiqueta}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  f.quitar();
                }}
                className="px-1 text-slate-400 hover:text-red-600"
                aria-label="Quitar"
              >
                <Icono d={I.x} className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            ref={input}
            className="min-w-24 flex-1 border-0 bg-transparent py-1 text-sm text-navy-900 outline-none placeholder:text-slate-400"
            placeholder={facetas.length ? "" : "Buscar…"}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setSugerido(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && buscables.length) {
                e.preventDefault();
                agregar(buscables[sugerido]?.clave ?? buscables[0].clave);
              } else if (e.key === "ArrowDown") setSugerido((s) => Math.min(s + 1, buscables.length - 1));
              else if (e.key === "ArrowUp") setSugerido((s) => Math.max(s - 1, 0));
              else if (e.key === "Escape") setTexto("");
              else if (e.key === "Backspace" && !texto && facetas.length) facetas[facetas.length - 1].quitar();
            }}
          />
        </div>
        <button
          className={`flex h-10 w-10 shrink-0 items-center justify-center border-l border-slate-200 transition ${menu.abierto ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50"}`}
          onClick={(e) => {
            e.stopPropagation();
            menu.alternar();
          }}
          title="Filtros, agrupar y favoritos"
          aria-label="Abrir filtros"
        >
          <Icono d={I.flecha} className="h-4 w-4" />
        </button>
      </div>

      {texto.trim() && buscables.length > 0 && (
        <div className="popover left-0 right-0 top-12 p-1">
          {buscables.map((c, i) => (
            <button key={c.clave} className={i === sugerido ? "menu-item-activo" : "menu-item"} onMouseDown={(e) => (e.preventDefault(), agregar(c.clave))}>
              Buscar <span className="font-semibold">{c.titulo}</span> por: <span className="truncate italic">{texto}</span>
            </button>
          ))}
        </div>
      )}

      {menu.render(<MenuFiltros vista={vista} />, "p-0")}
    </div>
  );
}

function MenuFiltros<T>({ vista }: { vista: EstadoVista<T> }) {
  const { config } = vista;
  const [nombreFav, setNombreFav] = useState("");
  const [guardando, setGuardando] = useState(false);
  const filtros = config.filtros ?? [];
  const agrupables = config.columnas.filter((c) => c.agrupable);

  const toggle = <V,>(lista: V[], v: V) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  // Separadores entre grupos de filtros, como en Odoo.
  const bloques: Filtro<T>[][] = [];
  for (const f of filtros) {
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && (ultimo[0].grupo ?? ultimo[0].clave) === (f.grupo ?? f.clave)) ultimo.push(f);
    else bloques.push([f]);
  }

  return (
    <div className="grid max-h-[70vh] grid-cols-1 divide-y divide-slate-100 overflow-y-auto sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <div className="p-2">
        <p className="menu-titulo">
          <Icono d={I.filtro} className="h-4 w-4 text-brand-500" /> Filtros
        </p>
        {bloques.length === 0 && <p className="px-3 py-1 text-sm text-slate-400">Sin filtros</p>}
        {bloques.map((b, i) => (
          <Fragment key={i}>
            {i > 0 && <hr className="my-1 border-slate-100" />}
            {b.map((f) => (
              <button key={f.clave} className={vista.filtros.includes(f.clave) ? "menu-item-activo" : "menu-item"} onClick={() => vista.setFiltros(toggle(vista.filtros, f.clave))}>
                <span className="w-4">{vista.filtros.includes(f.clave) ? "✓" : ""}</span>
                {f.titulo}
              </button>
            ))}
          </Fragment>
        ))}
      </div>
      <div className="p-2">
        <p className="menu-titulo">
          <Icono d={I.capas} className="h-4 w-4 text-accent-500" /> Agrupar por
        </p>
        {agrupables.length === 0 && <p className="px-3 py-1 text-sm text-slate-400">Sin opciones</p>}
        {agrupables.map((c) => (
          <button key={c.clave} className={vista.agrupar.includes(c.clave) ? "menu-item-activo" : "menu-item"} onClick={() => vista.setAgrupar(toggle(vista.agrupar, c.clave))}>
            <span className="w-4">{vista.agrupar.includes(c.clave) ? "✓" : ""}</span>
            {c.titulo}
          </button>
        ))}
      </div>
      <div className="p-2">
        <p className="menu-titulo">
          <Icono d={I.estrella} className="h-4 w-4 text-amber-500" /> Favoritos
        </p>
        {vista.favoritos.map((f) => (
          <div key={f.nombre} className="group flex items-center">
            <button className="menu-item flex-1" onClick={() => vista.aplicarFavorito(f)}>
              {f.nombre}
            </button>
            <button className="invisible px-2 text-slate-400 hover:text-red-600 group-hover:visible" onClick={() => vista.borrarFavorito(f.nombre)} aria-label={`Borrar ${f.nombre}`}>
              <Icono d={I.basura} className="h-4 w-4" />
            </button>
          </div>
        ))}
        {vista.favoritos.length > 0 && <hr className="my-1 border-slate-100" />}
        {guardando ? (
          <form
            className="space-y-2 px-3 py-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (nombreFav.trim()) vista.guardarFavorito(nombreFav.trim());
              setNombreFav("");
              setGuardando(false);
            }}
          >
            <input className="input py-1.5" placeholder="Nombre de la búsqueda" value={nombreFav} onChange={(e) => setNombreFav(e.target.value)} autoFocus />
            <button className="btn-primary w-full py-1.5" disabled={!nombreFav.trim()}>
              Guardar
            </button>
          </form>
        ) : (
          <button className="menu-item" onClick={() => setGuardando(true)}>
            Guardar búsqueda actual ▸
          </button>
        )}
      </div>
    </div>
  );
}

function Paginador<T>({ vista }: { vista: EstadoVista<T> }) {
  const { total, pagina, paginas, porPagina } = vista;
  const menu = useFlotante(176, "derecha");
  const desde = total === 0 ? 0 : pagina * porPagina + 1;
  const hasta = Math.min(total, (pagina + 1) * porPagina);
  return (
    <div className="flex items-center gap-1 text-sm text-slate-600">
      <button
        ref={(el) => {
          menu.boton.current = el;
        }}
        className="rounded-md px-2 py-1 tabular-nums hover:bg-slate-100"
        onClick={menu.alternar}
        title="Registros por página"
      >
        {vista.grupos ? (
          <span>
            <span className="font-medium text-navy-900">{total}</span> registros
          </span>
        ) : (
          <span>
            {desde}-{hasta} / <span className="font-medium text-navy-900">{total}</span>
          </span>
        )}
      </button>
      {!vista.grupos && (
        <>
          <button className="btn-icono h-8 w-8" disabled={pagina === 0} onClick={() => vista.setPagina(pagina - 1)} aria-label="Página anterior">
            ‹
          </button>
          <button className="btn-icono h-8 w-8" disabled={pagina >= paginas - 1} onClick={() => vista.setPagina(pagina + 1)} aria-label="Página siguiente">
            ›
          </button>
        </>
      )}
      {menu.render(
        <>
          <p className="menu-titulo">Registros por página</p>
          {POR_PAGINA.map((n) => (
            <button
              key={n}
              className={n === porPagina ? "menu-item-activo" : "menu-item"}
              onClick={() => {
                vista.cambiarPrefs({ porPagina: n });
                menu.cerrar();
              }}
            >
              {n}
            </button>
          ))}
        </>,
      )}
    </div>
  );
}

function BarraSeleccion<T>({ vista }: { vista: EstadoVista<T> }) {
  const { config } = vista;
  function exportar() {
    const filas = vista.ordenados.filter((r) => vista.seleccion.has(config.clave(r)));
    const cols = vista.visibles;
    const csv = [cols.map((c) => c.titulo), ...filas.map((r) => cols.map((c) => textoValor(c.valor(r))))]
      .map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${config.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-brand-50 px-4 py-2 text-sm ring-1 ring-brand-200">
      <span className="font-medium text-brand-700">{vista.seleccion.size} seleccionado(s)</span>
      <button className="inline-flex items-center gap-1 font-medium text-navy-900 hover:underline" onClick={exportar}>
        <Icono d={I.descargar} className="h-4 w-4" /> Exportar
      </button>
      <button className="text-slate-500 hover:underline" onClick={() => vista.setSeleccion(new Set())}>
        Quitar selección
      </button>
    </div>
  );
}

// --- Lista ---

function Lista<T>({ vista, resumen, recargar }: { vista: EstadoVista<T>; resumen: Record<string, ResumenTarea>; recargar: () => void }) {
  const { config, prefs, visibles, seleccion, setSeleccion } = vista;
  const act = config.actividades;
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const personalizar = useFlotante(260, "derecha");
  const columnasTotales = visibles.length + 2 + (act ? 1 : 0);
  const claves = vista.enPagina.map(config.clave);
  const todos = claves.length > 0 && claves.every((k) => seleccion.has(k));

  function ordenar(clave: string) {
    const o = prefs.orden;
    vista.cambiarPrefs({ orden: o?.clave === clave ? { clave, dir: o.dir === "asc" ? "desc" : "asc" } : { clave, dir: "asc" } });
  }

  function mostrarColumna(c: Columna<T>, mostrar: boolean) {
    const ocultas = prefs.ocultas.filter((k) => k !== c.clave);
    const vis = prefs.visibles.filter((k) => k !== c.clave);
    if (c.visible !== false) vista.cambiarPrefs({ ocultas: mostrar ? ocultas : [...ocultas, c.clave] });
    else vista.cambiarPrefs({ visibles: mostrar ? [...vis, c.clave] : vis });
  }

  const fila = (r: T) => {
    const k = config.clave(r);
    return (
      <tr key={k} className={`group cursor-pointer transition ${seleccion.has(k) ? "bg-brand-50/60" : "hover:bg-slate-50"}`} onClick={() => config.onAbrir?.(r)}>
        <td className="w-10 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            className="accent-brand-500"
            checked={seleccion.has(k)}
            onChange={() =>
              setSeleccion((s) => {
                const n = new Set(s);
                if (n.has(k)) n.delete(k);
                else n.add(k);
                return n;
              })
            }
            aria-label="Seleccionar"
          />
        </td>
        {visibles.map((c) => (
          <td key={c.clave} className={`max-w-xs truncate px-3 py-2.5 ${c.alinear === "derecha" ? "text-right tabular-nums" : ""} ${c.className ?? "text-slate-700"}`}>
            {c.render ? c.render(r) : textoValor(c.valor(r)) || <span className="text-slate-300">—</span>}
          </td>
        ))}
        {act && (
          <td className="w-12 px-2 py-1.5 text-center">
            <RelojActividad modelo={act.modelo} registroId={k} resumen={resumen[k]} query={act.query} onCambio={recargar} />
          </td>
        )}
        <td className="w-10" />
      </tr>
    );
  };

  const sumas = visibles.some((c) => c.sumar);
  const pie = (regs: T[]) =>
    visibles.map((c) => {
      if (!c.sumar) return <td key={c.clave} />;
      const t = regs.reduce((acc, r) => acc + (Number(c.valor(r)) || 0), 0);
      return (
        <td key={c.clave} className="px-3 py-2 text-right font-semibold tabular-nums text-navy-900">
          {t.toLocaleString("es-MX", { maximumFractionDigits: 2 })}
        </td>
      );
    });

  const renderGrupos = (gs: Grupo<T>[], nivel: number): ReactNode =>
    gs.map((g) => {
      const abierto = abiertos.has(g.clave);
      return (
        <Fragment key={g.clave}>
          <tr
            className="cursor-pointer bg-slate-50/70 hover:bg-slate-100"
            onClick={() =>
              setAbiertos((s) => {
                const n = new Set(s);
                if (n.has(g.clave)) n.delete(g.clave);
                else n.add(g.clave);
                return n;
              })
            }
          >
            <td colSpan={columnasTotales} className="py-2 pr-3 font-medium text-navy-900" style={{ paddingLeft: 12 + nivel * 20 }}>
              <span className={`mr-2 inline-block text-slate-400 transition ${abierto ? "rotate-90" : ""}`}>▸</span>
              {g.etiqueta} <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-xs font-normal text-slate-500 ring-1 ring-slate-200">{g.registros.length}</span>
            </td>
          </tr>
          {abierto && (g.subgrupos ? renderGrupos(g.subgrupos, nivel + 1) : g.registros.slice(0, vista.porPagina).map(fila))}
          {abierto && !g.subgrupos && g.registros.length > vista.porPagina && (
            <tr>
              <td colSpan={columnasTotales} className="px-6 py-2 text-xs text-slate-500">
                Se muestran {vista.porPagina} de {g.registros.length}. Aumenta los registros por página para ver más.
              </td>
            </tr>
          )}
        </Fragment>
      );
    });

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white text-left text-xs font-semibold text-navy-900">
          <tr>
            <th className="w-10 px-3 py-3">
              <input
                type="checkbox"
                className="accent-brand-500"
                checked={todos}
                onChange={() => setSeleccion(todos ? new Set() : new Set([...seleccion, ...claves]))}
                aria-label="Seleccionar todos"
              />
            </th>
            {visibles.map((c) => {
              const o = prefs.orden?.clave === c.clave ? prefs.orden.dir : null;
              return (
                <th key={c.clave} className={`whitespace-nowrap px-3 py-3 ${c.alinear === "derecha" ? "text-right" : ""}`}>
                  <button className={`group inline-flex items-center gap-1 hover:text-brand-600 ${o ? "text-brand-700" : ""}`} onClick={() => ordenar(c.clave)} title="Ordenar">
                    {c.titulo}
                    <span className={`text-[10px] ${o ? "" : "text-transparent group-hover:text-slate-300"}`}>{o === "desc" ? "▼" : "▲"}</span>
                  </button>
                </th>
              );
            })}
            {act && <th className="w-12 px-2 py-3 text-center">Actividad</th>}
            <th className="w-10 px-2 py-3 text-right">
              <button
                ref={(el) => {
                  personalizar.boton.current = el;
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-navy-900"
                onClick={personalizar.alternar}
                title="Personalizar columnas"
                aria-label="Personalizar columnas"
              >
                <Icono d={I.ajustes} className="h-4 w-4" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {vista.grupos ? renderGrupos(vista.grupos, 0) : vista.enPagina.map(fila)}
          {vista.total === 0 && (
            <tr>
              <td colSpan={columnasTotales} className="px-4 py-16 text-center text-slate-500">
                {config.vacio ?? "No hay registros con esos filtros."}
              </td>
            </tr>
          )}
        </tbody>
        {sumas && vista.total > 0 && (
          <tfoot className="border-t border-slate-200 bg-slate-50">
            <tr>
              <td />
              {pie(vista.grupos ? vista.ordenados : vista.enPagina)}
              {act && <td />}
              <td />
            </tr>
          </tfoot>
        )}
      </table>
      {personalizar.render(
        <>
          <p className="menu-titulo">Columnas visibles</p>
          <div className="max-h-80 overflow-y-auto">
            {config.columnas.map((c) => (
              <label key={c.clave} className={`menu-item cursor-pointer ${c.fija ? "opacity-60" : ""}`}>
                <input type="checkbox" className="accent-brand-500" disabled={c.fija} checked={visibles.includes(c)} onChange={(e) => mostrarColumna(c, e.target.checked)} />
                {c.titulo}
              </label>
            ))}
          </div>
          <hr className="my-1 border-slate-100" />
          <button className="menu-item text-slate-500" onClick={() => vista.cambiarPrefs({ ocultas: [], visibles: [] })}>
            Restablecer
          </button>
        </>,
      )}
    </div>
  );
}

// --- Kanban ---

function Kanban<T>({ vista, resumen, recargar }: { vista: EstadoVista<T>; resumen: Record<string, ResumenTarea>; recargar: () => void }) {
  const { config } = vista;
  const act = config.actividades;
  const tarjeta = (r: T) => {
    const k = config.clave(r);
    return (
      <div key={k} className="card group relative cursor-pointer p-3 transition hover:shadow-md hover:ring-brand-200" onClick={() => config.onAbrir?.(r)}>
        {config.kanban!(r)}
        {act && (
          <div className="absolute bottom-2 right-2">
            <RelojActividad modelo={act.modelo} registroId={k} resumen={resumen[k]} query={act.query} onCambio={recargar} />
          </div>
        )}
      </div>
    );
  };

  if (vista.total === 0) return <div className="card px-4 py-16 text-center text-slate-500">{config.vacio ?? "No hay registros con esos filtros."}</div>;

  if (vista.grupos) {
    // Kanban agrupado: una columna por grupo (primer nivel), como en Odoo.
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {vista.grupos.map((g) => (
          <div key={g.clave} className="w-72 shrink-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="truncate font-semibold text-navy-900">{g.etiqueta}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{g.registros.length}</span>
            </div>
            <div className="space-y-3">{aplanar([g]).slice(0, vista.porPagina).map(tarjeta)}</div>
          </div>
        ))}
      </div>
    );
  }
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{vista.enPagina.map(tarjeta)}</div>;
}
