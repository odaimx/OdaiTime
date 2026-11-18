import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import Bitacora from "../components/Bitacora";
import Registro, { useFormulario } from "../components/Registro";
import Vista, { useVista, type ConfigVista } from "../components/Vista";
import { Badge, ErrorBox, PageHeader, useEmpresaScope } from "../components/ui";
import { get, patch, post, ZONAS_MX, type Sucursal } from "../lib/api";
import { useAuth } from "../lib/auth";

type Form = { clave: string; nombre: string; zona_horaria: string; direccion: string; latitud: string; longitud: string; radio_metros: string };
const VACIO: Form = { clave: "", nombre: "", zona_horaria: "America/Mexico_City", direccion: "", latitud: "", longitud: "", radio_metros: "150" };

const zonaLabel = (z: string) => ZONAS_MX.find((x) => x.value === z)?.label ?? z;

const aForm = (s: Sucursal): Form => ({
  clave: s.clave,
  nombre: s.nombre,
  zona_horaria: s.zona_horaria,
  direccion: s.direccion ?? "",
  latitud: s.latitud?.toString() ?? "",
  longitud: s.longitud?.toString() ?? "",
  radio_metros: String(s.radio_metros),
});

export default function Sucursales() {
  const { usuario } = useAuth();
  const puedeEditar = usuario?.rol === "superadmin" || usuario?.rol === "admin_empresa";
  const { query, listo, selector } = useEmpresaScope();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [editando, setEditando] = useState<Sucursal | "nueva" | null>(null);
  const { form, setForm, cargar: cargarForm, sucio, descartar } = useFormulario<Form>(VACIO);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (listo) get<Sucursal[]>(`/sucursales${query}`).then(setSucursales);
  }, [query, listo]);
  useEffect(cargar, [cargar]);

  function abrir(s: Sucursal | "nueva") {
    setError(null);
    cargarForm(s === "nueva" ? VACIO : aForm(s));
    setEditando(s);
  }

  async function guardar(): Promise<boolean> {
    setError(null);
    const datos = {
      clave: form.clave.trim().toUpperCase(),
      nombre: form.nombre,
      zona_horaria: form.zona_horaria,
      direccion: form.direccion || null,
      latitud: form.latitud ? Number(form.latitud) : null,
      longitud: form.longitud ? Number(form.longitud) : null,
      radio_metros: Number(form.radio_metros) || 150,
    };
    try {
      const r =
        editando === "nueva" ? await post<Sucursal>(`/sucursales${query}`, datos) : await patch<Sucursal>(`/sucursales/${(editando as Sucursal).id}${query}`, datos);
      cargarForm(aForm(r));
      setEditando(r);
      setSucursales((lista) => (lista.some((x) => x.id === r.id) ? lista.map((x) => (x.id === r.id ? r : x)) : [...lista, r]));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function alternar(s: Sucursal) {
    const r = await patch<Sucursal>(`/sucursales/${s.id}${query}`, { activa: !s.activa });
    setEditando(r);
    cargar();
  }

  const config: ConfigVista<Sucursal> = {
    id: "sucursales",
    clave: (s) => s.id,
    onAbrir: abrir,
    actividades: { modelo: "sucursal", query, listo },
    vacio: "Aún no hay sucursales.",
    ordenInicial: { clave: "clave", dir: "asc" },
    columnas: [
      { clave: "clave", titulo: "Clave", fija: true, buscable: true, valor: (s) => s.clave, render: (s) => <span className="font-mono text-xs font-semibold text-brand-600">{s.clave}</span> },
      {
        clave: "nombre",
        titulo: "Nombre",
        buscable: true,
        valor: (s) => s.nombre,
        render: (s) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-navy-900">{s.nombre}</p>
            {s.direccion && <p className="truncate text-xs text-slate-500">{s.direccion}</p>}
          </div>
        ),
      },
      { clave: "direccion", titulo: "Dirección", buscable: true, visible: false, valor: (s) => s.direccion },
      { clave: "zona", titulo: "Zona horaria", agrupable: true, valor: (s) => zonaLabel(s.zona_horaria) },
      {
        clave: "geocerca",
        titulo: "Geocerca",
        agrupable: true,
        valor: (s) => (s.latitud != null && s.longitud != null ? `${s.radio_metros} m` : "Sin ubicación"),
        render: (s) => (s.latitud != null && s.longitud != null ? `${s.radio_metros} m` : <span className="text-slate-400">Sin ubicación</span>),
      },
      { clave: "estado", titulo: "Estado", agrupable: true, valor: (s) => (s.activa ? "Activa" : "Inactiva"), render: (s) => <Badge ok={s.activa}>{s.activa ? "Activa" : "Inactiva"}</Badge> },
    ],
    filtros: [
      { clave: "sin_ubicacion", titulo: "Sin ubicación (geocerca)", grupo: "datos", prueba: (s) => s.latitud == null || s.longitud == null },
      { clave: "activas", titulo: "Activas", grupo: "estado", prueba: (s) => s.activa },
      { clave: "inactivas", titulo: "Inactivas", grupo: "estado", prueba: (s) => !s.activa },
    ],
    filtrosIniciales: ["activas"],
    kanban: (s) => (
      <div className="space-y-1 pr-6">
        <div className="flex items-center gap-2">
          <span className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-brand-700">{s.clave}</span>
          <p className="truncate font-semibold text-navy-900">{s.nombre}</p>
        </div>
        <p className="truncate text-xs text-slate-500">{s.direccion ?? "Sin dirección"}</p>
        <p className="text-xs text-slate-600">{zonaLabel(s.zona_horaria)}</p>
        <div className="flex gap-1 pt-1">
          {s.latitud != null && s.longitud != null ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Geocerca {s.radio_metros} m</span>
          ) : (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Sin ubicación</span>
          )}
          {!s.activa && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Inactiva</span>}
        </div>
      </div>
    ),
  };
  const vista = useVista(config, sucursales);
  const enOrden = vista.ordenados;
  const indice = editando && editando !== "nueva" ? enOrden.findIndex((x) => x.id === editando.id) : -1;

  const set = (k: keyof Form) => (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: ev.target.value });

  return (
    <>
      <PageHeader
        title="Sucursales"
        subtitle="Cada sucursal tiene su zona horaria y su geocerca para validar checadas"
        action={
          <div className="flex flex-col gap-3 sm:flex-row">
            {selector}
            {puedeEditar && listo && <button className="btn-primary" onClick={() => abrir("nueva")}>Nueva sucursal</button>}
          </div>
        }
      />

      <Vista vista={vista} />

      {editando && (
        <Registro
          titulo={editando === "nueva" ? "Nueva sucursal" : `${editando.clave} · ${editando.nombre}`}
          indice={indice >= 0 ? indice : undefined}
          total={enOrden.length}
          onIr={(i) => abrir(enOrden[i])}
          sucio={puedeEditar && sucio}
          onGuardar={puedeEditar ? guardar : undefined}
          onDescartar={descartar}
          onCerrar={() => setEditando(null)}
          ancho="md"
        >
          <form onSubmit={(e: FormEvent) => (e.preventDefault(), guardar())} className="space-y-4">
            <fieldset disabled={!puedeEditar} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="label">Clave</label>
                <input className="input uppercase" required maxLength={20} pattern="[A-Za-z0-9_\-]+" title="Letras, números, guion o guion bajo" value={form.clave} onChange={set("clave")} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Nombre</label>
                <input className="input" required value={form.nombre} onChange={set("nombre")} />
              </div>
            </div>
            <div>
              <label className="label">Zona horaria</label>
              <select className="input" value={form.zona_horaria} onChange={set("zona_horaria")}>
                {ZONAS_MX.map((z) => (
                  <option key={z.value} value={z.value}>{z.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Dirección</label>
              <input className="input" value={form.direccion} onChange={set("direccion")} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="label">Latitud</label>
                <input className="input" type="number" step="any" min={-90} max={90} placeholder="21.1619" value={form.latitud} onChange={set("latitud")} />
              </div>
              <div>
                <label className="label">Longitud</label>
                <input className="input" type="number" step="any" min={-180} max={180} placeholder="-86.8515" value={form.longitud} onChange={set("longitud")} />
              </div>
              <div>
                <label className="label">Radio (m)</label>
                <input className="input" type="number" min={10} max={5000} value={form.radio_metros} onChange={set("radio_metros")} />
              </div>
            </div>
            <p className="text-xs text-slate-500">Tip: en Google Maps, clic derecho sobre la sucursal para copiar las coordenadas.</p>
            </fieldset>

            {editando !== "nueva" && puedeEditar && (
              <div className="flex justify-end">
                <button type="button" className="text-sm text-slate-500 hover:text-navy-900 hover:underline" onClick={() => alternar(editando)}>
                  {editando.activa ? "Desactivar sucursal" : "Activar sucursal"}
                </button>
              </div>
            )}
            {editando !== "nueva" && (
              <details className="rounded-lg border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-medium text-navy-900">Historial de cambios</summary>
                <div className="mt-3">
                  <Bitacora modelo="sucursal" registroId={editando.id} query={query} />
                </div>
              </details>
            )}
            <ErrorBox message={error} />
            <button type="submit" className="sr-only">Guardar</button>
          </form>
        </Registro>
      )}
    </>
  );
}
