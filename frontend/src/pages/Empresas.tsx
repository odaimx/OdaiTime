import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Badge, ErrorBox, Modal, PageHeader } from "../components/ui";
import { get, patch, post, type Empresa } from "../lib/api";

type Form = { nombre: string; razon_social: string; rfc: string; admin_nombre: string; admin_email: string; admin_password: string };
const VACIO: Form = { nombre: "", razon_social: "", rfc: "", admin_nombre: "", admin_email: "", admin_password: "" };

export default function Empresas() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [editando, setEditando] = useState<Empresa | "nueva" | null>(null);
  const [form, setForm] = useState<Form>(VACIO);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => get<Empresa[]>("/empresas").then(setEmpresas), []);
  useEffect(() => void cargar(), [cargar]);

  function abrir(e: Empresa | "nueva") {
    setError(null);
    setForm(e === "nueva" ? VACIO : { ...VACIO, nombre: e.nombre, razon_social: e.razon_social ?? "", rfc: e.rfc ?? "" });
    setEditando(e);
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const datos = { nombre: form.nombre, razon_social: form.razon_social || null, rfc: form.rfc || null };
    try {
      if (editando === "nueva") {
        await post("/empresas", {
          ...datos,
          admin: { nombre: form.admin_nombre, email: form.admin_email, password: form.admin_password },
        });
      } else if (editando) {
        await patch(`/empresas/${editando.id}`, datos);
      }
      setEditando(null);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {empresas.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-navy-900">{e.nombre}</p>
                  {e.razon_social && <p className="text-xs text-slate-500">{e.razon_social}</p>}
                </td>
                <td className="hidden px-4 py-3 font-mono text-xs sm:table-cell">{e.rfc ?? "—"}</td>
                <td className="px-4 py-3"><Badge ok={e.activa}>{e.activa ? "Activa" : "Inactiva"}</Badge></td>
                <td className="space-x-3 px-4 py-3 text-right">
                  <button className="text-brand-600 hover:underline" onClick={() => abrir(e)}>Editar</button>
                  <button className="text-slate-500 hover:underline" onClick={() => alternar(e)}>{e.activa ? "Desactivar" : "Activar"}</button>
                </td>
              </tr>
            ))}
            {empresas.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-500">Aún no hay empresas.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editando && (
        <Modal title={editando === "nueva" ? "Nueva empresa" : "Editar empresa"} onClose={() => setEditando(null)}>
          <form onSubmit={guardar} className="space-y-4">
            <div>
              <label className="label">Nombre comercial</label>
              <input className="input" required value={form.nombre} onChange={set("nombre")} />
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
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setEditando(null)}>Cancelar</button>
              <button type="submit" className="btn-primary">Guardar</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
