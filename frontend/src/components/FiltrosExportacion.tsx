import { useEffect, useMemo, useRef, useState } from "react";
import Icono from "./Iconos";
import { get, type Categoria, type Empleado, type Obra, type Sucursal } from "../lib/api";
import { periodo } from "../lib/periodo";

/**
 * Filtros de las exportaciones (nómina y reportes): periodo y empleados por sucursal, categorías
 * de empleado y de sucursal, departamento, puesto, zona, empleados sueltos y estatus.
 * Entre grupos se combinan con «y»; dentro de un grupo, con «o» (como en las vistas).
 */

export type Estatus = "todos" | "activos" | "bajas";
export interface Filtros {
  preset: string;
  desde: string;
  hasta: string;
  sucursal_ids: string[];
  categoria_ids: string[];
  categoria_sucursal_ids: string[];
  departamentos: string[];
  puestos: string[];
  obra_ids: string[];
  empleado_ids: string[];
  estatus: Estatus;
}
type Grupo = "sucursal_ids" | "categoria_ids" | "categoria_sucursal_ids" | "departamentos" | "puestos" | "obra_ids" | "empleado_ids";
const GRUPOS: Grupo[] = ["sucursal_ids", "categoria_ids", "categoria_sucursal_ids", "departamentos", "puestos", "obra_ids", "empleado_ids"];

export const PRESETS: [string, string][] = [
  ["semana", "Esta semana"],
  ["semana_pasada", "Semana pasada"],
  ["quincena", "Quincena actual"],
  ["quincena_pasada", "Quincena pasada"],
  ["mes", "Este mes"],
  ["mes_pasado", "Mes pasado"],
];

const GUARDADOS = "odaitime.exportar.filtros";

export function filtrosIniciales(): Filtros {
  let previos: Partial<Filtros> = {};
  try {
    previos = JSON.parse(localStorage.getItem(GUARDADOS) ?? "{}");
  } catch {
    /* sin almacenamiento */
  }
  const preset = previos.preset && PRESETS.some(([k]) => k === previos.preset) ? previos.preset : "quincena";
  const vacio = Object.fromEntries(GRUPOS.map((g) => [g, []])) as unknown as Record<Grupo, string[]>;
  const base: Filtros = { preset, ...periodo(preset), ...vacio, estatus: "todos" };
  // Se recuerdan los filtros y el tipo de periodo; las fechas se recalculan con el preset.
  for (const g of GRUPOS) if (Array.isArray(previos[g])) base[g] = (previos[g] as string[]).slice(0, 200);
  if (previos.estatus === "activos" || previos.estatus === "bajas") base.estatus = previos.estatus;
  if (!previos.preset && previos.desde && previos.hasta) Object.assign(base, { preset: "", desde: previos.desde, hasta: previos.hasta });
  return base;
}

/** Parámetros para la API (listas repetidas: sucursal_ids=a&sucursal_ids=b). */
export function paramsDe(f: Filtros, extra: Record<string, string> = {}): URLSearchParams {
  const p = new URLSearchParams({ desde: f.desde, hasta: f.hasta, ...extra });
  for (const g of GRUPOS) for (const v of f[g]) p.append(g, v);
  if (f.estatus !== "todos") p.set("estatus", f.estatus);
  return p;
}

export const hayFiltros = (f: Filtros) => GRUPOS.some((g) => f[g].length > 0) || f.estatus !== "todos";

interface Opcion {
  id: string;
  etiqueta: string;
  detalle?: string;
  color?: string;
}

