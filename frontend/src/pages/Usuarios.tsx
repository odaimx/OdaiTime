import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import Registro, { useFormulario } from "../components/Registro";
import Icono from "../components/Iconos";
import { columnaCategorias, filtrosCategorias, GestorCategorias, SelectorCategorias, useCategorias } from "../components/Categorias";
import Vista, { useVista, type ConfigVista } from "../components/Vista";
import { Badge, ErrorBox, PageHeader, useEmpresaScope } from "../components/ui";
import { get, patch, post, ROLES, type Categoria, type Rol, type Sucursal, type Usuario } from "../lib/api";
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
  const { form, setForm, cargar: cargarForm, sucio, descartar } = useFormulario<Form>(VACIO);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!listo) return;
    get<Usuario[]>(`/usuarios${query}`).then(setUsuarios);
    get<Sucursal[]>(`/sucursales${query}`).then(setSucursales);
  }, [query, listo]);
  useEffect(cargar, [cargar]);

  function abrir(u: Usuario | "nuevo") {
    setError(null);
    cargarForm(u === "nuevo" ? VACIO : { nombre: u.nombre, email: u.email, password: "", rol: u.rol, sucursal_ids: u.sucursales.map((s) => s.id) });
    setEditando(u);
  }

  async function guardar(): Promise<boolean> {
    setError(null);
    try {
      let r: Usuario;
      if (editando === "nuevo") {
        r = await post<Usuario>(`/usuarios${query}`, form);
      } else {
        const { email: _email, password, ...resto } = form;
        r = await patch<Usuario>(`/usuarios/${(editando as Usuario).id}${query}`, password ? { ...resto, password } : resto);
      }
      abrir(r);
      setUsuarios((lista) => (lista.some((x) => x.id === r.id) ? lista.map((x) => (x.id === r.id ? r : x)) : [...lista, r]));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function alternar(u: Usuario) {
    try {
      const r = await patch<Usuario>(`/usuarios/${u.id}${query}`, { activo: !u.activo });
      setEditando(r);
      cargar();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const cats = useCategorias("usuario", query, listo);
  const [gestorCats, setGestorCats] = useState(false);
  const config: ConfigVista<Usuario> = {
    id: "usuarios",
    tituloReporte: "Usuarios",
    clave: (u) => u.id,
    onAbrir: abrir,
    acciones: listo && (
      <button className="btn-primary" onClick={() => abrir("nuevo")}>
        <Icono nombre="user-round-plus" /> Nuevo
      </button>
    ),
    vacio: "Aún no hay usuarios.",
    ordenInicial: { clave: "nombre", dir: "asc" },
    columnas: [
      {
        clave: "nombre",
        titulo: "Usuario",
        fija: true,
        buscable: true,
        valor: (u) => u.nombre,
        render: (u) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-xs font-semibold text-tinta-900">{u.nombre.slice(0, 2).toUpperCase()}</span>
            <span className="truncate font-medium text-tinta-900">{u.nombre}</span>
          </div>
        ),
      },
      { clave: "email", titulo: "Correo", buscable: true, valor: (u) => u.email },
      { clave: "rol", titulo: "Rol", agrupable: true, valor: (u) => ROLES[u.rol] },
      { clave: "sucursales", titulo: "Sucursales", buscable: true, valor: (u) => (u.rol === "admin_empresa" ? "Todas" : u.sucursales.map((x) => x.clave).join(", ")) },
      { clave: "acceso", titulo: "Último acceso", valor: (u) => u.ultimo_acceso, render: (u) => fecha(u.ultimo_acceso) },
      { clave: "estado", titulo: "Estado", agrupable: true, valor: (u) => (u.activo ? "Activo" : "Inactivo"), render: (u) => <Badge ok={u.activo}>{u.activo ? "Activo" : "Inactivo"}</Badge> },
      columnaCategorias<Usuario>((u) => u.id, cats.de),
    ],
    filtros: [
      ...filtrosCategorias<Usuario>(cats.lista, (u) => u.id, cats.asignadas),
      { clave: "admins", titulo: "Administradores", grupo: "rol", prueba: (u) => u.rol === "admin_empresa" },
      { clave: "gerentes", titulo: "Gerentes de sucursal", grupo: "rol", prueba: (u) => u.rol === "gerente_sucursal" },
      { clave: "empleados", titulo: "Empleados", grupo: "rol", prueba: (u) => u.rol === "empleado" },
      { clave: "nunca", titulo: "Nunca han entrado", grupo: "acceso", prueba: (u) => !u.ultimo_acceso },
      { clave: "activos", titulo: "Activos", grupo: "estado", prueba: (u) => u.activo },
      { clave: "inactivos", titulo: "Inactivos", grupo: "estado", prueba: (u) => !u.activo },
    ],
    filtrosIniciales: ["activos"],
    kanban: (u) => (
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent-500/15 font-semibold text-tinta-900">{u.nombre.slice(0, 2).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-tinta-900">{u.nombre}</p>
          <p className="truncate text-xs text-slate-500">{u.email}</p>
          <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">{ROLES[u.rol]}</span>
          {!u.activo && <span className="ml-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Inactivo</span>}
        </div>
      </div>
    ),
  };
  const vista = useVista(config, usuarios);
  const enOrden = vista.ordenados;
  const indice = editando && editando !== "nuevo" ? enOrden.findIndex((x) => x.id === editando.id) : -1;

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
        submenu={[
          { etiqueta: "Usuarios", activo: true },
          { etiqueta: "Categorías", onClick: () => setGestorCats(true) },
        ]}
        icono="users"
        title="Usuarios"
        subtitle="Quién entra a ODAITIME y qué puede ver"
        action={selector}
      />
      {gestorCats && <GestorCategorias modelo="usuario" query={query} puedeEditar={true} onCerrar={() => setGestorCats(false)} onCambio={cats.recargar} />}

      <Vista vista={vista} />

      {editando && (
        <Registro
          titulo={editando === "nuevo" ? "Nuevo usuario" : editando.nombre}
          subtitulo={editando !== "nuevo" ? editando.email : undefined}
          indice={indice >= 0 ? indice : undefined}
          total={enOrden.length}
          onIr={(i) => abrir(enOrden[i])}
          sucio={sucio}
          onGuardar={guardar}
          onDescartar={descartar}
          onCerrar={() => setEditando(null)}
        >
          <form onSubmit={(e: FormEvent) => (e.preventDefault(), guardar())} className="form-2col">
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
                      <span className="text-tinta-900">{s.nombre}</span>
                    </label>
                  ))}
                  {sucursales.length === 0 && <p className="px-2 py-1 text-sm text-slate-500">Primero da de alta sucursales.</p>}
                </div>
              </div>
            )}

            {editando !== "nuevo" && (
              <div>
                <SelectorCategorias
                  todas={cats.lista}
                  valor={cats.asignadas[editando.id] ?? []}
                  onCambio={(ids) => cats.asignar(editando.id, ids).then(cats.recargar)}
                  puedeCrear={true}
                  onCrear={async (nombre) => {
                    const c = await post<Categoria>(`/categorias${query || "?"}${query ? "&" : ""}modelo=usuario`, { nombre, color: "#8a64de" });
                    cats.recargar();
                    return c;
                  }}
                />
              </div>
            )}
            {editando !== "nuevo" && editando.id !== yo?.id && (
              <div className="completo flex justify-end">
                <button type="button" className="text-sm text-slate-500 hover:text-tinta-900 hover:underline" onClick={() => alternar(editando)}>
                  {editando.activo ? "Desactivar usuario" : "Activar usuario"}
                </button>
              </div>
            )}
            <ErrorBox message={error} />
            <button type="submit" className="sr-only">Guardar</button>
          </form>
        </Registro>
      )}
    </>
  );
}
