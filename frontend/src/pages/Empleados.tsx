import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Avatar from "../components/Avatar";
import Bitacora from "../components/Bitacora";
import Camara from "../components/Camara";
import Registro, { useFormulario } from "../components/Registro";
import VacacionesIncidencias from "../components/VacacionesIncidencias";
import { AvisoLicencia, Badge, ErrorBox, Modal, PageHeader, UsoLicencia, useEmpresaScope } from "../components/ui";
import {
  api,
  comprimir,
  descargar,
  errorLicencia,
  fechaCorta,
  get,
  hoyISO,
  patch,
  post,
  subir,
  type Empleado,
  type EmpleadoDetalle,
  type Licencia,
  type LimiteLicencia,
  type Sucursal,
  type Turno,
} from "../lib/api";
import { useAuth } from "../lib/auth";

const CAMPOS = [
  "numero", "nombre", "apellido_paterno", "apellido_materno", "curp", "rfc", "nss", "fecha_ingreso",
  "puesto", "departamento", "salario_diario", "email", "telefono", "sucursal_id",
] as const;
type Campo = (typeof CAMPOS)[number];
type Form = Record<Campo, string> & { turno_id: string; pin: string };

const vacio = (sucursal_id = ""): Form => ({
  ...(Object.fromEntries(CAMPOS.map((c) => [c, ""])) as Record<Campo, string>),
  fecha_ingreso: hoyISO(),
  sucursal_id,
  turno_id: "",
  pin: "",
});

type Vista = "detalle" | "turno" | "baja" | "acceso";

