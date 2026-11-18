import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import Registro, { useFormulario } from "../components/Registro";
import { Badge, ErrorBox, PageHeader } from "../components/ui";
import { get, patch, post, type Empresa, type TenantInfo } from "../lib/api";

type Form = { nombre: string; slug: string; razon_social: string; rfc: string; max_empleados: string; licencia_vence: string; admin_nombre: string; admin_email: string; admin_password: string };
const VACIO: Form = { nombre: "", slug: "", razon_social: "", rfc: "", max_empleados: "15", licencia_vence: "", admin_nombre: "", admin_email: "", admin_password: "" };

export default function Empresas() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [editando, setEditando] = useState<Empresa | "nueva" | null>(null);
  const { form, setForm, cargar: cargarForm, sucio, descartar } = useFormulario<Form>(VACIO);
  const [error, setError] = useState<string | null>(null);

  const [SUFIJO, setSufijo] = useState<string | null>(null); // dominio de los clientes, p. ej. odai.lat

  const cargar = useCallback(() => get<Empresa[]>("/empresas").then(setEmpresas), []);
  useEffect(() => {
    get<TenantInfo>("/tenant").then((t) => setSufijo(t.dominio ?? null)).catch(() => {});
  }, []);
  useEffect(() => void cargar(), [cargar]);

  function abrir(e: Empresa | "nueva") {
    setError(null);
    cargarForm(
      e === "nueva"
        ? VACIO
        : { ...VACIO, nombre: e.nombre, slug: e.slug, razon_social: e.razon_social ?? "", rfc: e.rfc ?? "", max_empleados: String(e.max_empleados), licencia_vence: e.licencia_vence ?? "" },
    );
    setEditando(e);
  }

  async function guardar(): Promise<boolean> {
    setError(null);
    const datos = {
      nombre: form.nombre,
      ...(form.slug.trim() ? { slug: form.slug.trim().toLowerCase() } : {}),
      razon_social: form.razon_social || null,
      rfc: form.rfc || null,
      max_empleados: Number(form.max_empleados) || 15,
      licencia_vence: form.licencia_vence || null,
    };
    try {
      const r =
        editando === "nueva"
          ? await post<Empresa>("/empresas", {
              ...datos,
              admin: { nombre: form.admin_nombre, email: form.admin_email, password: form.admin_password },
            })
          : await patch<Empresa>(`/empresas/${(editando as Empresa).id}`, datos);
      abrir(r);
      setEmpresas((lista) => (lista.some((x) => x.id === r.id) ? lista.map((x) => (x.id === r.id ? r : x)) : [...lista, r]));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  const indice = editando && editando !== "nueva" ? empresas.findIndex((x) => x.id === editando.id) : -1;

  async function alternar(e: Empresa) {
    await patch(`/empresas/${e.id}`, { activa: !e.activa });
    cargar();
  }

  const set = (k: keyof Form) => (ev: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: ev.target.value });

  return (
    <>
      <PageHeader
        title="Empresas"
        subtitle="Clientes de ODAITIME"
        action={<button className="btn-primary" onClick={() => abrir("nueva")}>Nueva empresa</button>}
      />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="hidden px-4 py-3 sm:table-cell">RFC</th>
              <th className="px-4 py-3">Licencia</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {empresas.map((e) => (
              <tr key={e.id} className="cursor-pointer hover:bg-brand-50/50" onClick={() => abrir(e)}>
                <td className="px-4 py-3">
                  <p className="font-medium text-navy-900">{e.nombre}</p>
                  {e.razon_social && <p className="text-xs text-slate-500">{e.razon_social}</p>}
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} className="font-mono text-xs text-brand-600 hover:underline">
                      {e.url.replace("https://", "")}
                    </a>
                  ) : (
                    <p className="font-mono text-xs text-slate-400">{e.slug}</p>
                  )}
                </td>
                <td className="hidden px-4 py-3 font-mono text-xs sm:table-cell">{e.rfc ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">
                  {e.max_empleados} empleados
                  {e.licencia_vence && <p className="text-xs text-slate-400">vence {e.licencia_vence}</p>}
                </td>
                <td className="px-4 py-3"><Badge ok={e.activa}>{e.activa ? "Activa" : "Inactiva"}</Badge></td>
                <td className="space-x-3 px-4 py-3 text-right">
                  <button className="text-slate-500 hover:underline" onClick={(ev) => (ev.stopPropagation(), alternar(e))}>{e.activa ? "Desactivar" : "Activar"}</button>
                </td>
              </tr>
            ))}
            {empresas.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Aún no hay empresas.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editando && (
        <Registro
          titulo={editando === "nueva" ? "Nueva empresa" : editando.nombre}
          indice={indice >= 0 ? indice : undefined}
          total={empresas.length}
          onIr={(i) => abrir(empresas[i])}
          sucio={sucio}
          onGuardar={guardar}
          onDescartar={descartar}
          onCerrar={() => setEditando(null)}
          ancho="md"
        >
          <form onSubmit={(ev: FormEvent) => (ev.preventDefault(), guardar())} className="space-y-4">
            <div>
              <label className="label">Nombre comercial</label>
              <input className="input" required value={form.nombre} onChange={set("nombre")} />
            </div>
            <div>
              <label className="label">Subdominio</label>
              <div className="flex items-center">
                <input
                  className={`input font-mono lowercase ${SUFIJO ? "rounded-r-none" : ""}`}
                  placeholder={editando === "nueva" ? "se genera del nombre" : ""}
                  pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
                  title="De 3 a 40 caracteres: letras minúsculas, números y guiones"
                  value={form.slug}
                  onChange={set("slug")}
                />
                {SUFIJO && (
                  <span className="rounded-r-lg border border-l-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">.{SUFIJO}</span>
                )}
              </div>
              {editando !== "nueva" && <p className="mt-1 text-xs text-amber-700">Si lo cambias, la dirección anterior deja de funcionar.</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Razón social</label>
                <input className="input" value={form.razon_social} onChange={set("razon_social")} />
              </div>
              <div>
                <label className="label">RFC</label>
                <input className="input uppercase" maxLength={13} value={form.rfc} onChange={set("rfc")} />
              </div>
            </div>

            <fieldset className="grid grid-cols-1 gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
              <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">Licencia</legend>
              <div>
                <label className="label">Empleados activos permitidos</label>
                <input className="input" type="number" min={1} required value={form.max_empleados} onChange={set("max_empleados")} />
              </div>
              <div>
                <label className="label">Vence (opcional)</label>
                <input className="input" type="date" value={form.licencia_vence} onChange={set("licencia_vence")} />
              </div>
            </fieldset>

            {editando === "nueva" && (
              <fieldset className="space-y-4 rounded-lg bg-brand-50 p-4">
                <legend className="px-1 text-sm font-medium text-brand-700">Administrador de la empresa</legend>
                <div>
                  <label className="label">Nombre</label>
                  <input className="input" required value={form.admin_nombre} onChange={set("admin_nombre")} />
                </div>
                <div>
                  <label className="label">Correo</label>
                  <input className="input" type="email" required value={form.admin_email} onChange={set("admin_email")} />
                </div>
                <div>
                  <label className="label">Contraseña temporal</label>
                  <input className="input" type="password" minLength={8} required value={form.admin_password} onChange={set("admin_password")} />
                </div>
              </fieldset>
            )}

            <ErrorBox message={error} />
            <button type="submit" className="sr-only">Guardar</button>
          </form>
        </Registro>
      )}
    </>
  );
}