/** Botón con lista desplegable de casillas y búsqueda. */
function Multi({ titulo, opciones, valor, onCambio, vacio }: { titulo: string; opciones: Opcion[]; valor: string[]; onCambio: (v: string[]) => void; vacio: string }) {
  const [abierto, setAbierto] = useState(false);
  const [busca, setBusca] = useState("");
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);
  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return b ? opciones.filter((o) => `${o.etiqueta} ${o.detalle ?? ""}`.toLowerCase().includes(b)) : opciones;
  }, [opciones, busca]);
  const marcar = (id: string) => onCambio(valor.includes(id) ? valor.filter((x) => x !== id) : [...valor, id]);
  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${
          valor.length ? "bg-brand-50 text-brand-700 ring-brand-300" : "bg-white text-slate-600 ring-slate-200 hover:text-tinta-900"
        }`}
        aria-expanded={abierto}
      >
        {titulo}
        {valor.length > 0 && <span className="rounded-full bg-brand-500 px-1.5 text-xs text-white">{valor.length}</span>}
        <Icono nombre="chevron-down" className="h-4 w-4" />
      </button>
      {abierto && (
        <div className="absolute left-0 z-30 mt-1 w-72 rounded-xl bg-white p-2 shadow-lg ring-1 ring-slate-200">
          {opciones.length > 8 && <input className="input mb-2 py-1.5 text-sm" placeholder="Buscar…" autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} />}
          <div className="max-h-64 overflow-y-auto">
            {lista.length === 0 && <p className="px-2 py-3 text-center text-sm text-slate-500">{opciones.length ? "Sin coincidencias" : vacio}</p>}
            {lista.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={valor.includes(o.id)} onChange={() => marcar(o.id)} />
                {o.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />}
                <span className="min-w-0 flex-1 truncate text-tinta-900">{o.etiqueta}</span>
                {o.detalle && <span className="shrink-0 text-xs text-slate-400">{o.detalle}</span>}
              </label>
            ))}
          </div>
          {valor.length > 0 && (
            <button type="button" className="mt-1 w-full rounded-lg px-2 py-1 text-left text-xs text-slate-500 hover:bg-slate-50" onClick={() => onCambio([])}>
              Quitar selección
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function FiltrosExportacion({ query, valor, onCambio, sinZonas = false }: { query: string; valor: Filtros; onCambio: (f: Filtros) => void; sinZonas?: boolean }) {
  const sep = query ? "&" : "?";
  const [op, setOp] = useState<Record<Grupo, Opcion[]>>({ sucursal_ids: [], categoria_ids: [], categoria_sucursal_ids: [], departamentos: [], puestos: [], obra_ids: [], empleado_ids: [] });

  useEffect(() => {
    const nada = <T,>() => [] as T[];
    Promise.all([
      get<Sucursal[]>(`/sucursales${query}`).catch(nada<Sucursal>),
      get<Categoria[]>(`/categorias${query}${sep}modelo=empleado`).catch(nada<Categoria>),
      get<Categoria[]>(`/categorias${query}${sep}modelo=sucursal`).catch(nada<Categoria>),
      get<{ departamentos: string[]; puestos: string[] }>(`/reportes/opciones-filtro${query}`).catch(() => ({ departamentos: [], puestos: [] })),
      sinZonas ? Promise.resolve([] as Obra[]) : get<Obra[]>(`/obras${query}`).catch(nada<Obra>),
      get<Empleado[]>(`/empleados${query}${sep}estado=todos`).catch(nada<Empleado>),
    ]).then(([suc, catE, catS, dp, obras, emps]) =>
      setOp({
        sucursal_ids: suc.map((s) => ({ id: s.id, etiqueta: s.nombre, detalle: s.clave })),
        categoria_ids: catE.map((c) => ({ id: c.id, etiqueta: c.nombre, color: c.color })),
        categoria_sucursal_ids: catS.map((c) => ({ id: c.id, etiqueta: c.nombre, color: c.color })),
        departamentos: dp.departamentos.map((d) => ({ id: d, etiqueta: d })),
        puestos: dp.puestos.map((d) => ({ id: d, etiqueta: d })),
        obra_ids: obras.map((o) => ({ id: o.id, etiqueta: o.nombre, detalle: o.sucursal?.clave })),
        empleado_ids: emps.map((e) => ({ id: e.id, etiqueta: e.nombre_completo, detalle: `#${e.numero}${e.activo ? "" : " · baja"}` })),
      }),
    );
  }, [query, sep, sinZonas]);

  function cambiar(f: Filtros) {
    onCambio(f);
    try {
      localStorage.setItem(GUARDADOS, JSON.stringify({ ...f, ...(f.preset ? { desde: undefined, hasta: undefined } : {}) }));
    } catch {
      /* sin almacenamiento */
    }
  }
  const grupo = (g: Grupo) => (v: string[]) => cambiar({ ...valor, [g]: v });

  const TITULOS: Record<Grupo, string> = {
    sucursal_ids: "Sucursal",
    categoria_ids: "Categoría",
    categoria_sucursal_ids: "Categoría de sucursal",
    departamentos: "Departamento",
    puestos: "Puesto",
    obra_ids: "Zona",
    empleado_ids: "Empleados",
  };
  const VACIOS: Record<Grupo, string> = {
    sucursal_ids: "No hay sucursales",
    categoria_ids: "Sin categorías de empleado (Empleados › Configuración › Categorías)",
    categoria_sucursal_ids: "Sin categorías de sucursal",
    departamentos: "Ningún empleado tiene departamento",
    puestos: "Ningún empleado tiene puesto",
    obra_ids: "No hay otras zonas",
    empleado_ids: "No hay empleados",
  };
  const chips = GRUPOS.flatMap((g) =>
    valor[g].map((id) => ({ g, id, etiqueta: op[g].find((o) => o.id === id)?.etiqueta ?? (g === "departamentos" || g === "puestos" ? id : "…"), color: op[g].find((o) => o.id === id)?.color })),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {PRESETS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => cambiar({ ...valor, preset: k, ...periodo(k) })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${valor.preset === k ? "bg-white text-tinta-900 shadow-sm" : "text-slate-600 hover:text-tinta-900"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="text-xs font-medium text-slate-500">
          Desde
          <input type="date" className="input mt-1 w-40" value={valor.desde} max={valor.hasta} onChange={(e) => cambiar({ ...valor, preset: "", desde: e.target.value })} />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Hasta
          <input type="date" className="input mt-1 w-40" value={valor.hasta} min={valor.desde} onChange={(e) => cambiar({ ...valor, preset: "", hasta: e.target.value })} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-sm font-medium text-slate-500">
          <Icono nombre="funnel" className="h-4 w-4" /> Filtros
        </span>
        {GRUPOS.filter((g) => !(sinZonas && g === "obra_ids")).map((g) => (
          <Multi key={g} titulo={TITULOS[g]} opciones={op[g]} valor={valor[g]} onCambio={grupo(g)} vacio={VACIOS[g]} />
        ))}
        <select
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ${valor.estatus !== "todos" ? "bg-brand-50 text-brand-700 ring-brand-300" : "bg-white text-slate-600 ring-slate-200"}`}
          value={valor.estatus}
          onChange={(e) => cambiar({ ...valor, estatus: e.target.value as Estatus })}
          aria-label="Estatus del empleado"
        >
          <option value="todos">Activos y bajas</option>
          <option value="activos">Solo activos</option>
          <option value="bajas">Solo bajas del periodo</option>
        </select>
      </div>

      {hayFiltros(valor) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span key={`${c.g}-${c.id}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs text-slate-700">
              {c.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />}
              <span className="text-slate-400">{TITULOS[c.g]}:</span> {c.etiqueta}
              <button type="button" className="rounded-full p-0.5 hover:bg-slate-200" aria-label="Quitar filtro" onClick={() => grupo(c.g)(valor[c.g].filter((x) => x !== c.id))}>
                <Icono nombre="x" className="h-3 w-3" />
              </button>
            </span>
          ))}
          {valor.estatus !== "todos" && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">{valor.estatus === "activos" ? "Solo activos" : "Solo bajas"}</span>}
          <button
            type="button"
            className="text-xs font-medium text-brand-600 hover:underline"
            onClick={() => cambiar({ ...valor, ...(Object.fromEntries(GRUPOS.map((g) => [g, []])) as unknown as Record<Grupo, string[]>), estatus: "todos" })}
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );
}