export default function Empleados() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "superadmin" || usuario?.rol === "admin_empresa";
  const { query, listo, selector } = useEmpresaScope();
  const sep = query ? "&" : "?";

  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [filtros, setFiltros] = useState({ q: "", sucursal_id: "", estado: "activos" });

  const [nuevo, setNuevo] = useState(false);
  const [sel, setSel] = useState<EmpleadoDetalle | null>(null);
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
    const p = new URLSearchParams({ estado: filtros.estado });
    if (filtros.q.trim()) p.set("q", filtros.q.trim());
    if (filtros.sucursal_id) p.set("sucursal_id", filtros.sucursal_id);
    get<Empleado[]>(`/empleados${query}${sep}${p}`).then(setEmpleados);
    cargarLicencia();
  }, [listo, query, sep, filtros, cargarLicencia]);

  useEffect(() => {
    const t = setTimeout(cargar, 250); // espera a que termine de escribir
    return () => clearTimeout(t);
  }, [cargar]);

  useEffect(() => {
    if (!listo) return;
    get<Sucursal[]>(`/sucursales${query}`).then(setSucursales);
    get<Turno[]>(`/turnos${query}`).then(setTurnos);
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
      const { turno_id: _t, pin, ...datos } = form;
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

  const indiceSel = sel ? empleados.findIndex((x) => x.id === sel.id) : -1;

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
      const { turno_id, pin, ...datos } = form;
      let creado = await post<EmpleadoDetalle>(`/empleados${query}`, { ...datos, turno_id: turno_id || null, pin: pin || null });
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

  const camposExpediente = (conTurno: boolean) => (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {input("numero", "Número *", { required: true, maxLength: 20 })}
        <div className="sm:col-span-2">{input("nombre", "Nombre(s) *", { required: true })}</div>
        {input("apellido_paterno", "Apellido paterno *", { required: true })}
        {input("apellido_materno", "Apellido materno")}
        {input("fecha_ingreso", "Fecha de ingreso *", { type: "date", required: true })}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Sucursal *</label>
          <select className="input" required value={form.sucursal_id} onChange={set("sucursal_id")}>
            <option value="">Selecciona…</option>
            {sucursalesActivas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.clave} — {s.nombre}
              </option>
            ))}
          </select>
        </div>
        {conTurno ? (
          <div>
            <label className="label">Turno</label>
            <select className="input" value={form.turno_id} onChange={set("turno_id")}>
              <option value="">Sin turno por ahora</option>
              {turnosActivos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div />
        )}
        {input("puesto", "Puesto")}
        {input("departamento", "Departamento")}
      </div>
      <fieldset className="grid grid-cols-1 gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-3">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">Datos fiscales y laborales</legend>
        {input("curp", "CURP", { maxLength: 18, className: "input uppercase" })}
        {input("rfc", "RFC", { maxLength: 13, className: "input uppercase" })}
        {input("nss", "NSS (IMSS)", { maxLength: 13, inputMode: "numeric" })}
        {input("salario_diario", "Salario diario", { type: "number", min: 0, step: "0.01" })}
        {input("email", "Correo", { type: "email" })}
        {input("telefono", "Teléfono", { type: "tel", maxLength: 20 })}
        <div>
          <label className="label">PIN del kiosco</label>
          <input
            className="input tracking-widest"
            inputMode="numeric"
            pattern="\d{4,6}"
            maxLength={6}
            title="De 4 a 6 dígitos"
            placeholder={sel?.tiene_pin && !nuevo ? "•••• (asignado)" : "4 a 6 dígitos"}
            value={form.pin}
            onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
          />
        </div>
      </fieldset>
    </>
  );

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
        title="Empleados"
        subtitle="Expediente, sucursal y turno de cada colaborador"
        action={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {lic && <UsoLicencia lic={lic} compacto />}
            {selector}
            {esAdmin && listo && (
              <button className="btn-secondary" onClick={() => setImportando(true)}>
                Importar Excel
              </button>
            )}
            {listo && (
              <button className="btn-primary" onClick={abrirNuevo}>
                Nuevo empleado
              </button>
            )}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem_10rem]">
        <input className="input" placeholder="Buscar por nombre, número o CURP…" value={filtros.q} onChange={(e) => setFiltros({ ...filtros, q: e.target.value })} />
        <select className="input" value={filtros.sucursal_id} onChange={(e) => setFiltros({ ...filtros, sucursal_id: e.target.value })}>
          <option value="">Todas las sucursales</option>
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.clave} — {s.nombre}
            </option>
          ))}
        </select>
        <select className="input" value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
          <option value="activos">Activos</option>
          <option value="bajas">Bajas</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Empleado</th>
              <th className="hidden px-4 py-3 md:table-cell">Puesto</th>
              <th className="hidden px-4 py-3 sm:table-cell">Sucursal</th>
              <th className="hidden px-4 py-3 lg:table-cell">Turno</th>
              <th className="px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {empleados.map((e) => (
              <tr key={e.id} className="cursor-pointer hover:bg-brand-50/50" onClick={() => abrirDetalle(e.id)}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar empleadoId={e.id} nombre={e.nombre_completo} version={e.foto_version} query={query} tam={36} />
                    <div>
                      <p className="font-medium text-navy-900">{e.nombre_completo}</p>
                      <p className="font-mono text-xs text-slate-500">#{e.numero}</p>
                    </div>
                  </div>
                </td>
                <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{e.puesto ?? "—"}</td>
                <td className="hidden px-4 py-3 sm:table-cell">
                  <span className="font-mono text-xs font-semibold text-brand-600">{e.sucursal.clave}</span>
                </td>
                <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">{e.turno_actual?.nombre ?? <span className="text-amber-600">Sin turno</span>}</td>
                <td className="px-4 py-3">
                  <Badge ok={e.activo}>{e.activo ? "Activo" : "Baja"}</Badge>
                </td>
              </tr>
            ))}
            {empleados.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  No hay empleados con esos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">{empleados.length} empleado(s)</p>

      {/* Alta */}
      {nuevo && (
        <Modal title="Nuevo empleado" onClose={() => setNuevo(false)} ancho="lg">
          <form onSubmit={crear} className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="group relative cursor-pointer" title="Subir foto">
                {previa ? (
                  <img src={previa} alt="Foto del empleado" className="h-20 w-20 rounded-full object-cover" />
                ) : (
                  <span className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-brand-300 bg-brand-50 text-brand-500">
                    <IconoCamara />
                  </span>
                )}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && elegirFotoNueva(e.target.files[0])} />
              </label>
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-navy-900">Foto del empleado</span>
                <div className="flex gap-3">
                  <label className="cursor-pointer font-medium text-brand-600 hover:underline">
                    {previa ? "Cambiar" : "Subir foto"}
                    <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && elegirFotoNueva(e.target.files[0])} />
                  </label>
                  <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setCamaraFoto(true)}>
                    Tomar con la cámara
                  </button>
                  {previa && (
                    <button type="button" className="text-slate-500 hover:text-red-600 hover:underline" onClick={() => elegirFotoNueva(null)}>
                      Quitar
                    </button>
                  )}
                </div>
              </div>
            </div>
            {camposExpediente(true)}
            <ErrorBox message={error} />
            {botones(() => setNuevo(false))}
          </form>
        </Modal>
      )}

      {/* Detalle y acciones */}
      {sel && (
        <Registro
          titulo={sel.nombre_completo}
          subtitulo={`#${sel.numero} · ${sel.sucursal.clave} — ${sel.sucursal.nombre}`}
          indice={indiceSel >= 0 ? indiceSel : undefined}
          total={empleados.length}
          onIr={(i) => abrirDetalle(empleados[i].id)}
          sucio={vista === "detalle" && sucio}
          onGuardar={guardarFicha}
          onDescartar={descartar}
          onCerrar={() => setSel(null)}
        >
          {vista === "detalle" && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-4">
                <label className="group relative cursor-pointer" title={sel.foto_version ? "Cambiar foto" : "Subir foto"}>
                  <Avatar empleadoId={sel.id} nombre={sel.nombre_completo} version={sel.foto_version} query={query} tam={88} />
                  <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-white shadow ring-2 ring-white group-hover:bg-brand-600">
                    <IconoCamara pequeno />
                  </span>
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && guardarFoto(e.target.files[0])} />
                </label>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <label className="cursor-pointer font-medium text-brand-600 hover:underline">
                    {sel.foto_version ? "Cambiar foto" : "Subir foto"}
                    <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && guardarFoto(e.target.files[0])} />
                  </label>
                  <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setCamaraFoto(true)}>
                    Tomar con la cámara
                  </button>
                  {sel.foto_version && (
                    <button type="button" className="text-slate-500 hover:text-red-600 hover:underline" onClick={() => ejecutar(() => api<EmpleadoDetalle>(`/empleados/${sel.id}/foto${query}`, { method: "DELETE" }))}>
                      Quitar
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">#{sel.numero}</span>
                <Badge ok={sel.activo}>{sel.activo ? "Activo" : `Baja ${fechaCorta(sel.fecha_baja)}`}</Badge>
                {sel.tiene_pin && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">PIN de kiosco</span>}
                {sel.tiene_acceso && <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-xs font-medium text-accent-500">Con acceso a la app</span>}
              </div>
              {!sel.activo && sel.motivo_baja && <p className="text-sm text-slate-600">Motivo de baja: {sel.motivo_baja}</p>}

              <form className="space-y-4" onSubmit={(ev) => (ev.preventDefault(), guardarFicha())}>
                {camposExpediente(false)}
                <button type="submit" className="sr-only">
                  Guardar
                </button>
              </form>

              <div>
                <h3 className="mb-2 text-sm font-medium text-navy-900">Historial de turnos</h3>
                {sel.asignaciones.length === 0 ? (
                  <p className="text-sm text-amber-600">Sin turno asignado.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                    {sel.asignaciones.map((a) => (
                      <li key={a.id} className="flex justify-between gap-3 px-3 py-2">
                        <span className="font-medium text-navy-900">{a.turno.nombre}</span>
                        <span className="text-slate-500">
                          {fechaCorta(a.fecha_inicio)} → {a.fecha_fin ? fechaCorta(a.fecha_fin) : "vigente"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <ErrorBox message={error} />
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                {sel.activo && (
                  <button className="btn-secondary" onClick={() => irA("turno")}>
                    Cambiar turno
                  </button>
                )}
                {sel.activo && !sel.tiene_acceso && (
                  <button className="btn-secondary" onClick={() => irA("acceso")}>
                    Dar acceso a la app
                  </button>
                )}
                {sel.activo ? (
                  <button className="btn-secondary text-red-600" onClick={() => irA("baja")}>
                    Dar de baja
                  </button>
                ) : (
                  <button className="btn-secondary" onClick={() => ejecutar(() => post<EmpleadoDetalle>(`/empleados/${sel.id}/reactivar${query}`, {}))}>
                    Reactivar
                  </button>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h3 className="mb-3 text-sm font-medium text-navy-900">Vacaciones e incidencias</h3>
                <VacacionesIncidencias empleadoId={sel.id} query={query} onCambio={() => setHistorial((n) => n + 1)} />
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h3 className="mb-3 text-sm font-medium text-navy-900">Historial</h3>
                <Bitacora modelo="empleado" registroId={sel.id} query={query} recargar={historial} />
              </div>
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
