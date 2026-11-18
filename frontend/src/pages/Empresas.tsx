import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import CorreoSaliente from "../components/CorreoSaliente";
import FondoEmpresa from "../components/FondoEmpresa";
import LogoEmpresa from "../components/LogoEmpresa";
import Registro, { useFormulario } from "../components/Registro";
import Icono from "../components/Iconos";
import { columnaCategorias, filtrosCategorias, GestorCategorias, SelectorCategorias, useCategorias } from "../components/Categorias";
import Vista, { useVista, type ConfigVista } from "../components/Vista";
import { Badge, ErrorBox, PageHeader } from "../components/ui";
import { get, patch, post, urlLogo, type Categoria, type Empresa, type TenantInfo } from "../lib/api";

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

  async function alternar(e: Empresa) {
    const r = await patch<Empresa>(`/empresas/${e.id}`, { activa: !e.activa });
    setEditando(r);
    cargar();
  }

  const hoy = new Date().toLocaleDateString("en-CA");
  const en30 = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString("en-CA");
  const logo = (e: Empresa, tam: string) =>
    e.logo_version ? (
      <img src={urlLogo(e.id, e.logo_version)} alt="" className={`${tam} shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-slate-200`} />
    ) : (
      <span className={`${tam} flex shrink-0 items-center justify-center rounded-lg bg-navy-900 text-xs font-semibold text-white`}>{e.nombre.slice(0, 2).toUpperCase()}</span>
    );
  const cats = useCategorias("empresa", "", true);
  const [gestorCats, setGestorCats] = useState(false);
  const config: ConfigVista<Empresa> = {
    id: "empresas",
    tituloReporte: "Empresas",
    ajustes: { titulo: "Correo saliente", ancho: "xl", contenido: <CorreoSaliente /> },
    clave: (e) => e.id,
    onAbrir: abrir,
    acciones: (
      <button className="btn-primary" onClick={() => abrir("nueva")}>
        <Icono nombre="plus" /> Nuevo
      </button>
    ),
    vacio: "Aún no hay empresas.",
    ordenInicial: { clave: "nombre", dir: "asc" },
    columnas: [
      {
        clave: "nombre",
        titulo: "Empresa",
        fija: true,
        buscable: true,
        valor: (e) => e.nombre,
        render: (e) => (
          <div className="flex items-center gap-3">
            {logo(e, "h-8 w-8")}
            <div className="min-w-0">
              <p className="truncate font-medium text-navy-900">{e.nombre}</p>
              {e.razon_social && <p className="truncate text-xs text-slate-500">{e.razon_social}</p>}
            </div>
          </div>
        ),
      },
      {
        clave: "url",
        titulo: "Subdominio",
        buscable: true,
        valor: (e) => e.url ?? e.slug,
        render: (e) =>
          e.url ? (
            <a href={e.url} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} className="font-mono text-xs text-brand-600 hover:underline">
              {e.url.replace("https://", "")}
            </a>
          ) : (
            <span className="font-mono text-xs text-slate-400">{e.slug}</span>
          ),
      },
      { clave: "rfc", titulo: "RFC", buscable: true, valor: (e) => e.rfc, className: "font-mono text-xs" },
      { clave: "licencia", titulo: "Licencia (empleados)", alinear: "derecha", sumar: true, valor: (e) => e.max_empleados },
      { clave: "vence", titulo: "Vence", valor: (e) => e.licencia_vence, render: (e) => (e.licencia_vence ? <span className={e.licencia_vence < hoy ? "font-medium text-red-600" : ""}>{e.licencia_vence}</span> : "—") },
      { clave: "alta", titulo: "Alta", visible: false, valor: (e) => e.created_at.slice(0, 10) },
      { clave: "estado", titulo: "Estado", agrupable: true, valor: (e) => (e.activa ? "Activa" : "Inactiva"), render: (e) => <Badge ok={e.activa}>{e.activa ? "Activa" : "Inactiva"}</Badge> },
      columnaCategorias<Empresa>((e) => e.id, cats.de),
    ],
    filtros: [
      ...filtrosCategorias<Empresa>(cats.lista, (e) => e.id, cats.asignadas),
      { clave: "prueba", titulo: "Licencia de prueba (15)", grupo: "lic", prueba: (e) => e.max_empleados <= 15 },
      { clave: "por_vencer", titulo: "Vence en 30 días", grupo: "venc", prueba: (e) => !!e.licencia_vence && e.licencia_vence >= hoy && e.licencia_vence <= en30 },
      { clave: "vencidas", titulo: "Vencidas", grupo: "venc", prueba: (e) => !!e.licencia_vence && e.licencia_vence < hoy },
      { clave: "activas", titulo: "Activas", grupo: "estado", prueba: (e) => e.activa },
      { clave: "inactivas", titulo: "Inactivas", grupo: "estado", prueba: (e) => !e.activa },
    ],
    tarjetas: [
      { filtro: "prueba", color: "morado" },
      { filtro: "por_vencer", color: "naranja" },
      { filtro: "vencidas", color: "rojo" },
    ],
    kanban: (e) => (
      <div className="flex gap-3">
        {logo(e, "h-14 w-14")}
        <div className="min-w-0">
          <p className="truncate font-semibold text-navy-900">{e.nombre}</p>
          <p className="truncate font-mono text-xs text-brand-600">{e.url?.replace("https://", "") ?? e.slug}</p>
          <p className="text-xs text-slate-600">
            {e.max_empleados} empleados{e.licencia_vence && ` · vence ${e.licencia_vence}`}
          </p>
          {!e.activa && <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Inactiva</span>}
        </div>
      </div>
    ),
  };
  const vista = useVista(config, empresas);
  const enOrden = vista.ordenados;
  const indice = editando && editando !== "nueva" ? enOrden.findIndex((x) => x.id === editando.id) : -1;

  const set = (k: keyof Form) => (ev: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: ev.target.value });

  return (
    <>
      <PageHeader
        submenu={[
          { etiqueta: "Empresas", activo: true },
          { etiqueta: "Categorías", onClick: () => setGestorCats(true) },
        ]}
        icono="building"
        title="Empresas"
        subtitle="Clientes de ODAITIME"
      />
      {gestorCats && <GestorCategorias modelo="empresa" query={""} puedeEditar={true} onCerrar={() => setGestorCats(false)} onCambio={cats.recargar} />}

      <Vista vista={vista} />

      {editando && (
        <Registro
          titulo={editando === "nueva" ? "Nueva empresa" : editando.nombre}
          indice={indice >= 0 ? indice : undefined}
          total={enOrden.length}
          onIr={(i) => abrir(enOrden[i])}
          sucio={sucio}
          onGuardar={guardar}
          onDescartar={descartar}
          onCerrar={() => setEditando(null)}
        >
          <form onSubmit={(ev: FormEvent) => (ev.preventDefault(), guardar())} className="form-2col">
            {editando !== "nueva" && (
              <div>
                <label className="label">Logo</label>
                <LogoEmpresa
                  empresaId={editando.id}
                  version={editando.logo_version}
                  query={`?empresa_id=${editando.id}`}
                  onCambio={(v) => {
                    const e = { ...editando, logo_version: v };
                    setEditando(e);
                    setEmpresas((l) => l.map((x) => (x.id === e.id ? e : x)));
                  }}
                />
              </div>
            )}
            {editando !== "nueva" && (
              <div>
                <label className="label">Fondo principal</label>
                <FondoEmpresa
                  empresaId={editando.id}
                  color={editando.fondo_color}
                  version={editando.fondo_version}
                  query={`?empresa_id=${editando.id}`}
                  onCambio={(f) => {
                    const e = { ...editando, ...f };
                    setEditando(e);
                    setEmpresas((l) => l.map((x) => (x.id === e.id ? e : x)));
                  }}
                />
              </div>
            )}
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

            {editando !== "nueva" && (
              <div>
                <SelectorCategorias
                  todas={cats.lista}
                  valor={cats.asignadas[editando.id] ?? []}
                  onCambio={(ids) => cats.asignar(editando.id, ids).then(cats.recargar)}
                  puedeCrear={true}
                  onCrear={async (nombre) => {
                    const c = await post<Categoria>("/categorias?modelo=empresa", { nombre, color: "#8a64de" });
                    cats.recargar();
                    return c;
                  }}
                />
              </div>
            )}
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

            {editando !== "nueva" && (
              <div className="completo flex justify-end">
                <button type="button" className="text-sm text-slate-500 hover:text-navy-900 hover:underline" onClick={() => alternar(editando)}>
                  {editando.activa ? "Desactivar empresa" : "Activar empresa"}
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
