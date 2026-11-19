import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router";
import AdministradorEmpresa from "../components/AdministradorEmpresa";
import LogoEmpresa from "../components/LogoEmpresa";
import Registro, { useFormulario } from "../components/Registro";
import Icono from "../components/Iconos";
import { columnaCategorias, filtrosCategorias, SelectorCategorias, useCategorias } from "../components/Categorias";
import Vista, { useAbrirDesdeUrl, useVista, type ConfigVista } from "../components/Vista";
import { imprimirSecciones } from "../lib/imprimir";
import { entrarSoporte } from "../lib/soporte";
import { Ayuda, CamposDomicilio, DOMICILIO_VACIO, domicilioApi, domicilioDe, ErrorBox, PageHeader, type Domicilio } from "../components/ui";
import { api, get, patch, post, urlLogo, type Categoria, type Empresa, type TenantInfo } from "../lib/api";
import { useBanda } from "../lib/bandas";

type Form = { nombre: string; slug: string; razon_social: string; rfc: string; domicilio: Domicilio; max_empleados: string; licencia_vence: string; demo: boolean; max_usuarios: string; estado: string; motivo_suspension: string; periodicidad: string; admin_nombre: string; admin_email: string; admin_password: string };
const VACIO: Form = { nombre: "", slug: "", razon_social: "", rfc: "", domicilio: DOMICILIO_VACIO, max_empleados: "15", licencia_vence: "", demo: false, max_usuarios: "5", estado: "corriendo", motivo_suspension: "", periodicidad: "", admin_nombre: "", admin_email: "", admin_password: "" };

