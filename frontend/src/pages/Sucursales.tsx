import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import Bitacora from "../components/Bitacora";
import Registro, { useFormulario } from "../components/Registro";
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

  const indice = editando && editando !== "nueva" ? sucursales.findIndex((x) => x.id === editando.id) : -1;

  async function alternar(s: Sucursal) {
    await patch(`/sucursales/${s.id}${query}`, { activa: !s.activa });
    cargar();
  }

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

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Clave</th>
              <th className="px-4 py-3">Nombre</th>
              <th className="hidden px-4 py-3 md:table-cell">Zona horaria</th>
              <th className="hidden px-4 py-3 lg:table-cell">Geocerca</th>
              <th className="px-4 py-3">Estado</th>
              {puedeEditar && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sucursales.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-brand-50/50" onClick={() => abrir(s)}>
                <td className="px-4 py-3">
                  <button type="button" className="font-mono text-xs font-semibold text-brand-600 hover:underline" onClick={() => abrir(s)}>
                    {s.clave}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-navy-900">{s.nombre}</p>
                  {s.direccion && <p className="text-xs text-slate-500">{s.direccion}</p>}
                </td>
                <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{zonaLabel(s.zona_horaria)}</td>
                <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                  {s.latitud != null && s.longitud != null ? `${s.radio_metros} m` : <span className="text-slate-400">Sin ubicación</span>}
                </td>
                <td className="px-4 py-3"><Badge ok={s.activa}>{s.activa ? "Activa" : "Inactiva"}</Badge></td>
                {puedeEditar && (
                  <td className="space-x-3 whitespace-nowrap px-4 py-3 text-right">
                    <button className="text-slate-500 hover:underline" onClick={(e) => (e.stopPropagation(), alternar(s))}>{s.activa ? "Desactivar" : "Activar"}</button>
                  </td>
                )}
              </tr>
            ))}
            {sucursales.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Aún no hay sucursales.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editando && (
        <Registro
          titulo={editando === "nueva" ? "Nueva sucursal" : `${editando.clave} · ${editando.nombre}`}
          indice={indice >= 0 ? indice : undefined}
          total={sucursales.length}
          onIr={(i) => abrir(sucursales[i])}
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
