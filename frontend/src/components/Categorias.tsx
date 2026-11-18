import { useCallback, useEffect, useState } from "react";
import { api, get, post, type Categoria, type ModeloCategoria } from "../lib/api";
import Icono from "./Iconos";
import { ErrorBox, Modal } from "./ui";

/** Paleta de las categorías (como las etiquetas de Odoo). */
export const COLORES_CATEGORIA = [
  "bg-slate-200 text-slate-800",
  "bg-red-200 text-red-900",
  "bg-orange-200 text-orange-900",
  "bg-amber-200 text-amber-900",
  "bg-lime-200 text-lime-900",
  "bg-emerald-200 text-emerald-900",
  "bg-cyan-200 text-cyan-900",
  "bg-sky-200 text-sky-900",
  "bg-violet-200 text-violet-900",
  "bg-pink-200 text-pink-900",
];

const TITULOS: Record<ModeloCategoria, string> = {
  empleado: "Categorías de empleados",
  sucursal: "Categorías de sucursales",
  usuario: "Categorías de usuarios",
  empresa: "Categorías de empresas",
};

/** Categorías de un modelo y las que tiene cada registro. `query` = "?empresa_id=…" o "". */
export function useCategorias(modelo: ModeloCategoria, query: string, listo = true) {
  const sep = query ? "&" : "?";
  const [lista, setLista] = useState<Categoria[]>([]);
  const [asignadas, setAsignadas] = useState<Record<string, string[]>>({});
  const recargar = useCallback(() => {
    if (!listo) return;
    get<Categoria[]>(`/categorias${query}${sep}modelo=${modelo}`)
      .then(setLista)
      .catch(() => setLista([]));
    get<Record<string, string[]>>(`/categorias/asignadas${query}${sep}modelo=${modelo}`)
      .then(setAsignadas)
      .catch(() => setAsignadas({}));
  }, [modelo, query, sep, listo]);
  useEffect(recargar, [recargar]);

  const de = (registroId: string) => (asignadas[registroId] ?? []).map((id) => lista.find((c) => c.id === id)).filter((c): c is Categoria => !!c);

  async function asignar(registroId: string, ids: string[]) {
    await api(`/categorias/registro${query}${sep}modelo=${modelo}`, { method: "PUT", body: JSON.stringify({ registro_id: registroId, categoria_ids: ids }) });
    setAsignadas((a) => ({ ...a, [registroId]: ids }));
  }

  return { lista, asignadas, de, asignar, recargar };
}