const ESTADOS: Record<string, string> = { corriendo: "Corriendo", suspendida: "Suspendida", eliminada: "Eliminada" };
const PERIODICIDADES: Record<string, string> = { mensual: "Mensual", bimestral: "Bimestral", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual" };

function EstadoEmpresa({ e }: { e: Empresa }) {
  const estado = e.estado ?? "corriendo";
  const color = estado === "corriendo" ? "bg-emerald-500 text-white" : estado === "suspendida" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${color}`} title={e.motivo_suspension ?? undefined}>
      {ESTADOS[estado]}
    </span>
  );
}

export default function Empresas() {
  const banda = useBanda("odai");
  const navegar = useNavigate();
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
        : { ...VACIO, nombre: e.nombre, slug: e.slug, razon_social: e.razon_social ?? "", rfc: e.rfc ?? "", domicilio: domicilioDe(e), max_empleados: String(e.max_empleados), licencia_vence: e.licencia_vence ?? "", demo: !!e.demo, max_usuarios: String(e.max_usuarios ?? 5), estado: e.estado ?? "corriendo", motivo_suspension: e.motivo_suspension ?? "", periodicidad: e.periodicidad ?? "" },
    );
    setEditando(e);
  }

  async function guardar(): Promise<boolean> {
    setError(null);
    const datos = {
      nombre: form.nombre,
      ...(form.slug.trim() ? { slug: form.slug.trim().toLowerCase() } : {}),
      razon_social: form.razon_social || null,
      ...domicilioApi(form.domicilio),
      rfc: form.rfc || null,
      max_empleados: Number(form.max_empleados) || 15,
      licencia_vence: form.licencia_vence || null,
      demo: form.demo,
      max_usuarios: Number(form.max_usuarios) || 0,
      periodicidad: form.periodicidad || null,
      ...(editando === "nueva" ? {} : { estado: form.estado, motivo_suspension: form.motivo_suspension || null }),
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


  const hoy = new Date().toLocaleDateString("en-CA");
  const en30 = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString("en-CA");
  const logo = (e: Empresa, tam: string) =>
    e.logo_version ? (
      <img src={urlLogo(e.id, e.logo_version)} alt="" className={`${tam} shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-slate-200`} />
    ) : (
      <span className={`${tam} flex shrink-0 items-center justify-center rounded-lg bg-navy-900 text-xs font-semibold text-white`}>{e.nombre.slice(0, 2).toUpperCase()}</span>
    );
  const cats = useCategorias("empresa", "", true);
  const config: ConfigVista<Empresa> = {
    id: "empresas",
    tituloReporte: "Empresas",
    clave: (e) => e.id,
    eliminar: { borrar: (e) => api(`/empresas/${e.id}`, { method: "DELETE" }), despues: cargar },
    onAbrir: abrir,
    acciones: (
      <button className="btn-primary" onClick={() => abrir("nueva")}>
        <Icono nombre="briefcase-business" /> Nuevo
      </button>
    ),
    vacio: "Aún no hay empresas.",
    ordenInicial: { clave: "nombre", dir: "asc" },
    columnas: [
      {
        enlace: true,
        clave: "nombre",
        titulo: "Empresa",
        fija: true,
        buscable: true,
        valor: (e) => e.nombre,
        render: (e) => (
          <div className="flex items-center gap-3">
            {logo(e, "h-8 w-8")}
            <div className="min-w-0">
              <p className="truncate font-medium text-tinta-900">{e.nombre}</p>
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
      { clave: "estado", titulo: "Estado", agrupable: true, valor: (e) => ESTADOS[e.estado ?? "corriendo"], render: (e) => <EstadoEmpresa e={e} /> },
      { clave: "periodicidad", titulo: "Periodicidad", agrupable: true, visible: false, valor: (e) => (e.periodicidad ? PERIODICIDADES[e.periodicidad] : null) },
      columnaCategorias<Empresa>((e) => e.id, cats.de),
    ],
    filtros: [
      ...filtrosCategorias<Empresa>(cats.lista, (e) => e.id, cats.asignadas),
      { clave: "prueba", titulo: "Licencia de prueba (15)", grupo: "lic", prueba: (e) => e.max_empleados <= 15 },
      { clave: "por_vencer", titulo: "Vence en 30 días", grupo: "venc", prueba: (e) => !!e.licencia_vence && e.licencia_vence >= hoy && e.licencia_vence <= en30 },
      { clave: "vencidas", titulo: "Vencidas", grupo: "venc", prueba: (e) => !!e.licencia_vence && e.licencia_vence < hoy },
      { clave: "demo", titulo: "Empresas demo", grupo: "tipo", prueba: (e) => !!e.demo },
      { clave: "corriendo", titulo: "Corriendo", grupo: "estado", prueba: (e) => (e.estado ?? "corriendo") === "corriendo" },
      { clave: "suspendidas", titulo: "Suspendidas", grupo: "estado", prueba: (e) => e.estado === "suspendida" },
      { clave: "eliminadas", titulo: "Eliminadas", grupo: "estado", prueba: (e) => e.estado === "eliminada" },
    ],
    tarjetas: [
      { filtro: "prueba", color: "morado" },
      { filtro: "por_vencer", color: "naranja" },
      { filtro: "vencidas", color: "rojo" },
      { filtro: "suspendidas", color: "gris" },
    ],
    kanban: (e) => (
      <div className="flex gap-3">
        {logo(e, "h-14 w-14")}
        <div className="min-w-0">
          <p className="truncate font-semibold text-tinta-900">{e.nombre}</p>
          <p className="truncate font-mono text-xs text-brand-600">{e.url?.replace("https://", "") ?? e.slug}</p>
          <p className="text-xs text-slate-600">
            {e.max_empleados} empleados{e.licencia_vence && ` · vence ${e.licencia_vence}`}
          </p>
          {(e.estado ?? "corriendo") !== "corriendo" && (
            <span className="mt-1 inline-block">
              <EstadoEmpresa e={e} />
            </span>
          )}
        </div>
      </div>
    ),
  };
  const vista = useVista(config, empresas);
  useAbrirDesdeUrl(empresas, (x) => x.id, abrir);
  const enOrden = vista.ordenados;
  const indice = editando && editando !== "nueva" ? enOrden.findIndex((x) => x.id === editando.id) : -1;

  const set = (k: keyof Form) => (ev: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: ev.target.value });

  return (
    <>
      <PageHeader submenu={banda}
        icono="building"
        title="Empresas"
        subtitle="Clientes de ODAITIME"
      />

      <Vista vista={vista} />

      {editando && (
        <Registro
          titulo={editando === "nueva" ? "Nueva empresa" : editando.nombre}
          acciones={
            editando === "nueva"
              ? []
              : [
                  {
                    etiqueta: "Ver como soporte",
                    icono: "eye",
                    onClick: () => {
                      entrarSoporte({ id: editando.id, nombre: editando.nombre });
                      navegar("/");
                    },
                  },
                ]
          }
          onImprimir={
            editando === "nueva"
              ? undefined
              : () =>
                  imprimirSecciones(`Empresa · ${editando.nombre}`, [
                    {
                      campos: [
                        ["Nombre", editando.nombre],
                        ["Dirección (subdominio)", editando.url ?? editando.slug],
                        ["Razón social", editando.razon_social],
                        ["RFC", editando.rfc],
                        ["Estado", ESTADOS[editando.estado ?? "corriendo"]],
                        ...(editando.motivo_suspension ? [["Motivo de la suspensión", editando.motivo_suspension] as [string, string]] : []),
                        ["Alta", new Date(editando.created_at).toLocaleDateString("es-MX", { dateStyle: "medium" })],
                        ["Categorías", cats.de(editando.id).map((c) => c.nombre).join(", ")],
                      ],
                    },
                    {
                      titulo: "Licencia",
                      campos: [
                        ["Empleados activos permitidos", editando.max_empleados],
                        ["Vence", editando.licencia_vence ?? "Sin vencimiento"],
                        ["Usuarios permitidos", editando.max_usuarios ?? 5],
                        ["Periodicidad", editando.periodicidad ? PERIODICIDADES[editando.periodicidad] : "Sin definir"],
                        ["Empresa demo", editando.demo ? "Sí" : "No"],
                      ],
                    },
                  ])
          }
          indice={indice >= 0 ? indice : undefined}
          total={enOrden.length}
          onIr={(i) => abrir(enOrden[i])}
          sucio={sucio}
          onGuardar={guardar}
          onDescartar={descartar}
          onCerrar={() => setEditando(null)}
        >
          <form onSubmit={(ev: FormEvent) => (ev.preventDefault(), guardar())} className="form-2col">
            {/* Columna izquierda: datos; derecha: logo (sin renglones vacíos junto al logo). */}
            <div className="space-y-4">
              <div>
                <label className="label">Nombre comercial</label>
                <input className="input" required value={form.nombre} onChange={set("nombre")} />
              </div>
              <div>
                <label className="label">Razón social</label>
                <input className="input" value={form.razon_social} onChange={set("razon_social")} />
              </div>
              <div>
                <label className="label">RFC</label>
                <input className="input uppercase" maxLength={13} value={form.rfc} onChange={set("rfc")} />
              </div>
            </div>
            {editando !== "nueva" && (
              <div>
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
            <div>
              <label className="label">
                Subdominio
                <Ayuda texto="Dirección con la que entra la empresa, p. ej. hotel.odai.lat. Si lo cambias, la dirección anterior deja de funcionar." />
              </label>
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
            <CamposDomicilio prefijo="emp" valor={form.domicilio} onCambio={(domicilio) => setForm({ ...form, domicilio })} />

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
              <div>
                <label className="label inline-flex items-center">
                  Usuarios permitidos
                  <Ayuda texto="Usuarios que el administrador puede dar de alta (gerentes, etc.). No cuentan el administrador ni los empleados con acceso al portal." />
                </label>
                <input className="input" type="number" min={0} max={1000} required value={form.max_usuarios} onChange={set("max_usuarios")} />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-tinta-900">
                <input
                  type="checkbox"
                  checked={form.demo}
                  onChange={(e) => {
                    const demo = e.target.checked;
                    // Prueba de 15 días: si no tiene vencimiento, se propone uno.
                    const vence = demo && !form.licencia_vence ? new Date(Date.now() + 15 * 864e5).toLocaleDateString("en-CA") : form.licencia_vence;
                    setForm({ ...form, demo, licencia_vence: vence });
                  }}
                />
                Empresa demo
                <Ayuda texto="Prueba para el cliente (p. ej. cliente.odai.lat) o demo de Odai: el pie muestra Licencia demo y vence en 15 días. Para pasarla a producción, quita la casilla y ajusta la licencia." />
              </label>
              <div>
                <label className="label">Periodicidad del cobro</label>
                <select className="input" value={form.periodicidad} onChange={(e) => setForm({ ...form, periodicidad: e.target.value })}>
                  <option value="">Sin definir</option>
                  {Object.entries(PERIODICIDADES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              {editando !== "nueva" && (
                <div>
                  <label className="label inline-flex items-center">
                    Estado
                    <Ayuda texto="Suspendida: nadie de la empresa puede entrar y se le muestra el motivo. Eliminada: los datos se conservan un tiempo y luego se purgan. Normalmente lo cambia el módulo de licencias de Odoo." />
                  </label>
                  <select className="input" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                    {Object.entries(ESTADOS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {editando !== "nueva" && form.estado !== "corriendo" && (
                <div className="sm:col-span-2">
                  <label className="label">Motivo de la suspensión</label>
                  <input className="input" maxLength={300} placeholder="Se le muestra a la empresa al intentar entrar" value={form.motivo_suspension} onChange={(e) => setForm({ ...form, motivo_suspension: e.target.value })} />
                </div>
              )}
              {editando !== "nueva" && editando.referencia_odoo && <p className="text-xs text-slate-500 sm:col-span-2">Referencia en Odoo: {editando.referencia_odoo}</p>}
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

            {editando !== "nueva" && <AdministradorEmpresa empresaId={editando.id} />}

            <ErrorBox message={error} />
            <button type="submit" className="sr-only">Guardar</button>
          </form>
        </Registro>
      )}
    </>
  );
}
