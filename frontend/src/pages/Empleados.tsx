import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Avatar from "../components/Avatar";
import Bitacora from "../components/Bitacora";
import Camara from "../components/Camara";
import Registro, { useFormulario } from "../components/Registro";
import ReporteEmpleados from "../components/ReporteEmpleados";
import VacacionesIncidencias from "../components/VacacionesIncidencias";
import Icono from "../components/Iconos";
import { columnaCategorias, Chips, filtrosCategorias, GestorCategorias, SelectorCategorias, useCategorias } from "../components/Categorias";
import { useNavigate } from "react-router";
import Vista, { abrirEn, useAbrirDesdeUrl, useVista, type Columna, type ConfigVista } from "../components/Vista";
import { AvisoLicencia, Badge, ErrorBox, Fila, ImagenEditable, Modal, PageHeader, Plegable, UsoLicencia, useEmpresaScope } from "../components/ui";
import {
  api,
  comprimir,
  descargar,
  errorLicencia,
  fechaCorta,
  get,
  hoyISO,
  imagenProtegida,
  patch,
  post,
  subir,
  type Dispositivo,
  type Empleado,
  type EmpleadoDetalle,
  type Licencia,
  type LimiteLicencia,
  type Categoria,
  type Sucursal,
  type Turno,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { aDataUrl, campos, imprimirHtml } from "../lib/imprimir";

const CAMPOS = [
  "numero", "nombre", "apellido_paterno", "apellido_materno", "curp", "rfc", "nss", "fecha_ingreso",
  "puesto", "departamento", "salario_diario", "email", "telefono", "sucursal_id",
] as const;
type Campo = (typeof CAMPOS)[number];
/** medios: "sucursal" = según su sucursal; si no, lista separada por comas (vacía = ninguno). */
type Form = Record<Campo, string> & { turno_id: string; pin: string; medios: string; dispositivos: string };

const MEDIOS: { valor: string; etiqueta: string }[] = [
  { valor: "kiosco", etiqueta: "Kiosco" },
  { valor: "movil", etiqueta: "Portal (celular)" },
  { valor: "biometrico", etiqueta: "Reloj biométrico" },
];
const lista = (v: string) => v.split(",").filter(Boolean);
/** Campos de checado del formulario → lo que espera la API. */
const mediosApi = (f: Form) => ({
  medios_checado: f.medios === "sucursal" ? null : lista(f.medios),
  dispositivos_checado: f.medios === "sucursal" ? [] : lista(f.dispositivos),
});

const vacio = (sucursal_id = ""): Form => ({
  ...(Object.fromEntries(CAMPOS.map((c) => [c, ""])) as Record<Campo, string>),
  fecha_ingreso: hoyISO(),
  sucursal_id,
  turno_id: "",
  pin: "",
  medios: "sucursal",
  dispositivos: "",
});

type Vista = "detalle" | "turno" | "baja" | "acceso";

export default function Empleados() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "superadmin" || usuario?.rol === "admin_empresa";
  const { query, listo, selector } = useEmpresaScope();
  const sep = query ? "&" : "?";

  const navegar = useNavigate();
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [presentes, setPresentes] = useState<Set<string>>(new Set());

  const [nuevo, setNuevo] = useState(false);
  const [sel, setSel] = useState<EmpleadoDetalle | null>(null);
  const [gestorCats, setGestorCats] = useState(false);
  const [reporte, setReporte] = useState(false);
  const [pestana, setPestana] = useState<"generales" | "fiscales">("generales");
  const [enlacePortal, setEnlacePortal] = useState<string | null>(null);
  const [avisoPortal, setAvisoPortal] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("detalle");
  const { form, setForm, cargar: cargarForm, sucio, descartar } = useFormulario<Form>(vacio());
  const [extra, setExtra] = useState({ turno_id: "", fecha: hoyISO(), motivo: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [lic, setLic] = useState<Licencia | null>(null);
  const [historial, setHistorial] = useState(0);
  const [camaraFoto, setCamaraFoto] = useState(false);
  const [fotoNueva, setFotoNueva] = useState<Blob | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);

  function elegirFotoNueva(b: Blob | null) {
    setCamaraFoto(false);
    setFotoNueva(b);
    setPrevia((ant) => {
      if (ant) URL.revokeObjectURL(ant);
      return b ? URL.createObjectURL(b) : null;
    });
  }

  async function guardarFoto(archivo: Blob) {
    if (!sel) return elegirFotoNueva(archivo); // en el alta, la foto se sube al crear
    setCamaraFoto(false);
    const body = new FormData();
    body.append("archivo", await comprimir(archivo, 1200), "foto.jpg");
    await ejecutar(() => api<EmpleadoDetalle>(`/empleados/${sel.id}/foto${query}`, { method: "PUT", body }));
  }
  const [aviso, setAviso] = useState<LimiteLicencia | null>(null);

  const cargarLicencia = useCallback(() => {
    if (listo) get<Licencia>(`/licencia${query}`).then(setLic);
  }, [listo, query]);
  useEffect(cargarLicencia, [cargarLicencia]);

  const cargar = useCallback(() => {
    if (!listo) return;
    // Se traen todos; la búsqueda, filtros, orden y agrupación se hacen en la vista.
    get<Empleado[]>(`/empleados${query}${sep}estado=todos`).then(setEmpleados);
    get<string[]>(`/empleados/presentes${query}`)
      .then((ids) => setPresentes(new Set(ids)))
      .catch(() => setPresentes(new Set()));
    cargarLicencia();
  }, [listo, query, sep, cargarLicencia]);

  useEffect(cargar, [cargar]);

  useEffect(() => {
    if (!listo) return;
    get<Sucursal[]>(`/sucursales${query}`).then(setSucursales);
    get<Turno[]>(`/turnos${query}`).then(setTurnos);
    // Solo los administradores ven los kioscos; para el resto la lista queda vacía.
    get<Dispositivo[]>(`/dispositivos${query}`)
      .then((d) => setDispositivos(d.filter((x) => x.activo)))
      .catch(() => setDispositivos([]));
  }, [listo, query]);

  const turnosActivos = turnos.filter((t) => t.activo);
  const sucursalesActivas = sucursales.filter((s) => s.activa);

  function fichaAForm(e: EmpleadoDetalle): Form {
    return {
      ...(Object.fromEntries(CAMPOS.map((c) => [c, ""])) as Record<Campo, string>),
      ...Object.fromEntries(CAMPOS.filter((c) => c !== "sucursal_id").map((c) => [c, String(e[c as keyof EmpleadoDetalle] ?? "")])),
      sucursal_id: e.sucursal.id,
      turno_id: "",
      pin: "",
      medios: e.medios_checado == null ? "sucursal" : e.medios_checado.join(","),
      dispositivos: (e.dispositivos_checado ?? []).join(","),
    };
  }

  function mostrar(e: EmpleadoDetalle) {
    setSel(e);
    cargarForm(fichaAForm(e));
  }

  async function abrirDetalle(id: string) {
    setError(null);
    setVista("detalle");
    mostrar(await get<EmpleadoDetalle>(`/empleados/${id}${query}`));
  }

  /** Guarda la ficha (se llama al cambiar de registro, al cerrar o con la nube). */
  async function guardarFicha(): Promise<boolean> {
    if (!sel) return true;
    setError(null);
    try {
      const { turno_id: _t, pin, medios: _m, dispositivos: _d, ...resto } = form;
      const datos = { ...resto, ...mediosApi(form) };
      const r = await patch<EmpleadoDetalle>(`/empleados/${sel.id}${query}`, pin ? { ...datos, pin } : datos);
      mostrar(r);
      setHistorial((n) => n + 1);
      setEmpleados((lista) => lista.map((x) => (x.id === r.id ? r : x)));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  const cats = useCategorias("empleado", query, listo);

  /** Casilla "Dar acceso al portal": crea su usuario y le manda la invitación por correo. */
  async function alternarPortal(dar: boolean) {
    if (!sel) return;
    setEnlacePortal(null);
    setAvisoPortal(null);
    if (!dar) return ejecutar(() => api<EmpleadoDetalle>(`/empleados/${sel.id}/portal${query}`, { method: "DELETE" }));
    let email = sel.portal_email ?? sel.email;
    if (!email) {
      email = prompt(`Correo de ${sel.nombre_completo} para enviarle su acceso:`)?.trim() ?? "";
      if (!email) return;
    }
    await ejecutar(async () => {
      const r = await post<{ empleado: EmpleadoDetalle; enviado: boolean; enlace: string | null }>(`/empleados/${sel.id}/portal${query}`, { email });
      if (r.enviado) setAvisoPortal(`Se envió la invitación a ${r.empleado.portal_email}.`);
      else setEnlacePortal(r.enlace);
      return r.empleado;
    });
  }

  useAbrirDesdeUrl(empleados, (e) => e.id, (e) => abrirDetalle(e.id));

  const columnas: Columna<Empleado>[] = [
    {
      clave: "nombre",
      titulo: "Empleado",
      fija: true,
      buscable: true,
      enlace: true,
      valor: (e) => e.nombre_completo,
      render: (e) => (
        <div className="flex items-center gap-3">
          <span className="relative">
            <Avatar empleadoId={e.id} nombre={e.nombre_completo} version={e.foto_version} query={query} tam={32} />
            <PuntoPresencia presente={presentes.has(e.id)} activo={e.activo} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-white" />
          </span>
          <span className="truncate font-medium text-tinta-900">{e.nombre_completo}</span>
        </div>
      ),
    },
    { clave: "numero", titulo: "Número", buscable: true, enlace: true, valor: (e) => e.numero, className: "font-mono text-xs text-slate-500" },
    { clave: "puesto", titulo: "Puesto", buscable: true, agrupable: true, valor: (e) => e.puesto },
    { clave: "departamento", titulo: "Departamento", buscable: true, agrupable: true, valor: (e) => e.departamento },
    {
      clave: "sucursal",
      titulo: "Sucursal",
      buscable: true,
      agrupable: true,
      valor: (e) => e.sucursal.nombre,
      enlace: (e) => abrirEn(navegar, "/sucursales", e.sucursal.id),
      render: (e) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-brand-700">{e.sucursal.clave}</span>
          <span className="truncate">{e.sucursal.nombre}</span>
        </span>
      ),
    },
    columnaCategorias<Empleado>((e) => e.id, cats.de),
    {
      clave: "turno",
      titulo: "Turno",
      agrupable: true,
      valor: (e) => e.turno_actual?.nombre ?? null,
      enlace: (e) => e.turno_actual && abrirEn(navegar, "/turnos", e.turno_actual.id),
      render: (e) => e.turno_actual?.nombre ?? <span className="text-amber-600">Sin turno</span>,
    },
    { clave: "telefono", titulo: "Teléfono", buscable: true, visible: false, valor: (e) => e.telefono },
    { clave: "email", titulo: "Correo", buscable: true, visible: false, valor: (e) => e.email },
    { clave: "curp", titulo: "CURP", buscable: true, visible: false, valor: (e) => e.curp, className: "font-mono text-xs" },
    { clave: "rfc", titulo: "RFC", buscable: true, visible: false, valor: (e) => e.rfc, className: "font-mono text-xs" },
    { clave: "nss", titulo: "NSS", buscable: true, visible: false, valor: (e) => e.nss, className: "font-mono text-xs" },
    { clave: "fecha_ingreso", titulo: "Fecha de ingreso", valor: (e) => e.fecha_ingreso, render: (e) => fechaCorta(e.fecha_ingreso), visible: false },
    { clave: "anio_ingreso", titulo: "Año de ingreso", agrupable: true, visible: false, valor: (e) => e.fecha_ingreso.slice(0, 4) },
    { clave: "salario", titulo: "Salario diario", visible: false, alinear: "derecha", sumar: true, valor: (e) => (e.salario_diario ? Number(e.salario_diario) : null) },
    {
      clave: "estado",
      titulo: "Estado",
      agrupable: true,
      valor: (e) => (e.activo ? (presentes.has(e.id) ? "En el trabajo" : "Activo") : "Baja"),
      render: (e) =>
        e.activo ? (
          presentes.has(e.id) ? (
            <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">En el trabajo</span>
          ) : (
            <Badge ok>Activo</Badge>
          )
        ) : (
          <Badge ok={false}>Baja</Badge>
        ),
    },
  ];
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toLocaleDateString("en-CA");
  const config: ConfigVista<Empleado> = {
    id: "empleados",
    tituloReporte: "Empleados",
    columnas,
    filtros: [
      ...filtrosCategorias<Empleado>(cats.lista, (e) => e.id, cats.asignadas),
      { clave: "presentes", titulo: "En el trabajo", grupo: "presencia", prueba: (e) => presentes.has(e.id) },
      { clave: "ausentes", titulo: "Ausentes", grupo: "presencia", prueba: (e) => e.activo && !presentes.has(e.id) },
      { clave: "sin_turno", titulo: "Sin turno", grupo: "datos", prueba: (e) => e.activo && !e.turno_actual },
      { clave: "sin_pin", titulo: "Sin PIN del kiosco", grupo: "datos", prueba: (e) => e.activo && !e.tiene_pin },
      { clave: "sin_foto", titulo: "Sin foto", grupo: "datos", prueba: (e) => e.activo && !e.foto_version },
      { clave: "con_acceso", titulo: "Con acceso al sistema", grupo: "datos", prueba: (e) => e.tiene_acceso },
      { clave: "nuevos", titulo: "Recién contratados (30 días)", grupo: "nuevos", prueba: (e) => e.fecha_ingreso >= hace30 },
      { clave: "activos", titulo: "Activos", grupo: "estado", prueba: (e) => e.activo },
      { clave: "bajas", titulo: "Bajas", grupo: "estado", prueba: (e) => !e.activo },
    ],
    filtrosIniciales: ["activos"],
    ordenInicial: { clave: "nombre", dir: "asc" },
    tarjetas: [
      { filtro: "presentes", color: "verde" },
      { filtro: "ausentes", color: "gris" },
      { filtro: "sin_turno", color: "naranja" },
      { filtro: "sin_pin", color: "morado" },
    ],
    clave: (e) => e.id,
    eliminar: esAdmin ? { borrar: (e) => api(`/empleados/${e.id}${query}`, { method: "DELETE" }), despues: () => (cargar(), cargarLicencia()) } : undefined,
    onAbrir: (e) => abrirDetalle(e.id),
    acciones: listo && (
      <button className="btn-primary" onClick={abrirNuevo}>
        <Icono nombre="user-plus" /> Nuevo
      </button>
    ),
    menuAcciones: [
      ...(esAdmin && listo ? [{ etiqueta: "Importar", icono: "download" as const, onClick: () => setImportando(true) }] : []),
    ],
    reportePdf: () => setReporte(true),
    extra: lic && <UsoLicencia lic={lic} compacto />,
    actividades: { modelo: "empleado", query, listo },
    vacio: "No hay empleados con esos filtros.",
    kanban: (e) => (
      <div className="flex gap-3 pr-6">
        <Avatar empleadoId={e.id} nombre={e.nombre_completo} version={e.foto_version} query={query} tam={88} cuadrado />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate font-semibold text-tinta-900">{e.nombre_completo}</p>
          <p className="truncate text-xs uppercase tracking-wide text-slate-500">{e.puesto ?? "Sin puesto"}</p>
          {e.email && <p className="truncate text-xs text-slate-600">✉ {e.email}</p>}
          {e.telefono && <p className="truncate text-xs text-slate-600">☎ {e.telefono}</p>}
          <div className="flex flex-wrap gap-1 pt-1">
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">{e.sucursal.nombre}</span>
            <Chips lista={cats.de(e.id)} />
            {!e.turno_actual && e.activo && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Sin turno</span>}
            {!e.activo && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Baja</span>}
          </div>
        </div>
        <PuntoPresencia presente={presentes.has(e.id)} activo={e.activo} className="absolute right-3 top-3" />
      </div>
    ),
  };
  const vistaEmp = useVista(config, empleados);
  const enOrden = vistaEmp.ordenados;
  const indiceSel = sel ? enOrden.findIndex((x) => x.id === sel.id) : -1;

  function abrirNuevo() {
    // Si ya no hay lugares, avisa antes de capturar todo el formulario.
    if (lic && (lic.disponibles === 0 || lic.vencida)) {
      setAviso({
        codigo: lic.vencida ? "licencia_vencida" : "limite_licencia",
        mensaje: lic.vencida
          ? "Tu licencia está vencida. Renuévala para registrar empleados."
          : `Tu licencia permite ${lic.max_empleados} empleados activos y ya los tienes todos registrados.`,
        ...lic,
      });
      return;
    }
    setError(null);
    cargarForm(vacio(sucursalesActivas.length === 1 ? sucursalesActivas[0].id : ""));
    elegirFotoNueva(null);
    setNuevo(true);
  }

  function irA(v: Vista) {
    setError(null);
    if (v === "turno") setExtra((x) => ({ ...x, turno_id: sel?.turno_actual?.id ?? "", fecha: hoyISO() }));
    if (v === "baja") setExtra((x) => ({ ...x, fecha: hoyISO(), motivo: "" }));
    if (v === "acceso") setExtra((x) => ({ ...x, email: sel?.email ?? "", password: "" }));
    setVista(v);
  }

  async function ejecutar(accion: () => Promise<EmpleadoDetalle | void>) {
    setError(null);
    try {
      const r = await accion();
      if (r) mostrar(r);
      setHistorial((n) => n + 1);
      setVista("detalle");
      cargar();
    } catch (err) {
      const l = errorLicencia(err);
      if (l) setAviso(l);
      else setError((err as Error).message);
    }
  }

  async function crear(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    try {
      const { turno_id, pin, medios: _m, dispositivos: _d, ...datos } = form;
      let creado = await post<EmpleadoDetalle>(`/empleados${query}`, { ...datos, ...mediosApi(form), turno_id: turno_id || null, pin: pin || null });
      if (fotoNueva) {
        const body = new FormData();
        body.append("archivo", await comprimir(fotoNueva, 1200), "foto.jpg");
        creado = await api<EmpleadoDetalle>(`/empleados/${creado.id}/foto${query}`, { method: "PUT", body });
      }
      elegirFotoNueva(null);
      setNuevo(false);
      cargar();
      mostrar(creado);
      setVista("detalle");
    } catch (err) {
      const l = errorLicencia(err);
      if (l) {
        setNuevo(false);
        setAviso(l);
      } else setError((err as Error).message);
    }
  }

  const set = (k: keyof Form) => (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: ev.target.value });
  const input = (k: Campo, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={form[k]} onChange={set(k)} {...props} />
    </div>
  );

  const selectorCategorias = sel && (
    <SelectorCategorias
      todas={cats.lista}
      valor={cats.asignadas[sel.id] ?? []}
      onCambio={(ids) => cats.asignar(sel.id, ids).then(cats.recargar)}
      puedeCrear={esAdmin}
      conEtiqueta={false}
      onCrear={async (nombre) => {
        const c = await post<Categoria>(`/categorias${query}${sep}modelo=empleado`, { nombre, color: "#8a64de" });
        cats.recargar();
        return c;
      }}
    />
  );

  /** Campo con su etiqueta a la izquierda (como Odoo), para que las dos columnas queden parejas. */
  const fila = (k: Campo, etiqueta: string, props: Record<string, unknown> = {}, ayuda?: ReactNode) => (
    <Fila key={k} etiqueta={etiqueta} ayuda={ayuda} htmlFor={`emp-${k}`}>
      <input id={`emp-${k}`} className="input" value={form[k]} onChange={set(k)} {...props} />
    </Fila>
  );

  /** Pares izquierda/derecha en una sola rejilla: cada renglón queda a la misma altura. */
  const parejas = (izq: ReactNode[], der: ReactNode[]) => {
    const n = Math.max(izq.length, der.length);
    const salida: ReactNode[] = [];
    for (let i = 0; i < n; i++) {
      salida.push(izq[i] ?? <div key={`i${i}`} className="hidden md:block" />);
      salida.push(der[i] ?? <div key={`d${i}`} className="hidden md:block" />);
    }
    return <div className="grid grid-cols-1 gap-x-10 gap-y-2 md:grid-cols-2">{salida}</div>;
  };

  /**
   * Dos columnas en una sola rejilla: la foto ocupa los primeros renglones de la segunda columna
   * y los campos de la derecha siguen justo debajo (sin renglones vacíos).
   */
  const dosColumnas = (foto: ReactNode, izq: ReactNode[], der: ReactNode[]) => (
    <div className="grid grid-cols-1 gap-x-10 gap-y-2 md:grid-flow-row-dense md:grid-cols-2">
      <div className="flex items-start md:col-start-2 md:row-span-3 md:justify-end">{foto}</div>
      {izq.map((c, i) => (
        <div key={`i${i}`} className="md:col-start-1">
          {c}
        </div>
      ))}
      {der.map((c, i) => (
        <div key={`d${i}`} className="md:col-start-2">
          {c}
        </div>
      ))}
    </div>
  );

  /**
   * Campos del expediente en dos pestañas. `foto` va arriba en la segunda columna y `derecha`
   * son renglones extra de la segunda columna (estado, accesos, portal).
   */
  const camposExpediente = (conTurno: boolean, foto: ReactNode, derecha: ReactNode[] = []) => (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {(
          [
            ["generales", "Datos generales"],
            ["fiscales", "Datos fiscales"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={pestana === k}
            onClick={() => setPestana(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${pestana === k ? "border-brand-500 text-tinta-900" : "border-transparent text-slate-500 hover:text-tinta-900"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {pestana === "generales" ? (
        <>
          {dosColumnas(
            foto,
            [
              fila("numero", "Número *", { required: true, maxLength: 20 }),
              fila("nombre", "Nombre(s) *", { required: true }),
              fila("apellido_paterno", "Apellido paterno *", { required: true }),
              fila("apellido_materno", "Apellido materno"),
              fila("fecha_ingreso", "Fecha de ingreso *", { type: "date", required: true }),
              <Fila
                key="sucursal"
                etiqueta={
                  form.sucursal_id && !nuevo ? (
                    <button type="button" className="enlace-celda" title="Abrir la ficha de la sucursal" onClick={() => abrirEn(navegar, "/sucursales", form.sucursal_id)}>
                      Sucursal *
                    </button>
                  ) : (
                    "Sucursal *"
                  )
                }
                htmlFor="emp-sucursal"
              >
                <select id="emp-sucursal" className="input" required value={form.sucursal_id} onChange={set("sucursal_id")}>
                  <option value="">Selecciona…</option>
                  {sucursalesActivas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.clave} — {s.nombre}
                    </option>
                  ))}
                </select>
              </Fila>,
              ...(conTurno
                ? [
                    <Fila key="turno" etiqueta="Turno" htmlFor="emp-turno">
                      <select id="emp-turno" className="input" value={form.turno_id} onChange={set("turno_id")}>
                        <option value="">Sin turno por ahora</option>
                        {turnosActivos.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nombre}
                          </option>
                        ))}
                      </select>
                    </Fila>,
                  ]
                : []),
              fila("puesto", "Puesto"),
              fila("departamento", "Departamento"),
              ...(!conTurno && selectorCategorias ? [<Fila key="cats" etiqueta="Categorías">{selectorCategorias}</Fila>] : []),
            ],
            [
              ...derecha,
              fila("email", "Correo", { type: "email" }, "Se usa para enviarle su acceso al portal."),
              fila("telefono", "Teléfono", { type: "tel", maxLength: 20 }),
              <Fila key="pin" etiqueta="PIN del kiosco" ayuda="De 4 a 6 dígitos. Con su número de empleado y este PIN checa en el kiosco de la sucursal." htmlFor="emp-pin">
                <input
                  id="emp-pin"
                  className="input tracking-widest"
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  maxLength={6}
                  title="De 4 a 6 dígitos"
                  placeholder={sel?.tiene_pin && !nuevo ? "•••• (asignado)" : "4 a 6 dígitos"}
                  value={form.pin}
                  onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
                />
              </Fila>,
              <Fila
                key="medios"
                etiqueta="Medios de checado"
                ayuda="Por dónde registra su asistencia. «Según su sucursal» usa la configuración de checadas de su sucursal (o la general)."
              >
                <MediosChecado form={form} setForm={setForm} dispositivos={dispositivos} />
              </Fila>,
            ],
          )}
        </>
      ) : (
        parejas(
          [fila("curp", "CURP", { maxLength: 18, className: "input uppercase" }), fila("nss", "NSS (IMSS)", { maxLength: 13, inputMode: "numeric" })],
          [fila("rfc", "RFC", { maxLength: 13, className: "input uppercase" }), fila("salario_diario", "Salario diario", { type: "number", min: 0, step: "0.01" }, "Salario base por día; se usa en los reportes. El importe de la nómina lo calcula tu sistema de nómina.")],
        )
      )}
    </div>
  );

  /** Ficha del empleado para imprimir: una hoja, dos columnas, la foto una sola vez. */
  async function imprimirFicha() {
    if (!sel) return;
    let foto = "";
    if (sel.foto_version) {
      try {
        const u = await imagenProtegida(`/empleados/${sel.id}/foto${query}${sep}tam=512&v=${encodeURIComponent(sel.foto_version)}`);
        foto = await aDataUrl(u);
        URL.revokeObjectURL(u);
      } catch {
        foto = "";
      }
    }
    const accesos = [sel.tiene_pin && "PIN de kiosco", sel.portal && `Portal (${sel.portal_email})`].filter(Boolean).join(", ") || "Sin accesos";
    const dinero = (v: string | null) => (v ? Number(v).toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : "");
    const cuerpo = `
<div style="display:grid;grid-template-columns:1fr 150px;gap:24px;align-items:start">
  ${campos([
    ["Número", sel.numero],
    ["Nombre(s)", sel.nombre],
    ["Apellido paterno", sel.apellido_paterno],
    ["Apellido materno", sel.apellido_materno],
  ]).replace('class="campos"', 'class="campos" style="grid-template-columns:1fr"')}
  <div>${foto ? `<img src="${foto}" alt="" style="width:150px;height:150px;object-fit:cover;border-radius:8px">` : ""}</div>
</div>
<h2>Datos generales</h2>
${campos([
  ["Fecha de ingreso", fechaCorta(sel.fecha_ingreso)],
  ["Sucursal", `${sel.sucursal.clave} — ${sel.sucursal.nombre}`],
  ["Turno actual", sel.turno_actual?.nombre ?? "Sin turno"],
  ["Puesto", sel.puesto],
  ["Departamento", sel.departamento],
  ["Categorías", cats.de(sel.id).map((c) => c.nombre).join(", ")],
  ["Correo", sel.email],
  ["Teléfono", sel.telefono],
  ["Estado", sel.activo ? "Activo" : `Baja ${fechaCorta(sel.fecha_baja)}${sel.motivo_baja ? ` · ${sel.motivo_baja}` : ""}`],
  ["Accesos", accesos],
])}
<h2>Datos fiscales</h2>
${campos([
  ["CURP", sel.curp],
  ["RFC", sel.rfc],
  ["NSS (IMSS)", sel.nss],
  ["Salario diario", dinero(sel.salario_diario)],
])}
${
  sel.asignaciones.length
    ? `<h2>Historial de turnos</h2>${campos(sel.asignaciones.map((a) => [a.turno.nombre, `${fechaCorta(a.fecha_inicio)} → ${a.fecha_fin ? fechaCorta(a.fecha_fin) : "vigente"}`] as [string, string]))}`
    : ""
}`;
    imprimirHtml(`Ficha del empleado · ${sel.nombre_completo}`, cuerpo);
  }

  const botones = (onCancel: () => void, texto = "Guardar", peligro = false) => (
    <div className="flex justify-end gap-3">
      <button type="button" className="btn-secondary" onClick={onCancel}>
        Cancelar
      </button>
      <button type="submit" className={peligro ? "btn-primary bg-red-600 hover:bg-red-700" : "btn-primary"}>
        {texto}
      </button>
    </div>
  );

  return (
    <>
      <PageHeader
        icono="contact-round"
        title="Empleados"
        submenu={[
          { etiqueta: "Empleados", activo: true },
          { etiqueta: "Categorías", onClick: () => setGestorCats(true) },
        ]}
        action={selector}
      />
      {reporte && <ReporteEmpleados empleados={empleados} categorias={cats.lista} catsDe={cats.de} onCerrar={() => setReporte(false)} />}
      {gestorCats && <GestorCategorias modelo="empleado" query={query} puedeEditar={esAdmin} onCerrar={() => setGestorCats(false)} onCambio={cats.recargar} />}

      <Vista vista={vistaEmp} />

      {/* Alta */}
      {nuevo && (
        <Modal title="Nuevo empleado" onClose={() => setNuevo(false)} ancho="lg">
          <form onSubmit={crear} className="space-y-4">
            {camposExpediente(
              true,
              <ImagenEditable onCambiar={elegirFotoNueva} onCamara={() => setCamaraFoto(true)} onQuitar={previa ? () => elegirFotoNueva(null) : undefined}>
                <span className="marco-foto inline-flex h-24 w-24">
                  {previa ? (
                    <img src={previa} alt="Foto del empleado" className="h-full w-full rounded-md object-cover" />
                  ) : (
                    <svg viewBox="0 0 64 64" className="h-full w-full rounded-md bg-slate-100" aria-hidden="true">
                      <circle cx="32" cy="24" r="11" fill="#cbd5e1" />
                      <path d="M10 60c2-12 11-19 22-19s20 7 22 19" fill="#cbd5e1" />
                    </svg>
                  )}
                </span>
              </ImagenEditable>,
            )}
            <ErrorBox message={error} />
            {botones(() => setNuevo(false))}
          </form>
        </Modal>
      )}

      {/* Detalle y acciones */}
      {sel && (
        <Registro
          titulo={
            <>
              {sel.nombre_completo} <span className="font-normal text-slate-500">· {sel.sucursal.nombre}</span>
            </>
          }
          imprimir={false}
          acciones={[
            { etiqueta: "Imprimir ficha", icono: "printer", onClick: imprimirFicha },
            ...(sel.activo
              ? [
                  { etiqueta: "Cambiar turno", icono: "calendar-clock" as const, onClick: () => irA("turno"), separar: true },
                  { etiqueta: "Dar de baja", icono: "user-check" as const, onClick: () => irA("baja"), peligro: true },
                ]
              : [{ etiqueta: "Reactivar", icono: "user-check" as const, onClick: () => ejecutar(() => post<EmpleadoDetalle>(`/empleados/${sel.id}/reactivar${query}`, {})), separar: true }]),
          ]}
          indice={indiceSel >= 0 ? indiceSel : undefined}
          total={enOrden.length}
          onIr={(i) => abrirDetalle(enOrden[i].id)}
          sucio={vista === "detalle" && sucio}
          onGuardar={guardarFicha}
          onDescartar={descartar}
          onCerrar={() => setSel(null)}
        >
          {vista === "detalle" && (
            <div className="space-y-5">
              <form className="space-y-4" onSubmit={(ev) => (ev.preventDefault(), guardarFicha())}>
                {camposExpediente(
                  false,
                  <ImagenEditable
                    onCambiar={guardarFoto}
                    onCamara={() => setCamaraFoto(true)}
                    onQuitar={sel.foto_version ? () => ejecutar(() => api<EmpleadoDetalle>(`/empleados/${sel.id}/foto${query}`, { method: "DELETE" })) : undefined}
                  >
                    <Avatar empleadoId={sel.id} nombre={sel.nombre_completo} version={sel.foto_version} query={query} tam={96} />
                  </ImagenEditable>,
                  [
                    <Fila key="estado" etiqueta="Estado">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge ok={sel.activo}>{sel.activo ? "Activo" : `Baja ${fechaCorta(sel.fecha_baja)}`}</Badge>
                        {!sel.activo && sel.motivo_baja && <span className="text-xs text-slate-500">{sel.motivo_baja}</span>}
                      </span>
                    </Fila>,
                    <Fila key="accesos" etiqueta="Accesos" ayuda="Formas en que esta persona puede registrar o consultar su asistencia.">
                      <span className="flex flex-wrap gap-1">
                        {sel.tiene_pin && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">PIN de kiosco</span>}
                        {sel.portal && <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-xs font-medium text-accent-500">Portal</span>}
                        {!sel.tiene_pin && !sel.portal && <span className="text-xs text-slate-400">Ninguno</span>}
                      </span>
                    </Fila>,
                    <Fila
                      key="portal"
                      etiqueta="Portal"
                      htmlFor="portal"
                      ayuda={`Podrá consultar su historial (y checar, si la empresa lo permite). Recibe un correo${sel.portal_email ? ` en ${sel.portal_email}` : ""} para crear su contraseña la primera vez.`}
                    >
                      <div className="text-sm">
                        <label className="inline-flex cursor-pointer items-center gap-2 text-tinta-900">
                          <input id="portal" type="checkbox" className="h-4 w-4 accent-brand-500" disabled={!sel.activo} checked={sel.portal} onChange={(e) => alternarPortal(e.target.checked)} />
                          Dar acceso al portal
                        </label>
                        {sel.portal && (
                          <button type="button" className="ml-3 text-xs font-medium text-brand-600 hover:underline" onClick={() => alternarPortal(true)}>
                            Reenviar invitación
                          </button>
                        )}
                        {avisoPortal && <p className="mt-1 text-xs text-emerald-700">{avisoPortal}</p>}
                        {enlacePortal && (
                          <div className="mt-2 space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                            <p>El correo saliente no está configurado. Comparte este enlace (vence en 72 horas):</p>
                            <div className="flex gap-2">
                              <input className="input flex-1 font-mono text-xs" readOnly value={enlacePortal} onFocus={(e) => e.target.select()} />
                              <button type="button" className="btn-secondary" onClick={() => navigator.clipboard?.writeText(enlacePortal)}>
                                Copiar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </Fila>,
                  ],
                )}
                <button type="submit" className="sr-only">
                  Guardar
                </button>
              </form>

              <Plegable titulo={`Historial de turnos (${sel.asignaciones.length})`}>
                {sel.asignaciones.length === 0 ? (
                  <p className="text-sm text-amber-600">Sin turno asignado.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                    {sel.asignaciones.map((a) => (
                      <li key={a.id} className="flex justify-between gap-3 px-3 py-2">
                        <button type="button" className="enlace-celda font-medium text-tinta-900" onClick={() => abrirEn(navegar, "/turnos", a.turno.id)}>
                          {a.turno.nombre}
                        </button>
                        <span className="text-slate-500">
                          {fechaCorta(a.fecha_inicio)} → {a.fecha_fin ? fechaCorta(a.fecha_fin) : "vigente"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Plegable>

              <ErrorBox message={error} />
              <Plegable titulo="Vacaciones e incidencias">
                <VacacionesIncidencias empleadoId={sel.id} query={query} onCambio={() => setHistorial((n) => n + 1)} />
              </Plegable>

              <Plegable titulo="Historial de cambios">
                <Bitacora modelo="empleado" registroId={sel.id} query={query} recargar={historial} />
              </Plegable>
            </div>
          )}

          {vista === "turno" && (
            <form
              className="space-y-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                ejecutar(() => post<EmpleadoDetalle>(`/empleados/${sel.id}/turno${query}`, { turno_id: extra.turno_id, fecha_inicio: extra.fecha }));
              }}
            >
              <div>
                <label className="label">Nuevo turno</label>
                <select className="input" required value={extra.turno_id} onChange={(e) => setExtra({ ...extra, turno_id: e.target.value })}>
                  <option value="">Selecciona…</option>
                  {turnosActivos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Vigente a partir de</label>
                <input className="input" type="date" required min={sel.fecha_ingreso} value={extra.fecha} onChange={(e) => setExtra({ ...extra, fecha: e.target.value })} />
              </div>
              <p className="text-xs text-slate-500">El turno anterior se cierra automáticamente el día previo; el historial se conserva.</p>
              <ErrorBox message={error} />
              {botones(() => setVista("detalle"), "Asignar turno")}
            </form>
          )}

          {vista === "baja" && (
            <form
              className="space-y-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                ejecutar(() => post<EmpleadoDetalle>(`/empleados/${sel.id}/baja${query}`, { fecha_baja: extra.fecha, motivo: extra.motivo }));
              }}
            >
              <div>
                <label className="label">Fecha de baja</label>
                <input className="input" type="date" required min={sel.fecha_ingreso} value={extra.fecha} onChange={(e) => setExtra({ ...extra, fecha: e.target.value })} />
              </div>
              <div>
                <label className="label">Motivo</label>
                <input className="input" required minLength={3} placeholder="Renuncia voluntaria, término de contrato…" value={extra.motivo} onChange={(e) => setExtra({ ...extra, motivo: e.target.value })} />
              </div>
              <p className="text-xs text-slate-500">El expediente y su historial se conservan. Si tiene acceso a la app, se le bloquea.</p>
              <ErrorBox message={error} />
              {botones(() => setVista("detalle"), "Dar de baja", true)}
            </form>
          )}

          {vista === "acceso" && (
            <form
              className="space-y-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                ejecutar(() => post<EmpleadoDetalle>(`/empleados/${sel.id}/acceso${query}`, { email: extra.email, password: extra.password }));
              }}
            >
              <p className="text-sm text-slate-600">Con este acceso la persona podrá checar desde su celular.</p>
              <div>
                <label className="label">Correo para iniciar sesión</label>
                <input className="input" type="email" required value={extra.email} onChange={(e) => setExtra({ ...extra, email: e.target.value })} />
              </div>
              <div>
                <label className="label">Contraseña temporal</label>
                <input className="input" type="password" required minLength={8} value={extra.password} onChange={(e) => setExtra({ ...extra, password: e.target.value })} />
              </div>
              <ErrorBox message={error} />
              {botones(() => setVista("detalle"), "Crear acceso")}
            </form>
          )}
        </Registro>
      )}

      {importando && (
        <Importar
          query={query}
          onClose={() => setImportando(false)}
          onListo={cargar}
          onLicencia={(l) => {
            setImportando(false);
            setAviso(l);
          }}
        />
      )}
      {aviso && <AvisoLicencia info={aviso} onClose={() => setAviso(null)} />}
      {camaraFoto && <Camara titulo="Foto para la ficha" onFoto={guardarFoto} onCancelar={() => setCamaraFoto(false)} />}
    </>
  );
}

type ImportRes = { creados: number; errores: { fila: number; error: string }[] };

function Importar({
  query,
  onClose,
  onListo,
  onLicencia,
}: {
  query: string;
  onClose: () => void;
  onListo: () => void;
  onLicencia: (l: LimiteLicencia) => void;
}) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [resultado, setResultado] = useState<ImportRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (!archivo) return;
    setError(null);
    setEnviando(true);
    try {
      const r = await subir<ImportRes>(`/empleados/importar${query}`, "archivo", archivo);
      setResultado(r);
      if (r.creados) onListo();
    } catch (err) {
      const l = errorLicencia(err);
      if (l) onLicencia(l);
      else setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal title="Importar empleados desde Excel" onClose={onClose}>
      <form onSubmit={enviar} className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>
            Descarga la{" "}
            <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => descargar(`/empleados/plantilla${query}`, "plantilla_empleados.xlsx").catch((e) => setError(e.message))}>
              plantilla
            </button>
            . Trae las claves de tus sucursales y los turnos.
          </li>
          <li>Llénala (borra la fila de ejemplo) y súbela aquí.</li>
          <li>Si alguna fila tiene error no se importa nada; corrige y vuelve a subir.</li>
        </ol>

        <input
          type="file"
          accept=".xlsx"
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null);
            setResultado(null);
          }}
        />

        {resultado && resultado.creados > 0 && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200">
            Se importaron {resultado.creados} empleado(s).
          </p>
        )}
        {resultado && resultado.errores.length > 0 && (
          <div className="max-h-56 overflow-y-auto rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
            <p className="mb-1 font-medium">No se importó nada. Corrige estas filas:</p>
            <ul className="space-y-0.5">
              {resultado.errores.map((e, i) => (
                <li key={i}>
                  {e.fila > 0 && <strong>Fila {e.fila}: </strong>}
                  {e.error}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ErrorBox message={error} />

        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cerrar
          </button>
          <button type="submit" className="btn-primary" disabled={!archivo || enviando}>
            {enviando ? "Importando…" : "Importar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function IconoCamara({ pequeno = false }: { pequeno?: boolean }) {
  const t = pequeno ? 16 : 28;
  return (
    <svg width={t} height={t} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

/** Punto de presencia como en Odoo: verde en el trabajo, gris ausente. */
function PuntoPresencia({ presente, activo, className = "" }: { presente: boolean; activo: boolean; className?: string }) {
  if (!activo) return null;
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full ${presente ? "bg-emerald-500" : "bg-slate-300"} ${className}`}
      title={presente ? "En el trabajo" : "Ausente"}
      aria-label={presente ? "En el trabajo" : "Ausente"}
    />
  );
}

/** Casillas de medios de checado y, si checa en kiosco o reloj, en cuáles. */
function MediosChecado({ form, setForm, dispositivos }: { form: Form; setForm: (f: Form) => void; dispositivos: Dispositivo[] }) {
  const propios = form.medios !== "sucursal";
  const medios = propios ? lista(form.medios) : [];
  const elegidos = lista(form.dispositivos);
  const tipos = medios.filter((m) => m === "kiosco" || m === "biometrico");
  const aplicables = dispositivos.filter((d) => tipos.includes(d.tipo));
  const alternar = (valor: string, en: string[]) => (en.includes(valor) ? en.filter((x) => x !== valor) : [...en, valor]).join(",");
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!propios}
          onChange={(e) => setForm({ ...form, medios: e.target.checked ? "sucursal" : "kiosco", dispositivos: e.target.checked ? "" : form.dispositivos })}
        />
        Según su sucursal
      </label>
      {propios && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {MEDIOS.map((m) => (
              <label key={m.valor} className="flex items-center gap-2">
                <input type="checkbox" checked={medios.includes(m.valor)} onChange={() => setForm({ ...form, medios: alternar(m.valor, medios) })} />
                {m.etiqueta}
              </label>
            ))}
          </div>
          {!medios.length && <p className="text-xs text-amber-700">Sin medios marcados no podrá checar.</p>}
          {aplicables.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-2">
              <p className="mb-1 text-xs text-slate-500">¿En cuáles? (ninguno marcado = en cualquiera)</p>
              {aplicables.map((d) => (
                <label key={d.id} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={elegidos.includes(d.id)} onChange={() => setForm({ ...form, dispositivos: alternar(d.id, elegidos) })} />
                  <span>{d.nombre}</span>
                  <span className="text-xs text-slate-400">
                    {d.tipo === "biometrico" ? "Reloj" : "Kiosco"} · {d.sucursal.clave}
                  </span>
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
