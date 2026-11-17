import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Badge, ErrorBox, Modal, PageHeader, useEmpresaScope } from "../components/ui";
import { get, patch, post, ROLES, type Rol, type Sucursal, type Usuario } from "../lib/api";
import { useAuth } from "../lib/auth";

type Form = { nombre: string; email: string; password: string; rol: Rol; sucursal_ids: string[] };
const VACIO: Form = { nombre: "", email: "", password: "", rol: "empleado", sucursal_ids: [] };
const ROLES_ASIGNABLES: Rol[] = ["admin_empresa", "gerente_sucursal", "empleado"];

function fecha(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "Nunca";
}

export default function Usuarios() {
  const { usuario: yo } = useAuth();
  const { query, listo, selector } = useEmpresaScope();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [editando, setEditando] = useState<Usuario | "nuevo" | null>(null);
  const [form, setForm] = useState<Form>(VACIO);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!listo) return;
    get<Usuario[]>(`/usuarios${query}`).then(setUsuarios);
    get<Sucursal[]>(`/sucursales${query}`).then(setSucursales);
  }, [query, listo]);
  useEffect(cargar, [cargar]);

  function abrir(u: Usuario | "nuevo") {
    setError(null);
    setForm(u === "nuevo" ? VACIO : { nombre: u.nombre, email: u.email, password: "", rol: u.rol, sucursal_ids: u.sucursales.map((s) => s.id) });
    setEditando(u);
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    try {
      if (editando === "nuevo") {
        await post(`/usuarios${query}`, form);
      } else if (editando) {
        const { email: _email, password, ...resto } = form;
        await patch(`/usuarios/${editando.id}${query}`, password ? { ...resto, password } : resto);
      }
      setEditando(null);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function alternar(u: Usuario) {
    try {
      await patch(`/usuarios/${u.id}${query}`, { activo: !u.activo });
      cargar();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const set = (k: "nombre" | "email" | "password" | "rol") => (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: ev.target.value });

  function toggleSucursal(id: string) {
    setForm((f) => ({
      ...f,
      sucursal_ids: f.sucursal_ids.includes(id) ? f.sucursal_ids.filter((x) => x !== id) : [...f.sucursal_ids, id],
    }));
  }

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Quién entra a ODAITIME y qué puede ver"
        action={
          <div className="flex flex-col gap-3 sm:flex-row">
            {selector}
            {listo && <button className="btn-primary" onClick={() => abrir("nuevo")}>Nuevo usuario</button>}
          </div>
        }
      />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Usuario</th>
              <th className="px-4 py-3">Rol</th>
              <th className="hidden px-4 py-3 md:table-cell">Sucursales</th>
              <th className="hidden px-4 py-3 lg:table-cell">Último acceso</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-navy-900">{u.nombre}</p>
                  <p className="text-xs text-slate-500">{u.email}</p>
                </td>
                <td className="px-4 py-3 text-slate-600">{ROLES[u.rol]}</td>
                <td className="hidden px-4 py-3 text-slate-600 md:table-cell">
                  {u.rol === "admin_empresa" ? <span className="text-slate-400">Todas</span> : u.sucursales.map((s) => s.clave).join(", ") || "—"}
                </td>
                <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">{fecha(u.ultimo_acceso)}</td>
                <td className="px-4 py-3"><Badge ok={u.activo}>{u.activo ? "Activo" : "Inactivo"}</Badge></td>
                <td className="space-x-3 whitespace-nowrap px-4 py-3 text-right">
                  <button className="text-brand-600 hover:underline" onClick={() => abrir(u)}>Editar</button>
                  {u.id !== yo?.id && (
                    <button className="text-slate-500 hover:underline" onClick={() => alternar(u)}>{u.activo ? "Desactivar" : "Activar"}</button>
                  )}
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Aún no hay usuarios.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editando && (
        <Modal title={editando === "nuevo" ? "Nuevo usuario" : "Editar usuario"} onClose={() => setEditando(null)}>
          <form onSubmit={guardar} className="space-y-4">
            <div>
              <label className="label">Nombre</label>
              <input className="input" required value={form.nombre} onChange={set("nombre")} />
            </div>
            <div>
              <label className="label">Correo</label>
              <input className="input" type="email" required disabled={editando !== "nuevo"} value={form.email} onChange={set("email")} />
            </div>
            <div>
              <label className="label">{editando === "nuevo" ? "Contraseña temporal" : "Nueva contraseña (opcional)"}</label>
              <input className="input" type="password" minLength={8} required={editando === "nuevo"} value={form.password} onChange={set("password")} />
            </div>
            <div>
              <label className="label">Rol</label>
              <select className="input" value={form.rol} onChange={set("rol")} disabled={editando !== "nuevo" && editando.id === yo?.id}>
                {ROLES_ASIGNABLES.map((r) => (
                  <option key={r} value={r}>{ROLES[r]}</option>
                ))}
              </select>
            </div>

            {form.rol !== "admin_empresa" && (
              <div>
                <label className="label">
                  Sucursales {form.rol === "gerente_sucursal" && <span className="text-red-600">*</span>}
                </label>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {sucursales.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                      <input type="checkbox" className="accent-brand-500" checked={form.sucursal_ids.includes(s.id)} onChange={() => toggleSucursal(s.id)} />
                      <span className="font-mono text-xs text-brand-600">{s.clave}</span>
                      <span className="text-navy-900">{s.nombre}</span>
                    </label>
                  ))}
                  {sucursales.length === 0 && <p className="px-2 py-1 text-sm text-slate-500">Primero da de alta sucursales.</p>}
                </div>
              </div>
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