export function Chip({ c, onQuitar }: { c: Categoria; onQuitar?: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${COLORES_CATEGORIA[c.color] ?? COLORES_CATEGORIA[0]}`}>
      {c.nombre}
      {onQuitar && (
        <button type="button" onClick={onQuitar} className="opacity-60 hover:opacity-100" aria-label={`Quitar ${c.nombre}`}>
          <Icono nombre="x" className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function Chips({ lista }: { lista: Categoria[] }) {
  if (!lista.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {lista.map((c) => (
        <Chip key={c.id} c={c} />
      ))}
    </span>
  );
}

/** Campo del formulario: categorías del registro, con alta rápida. */
export function SelectorCategorias({
  todas,
  valor,
  onCambio,
  puedeCrear,
  onCrear,
}: {
  todas: Categoria[];
  valor: string[];
  onCambio: (ids: string[]) => void;
  puedeCrear: boolean;
  onCrear: (nombre: string) => Promise<Categoria>;
}) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const elegidas = valor.map((id) => todas.find((c) => c.id === id)).filter((c): c is Categoria => !!c);
  const opciones = todas.filter((c) => !valor.includes(c.id) && c.nombre.toLowerCase().includes(texto.toLowerCase()));
  const exacta = todas.some((c) => c.nombre.toLowerCase() === texto.trim().toLowerCase());

  return (
    <div className="relative">
      <label className="label">Categorías</label>
      <div className="input flex min-h-10 flex-wrap items-center gap-1 py-1.5" onClick={() => setAbierto(true)}>
        {elegidas.map((c) => (
          <Chip key={c.id} c={c} onQuitar={() => onCambio(valor.filter((x) => x !== c.id))} />
        ))}
        <input
          className="min-w-24 flex-1 border-0 bg-transparent p-0 text-sm outline-none"
          placeholder={elegidas.length ? "" : "Agregar categoría…"}
          value={texto}
          onChange={(e) => (setTexto(e.target.value), setAbierto(true))}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
        />
      </div>
      {abierto && (opciones.length > 0 || (puedeCrear && texto.trim() && !exacta)) && (
        <div className="popover left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto p-1">
          {opciones.map((c) => (
            <button
              key={c.id}
              type="button"
              className="menu-item"
              onMouseDown={(e) => {
                e.preventDefault();
                onCambio([...valor, c.id]);
                setTexto("");
              }}
            >
              <Chip c={c} />
            </button>
          ))}
          {puedeCrear && texto.trim() && !exacta && (
            <button
              type="button"
              className="menu-item text-brand-700"
              onMouseDown={async (e) => {
                e.preventDefault();
                const c = await onCrear(texto.trim());
                onCambio([...valor, c.id]);
                setTexto("");
              }}
            >
              <Icono nombre="plus" className="h-4 w-4" /> Crear “{texto.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Ventana para dar de alta, renombrar, recolorear y borrar categorías. */
export function GestorCategorias({ modelo, query, puedeEditar, onCerrar, onCambio }: { modelo: ModeloCategoria; query: string; puedeEditar: boolean; onCerrar: () => void; onCambio: () => void }) {
  const sep = query ? "&" : "?";
  const [lista, setLista] = useState<Categoria[]>([]);
  const [nueva, setNueva] = useState({ nombre: "", color: 7 });
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    get<Categoria[]>(`/categorias${query}${sep}modelo=${modelo}`).then(setLista);
  }, [query, sep, modelo]);
  useEffect(cargar, [cargar]);

  async function ejecutar(f: () => Promise<unknown>) {
    setError(null);
    try {
      await f();
      cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title={TITULOS[modelo]} onClose={onCerrar} ancho="lg">
      <div className="space-y-4">
        {puedeEditar && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (nueva.nombre.trim()) ejecutar(async () => (await post(`/categorias${query}${sep}modelo=${modelo}`, { nombre: nueva.nombre.trim(), color: nueva.color }), setNueva({ ...nueva, nombre: "" })));
            }}
          >
            <div className="min-w-48 flex-1">
              <label className="label">Nueva categoría</label>
              <input className="input" maxLength={60} value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} placeholder="p. ej. Operativo, Temporada alta…" />
            </div>
            <Paleta valor={nueva.color} onCambio={(color) => setNueva({ ...nueva, color })} />
            <button className="btn-primary" disabled={!nueva.nombre.trim()}>
              <Icono nombre="plus" /> Agregar
            </button>
          </form>
        )}
        <ErrorBox message={error} />
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {lista.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Aún no hay categorías.</li>}
          {lista.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              {puedeEditar ? (
                <input
                  className="input max-w-xs flex-1 py-1.5"
                  defaultValue={c.nombre}
                  maxLength={60}
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.nombre && ejecutar(() => api(`/categorias/${c.id}${query}`, { method: "PATCH", body: JSON.stringify({ nombre: e.target.value.trim(), color: c.color }) }))}
                />
              ) : (
                <Chip c={c} />
              )}
              {puedeEditar && <Paleta valor={c.color} onCambio={(color) => ejecutar(() => api(`/categorias/${c.id}${query}`, { method: "PATCH", body: JSON.stringify({ nombre: c.nombre, color }) }))} />}
              <span className="ml-auto text-xs text-slate-500">{c.registros} registro(s)</span>
              {puedeEditar && (
                <button
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title="Eliminar"
                  aria-label={`Eliminar ${c.nombre}`}
                  onClick={() => confirm(`¿Eliminar la categoría “${c.nombre}”? Se quitará de ${c.registros} registro(s).`) && ejecutar(() => api(`/categorias/${c.id}${query}`, { method: "DELETE" }))}
                >
                  <Icono nombre="trash" className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function Paleta({ valor, onCambio }: { valor: number; onCambio: (c: number) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Color">
      {COLORES_CATEGORIA.map((cls, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={valor === i}
          onClick={() => onCambio(i)}
          className={`h-6 w-6 rounded-full ${cls.split(" ")[0]} ${valor === i ? "ring-2 ring-navy-900 ring-offset-1" : ""}`}
          aria-label={`Color ${i + 1}`}
        />
      ))}
    </div>
  );
}

/** Helpers para las vistas: columna y filtros de categorías. */
export function columnaCategorias<T>(clave: (r: T) => string, de: (id: string) => Categoria[]) {
  return {
    clave: "categorias",
    titulo: "Categorías",
    buscable: true,
    agrupable: true,
    valor: (r: T) => de(clave(r)).map((c) => c.nombre).join(", "),
    render: (r: T) => <Chips lista={de(clave(r))} />,
  };
}

export function filtrosCategorias<T>(lista: Categoria[], clave: (r: T) => string, asignadas: Record<string, string[]>) {
  return lista.map((c) => ({ clave: `cat_${c.id}`, titulo: c.nombre, grupo: "categorias", prueba: (r: T) => (asignadas[clave(r)] ?? []).includes(c.id) }));
}
