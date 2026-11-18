import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Bitacora from "../components/Bitacora";
import { Badge, ErrorBox, Modal, PageHeader, useEmpresaScope } from "../components/ui";
import { api, fechaHora, get, patch, post, type ConfigChecadas as Config, type Dispositivo, type Sucursal } from "../lib/api";
import { useAuth } from "../lib/auth";

const CAMPOS: (keyof Config)[] = [
  "permitir_movil",
  "permitir_kiosco",
  "validar_gps",
  "validar_qr",
  "foto",
  "pin_kiosco",
  "minutos_antes_entrada",
  "ignorar_repetida_min",
  "permitir_offline",
  "offline_max_horas",
];

function Opcion({ checked, onChange, titulo, children, extra }: { checked: boolean; onChange: (v: boolean) => void; titulo: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-4 first:border-t-0">
      <label className="flex flex-1 basis-72 cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="block font-medium text-navy-900">{titulo}</span>
          <span className="block text-sm text-slate-500">{children}</span>
        </span>
      </label>
      {extra}
    </div>
  );
}

export default function ConfigChecadas() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "superadmin" || usuario?.rol === "admin_empresa";
  const { query, listo, selector, empresaId } = useEmpresaScope();
  const sep = query ? "&" : "?";
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [alcance, setAlcance] = useState(""); // "" = general
  const [config, setConfig] = useState<Config | null>(null);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [rev, setRev] = useState(0);
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [nuevoDisp, setNuevoDisp] = useState(false);
  const [codigo, setCodigo] = useState<Dispositivo | null>(null);
  const [formDisp, setFormDisp] = useState({ nombre: "", sucursal_id: "", tipo: "kiosco" });
  const [errorDisp, setErrorDisp] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!listo) return;
    get<Config>(`/checadas/config${query}${alcance ? `${sep}sucursal_id=${alcance}` : ""}`).then(setConfig);
  }, [listo, query, sep, alcance]);
  useEffect(cargar, [cargar]);

  const cargarDisp = useCallback(() => {
    if (listo && esAdmin) get<Dispositivo[]>(`/dispositivos${query}`).then(setDispositivos);
  }, [listo, esAdmin, query]);
  useEffect(cargarDisp, [cargarDisp]);

  useEffect(() => {
    if (listo) get<Sucursal[]>(`/sucursales${query}`).then(setSucursales);
  }, [listo, query]);

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setConfig((c) => (c ? { ...c, [k]: v } : c));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!config) return;
    setMensaje(null);
    try {
      const datos = Object.fromEntries(CAMPOS.map((k) => [k, config[k]]));
      const r = await api<Config>(`/checadas/config${query}`, { method: "PUT", body: JSON.stringify({ ...datos, sucursal_id: alcance || null }) });
      setConfig(r);
      setMensaje({ ok: true, texto: "Configuración guardada." });
      setRev((n) => n + 1);
    } catch (err) {
      setMensaje({ ok: false, texto: (err as Error).message });
    }
  }

  async function usarGeneral() {
    await api(`/checadas/config${query}${sep}sucursal_id=${alcance}`, { method: "DELETE" });
    setRev((n) => n + 1);
    cargar();
  }

  async function crearDisp(e: FormEvent) {
    e.preventDefault();
    setErrorDisp(null);
    try {
      const d = await post<Dispositivo>(`/dispositivos${query}`, formDisp);
      setNuevoDisp(false);
      setCodigo(d);
      cargarDisp();
    } catch (err) {
      setErrorDisp((err as Error).message);
    }
  }

  const bloqueado = !esAdmin;
  const registroBitacora = alcance || empresaId;

  return (
    <>
      <PageHeader
        title="Configuración de checadas"
        subtitle="Elige cómo checan tus empleados y qué se valida. Cada sucursal puede usar la configuración general o una propia."
        action={selector}
      />

      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[999_1_560px] space-y-5">
          <div className="card flex flex-wrap items-end justify-between gap-4 p-5">
            <label className="min-w-64 flex-1 text-sm font-medium text-navy-900">
              Aplicar a
              <select className="input mt-1" value={alcance} onChange={(e) => setAlcance(e.target.value)}>
                <option value="">Toda la empresa (general)</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.clave} — {s.nombre}
                  </option>
                ))}
              </select>
            </label>
            {config && alcance && (
              <div className="flex items-center gap-3 text-sm">
                {config.origen === "sucursal" ? (
                  <>
                    <span className="rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-700">Configuración propia</span>
                    {esAdmin && (
                      <button type="button" className="text-slate-500 hover:underline" onClick={usarGeneral}>
                        Usar la general
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-slate-500">Usa la configuración general. Al guardar, tendrá la suya.</span>
                )}
              </div>
            )}
          </div>

          {config && (
            <form onSubmit={guardar} className="space-y-5">
              <fieldset disabled={bloqueado} className="card space-y-1 p-5">
                <legend className="sr-only">Dónde se puede checar</legend>
                <h2 className="mb-2 font-semibold text-navy-900">Dónde se puede checar</h2>
                <Opcion checked={config.permitir_movil} onChange={(v) => set("permitir_movil", v)} titulo="App en el celular">
                  Cada empleado checa desde su teléfono. Requiere darle acceso a la app.
                </Opcion>
                <Opcion checked={config.permitir_kiosco} onChange={(v) => set("permitir_kiosco", v)} titulo="Kiosco en la sucursal">
                  Una tablet fija en la entrada, para quien no tiene celular.
                </Opcion>
              </fieldset>

              <fieldset disabled={bloqueado} className="card p-5">
                <legend className="sr-only">Validaciones</legend>
                <h2 className="mb-2 font-semibold text-navy-900">Validaciones</h2>
                <Opcion
                  checked={config.validar_gps}
                  onChange={(v) => set("validar_gps", v)}
                  titulo="Ubicación GPS"
                  extra={<span className="text-xs text-slate-500">El radio se define en cada sucursal</span>}
                >
                  Solo permite checar desde el celular dentro del radio de la sucursal.
                </Opcion>
                <Opcion checked={config.validar_qr} onChange={(v) => set("validar_qr", v)} titulo="QR del kiosco">
                  Desde el celular, hay que escanear el QR de la tablet (cambia cada 30 s). Requiere un kiosco en la sucursal.
                </Opcion>
                <Opcion
                  checked={config.foto !== "ninguna"}
                  onChange={(v) => set("foto", v ? "ambos" : "ninguna")}
                  titulo="Foto al checar"
                  extra={
                    config.foto !== "ninguna" && (
                      <select className="input w-44" aria-label="Dónde pedir foto" value={config.foto} onChange={(e) => set("foto", e.target.value as Config["foto"])}>
                        <option value="ambos">Celular y kiosco</option>
                        <option value="movil">Solo celular</option>
                        <option value="kiosco">Solo kiosco</option>
                      </select>
                    )
                  }
                >
                  Evita que alguien cheque por otra persona. La foto queda en el registro.
                </Opcion>
                <Opcion checked={config.pin_kiosco} onChange={(v) => set("pin_kiosco", v)} titulo="PIN en el kiosco">
                  Número de empleado + PIN de 4 a 6 dígitos (se asigna en el expediente).
                </Opcion>
              </fieldset>

              <fieldset disabled={bloqueado} className="card space-y-4 p-5">
                <legend className="sr-only">Reglas</legend>
                <h2 className="font-semibold text-navy-900">Reglas</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <label className="text-sm font-medium text-navy-900">
                    Checar desde (min antes de la entrada)
                    <input type="number" min={0} max={720} className="input mt-1" value={config.minutos_antes_entrada} onChange={(e) => set("minutos_antes_entrada", Number(e.target.value))} />
                  </label>
                  <label className="text-sm font-medium text-navy-900">
                    Ignorar checada repetida (min)
                    <input type="number" min={0} max={120} className="input mt-1" value={config.ignorar_repetida_min} onChange={(e) => set("ignorar_repetida_min", Number(e.target.value))} />
                  </label>
                  <label className="text-sm font-medium text-navy-900">
                    Máx. horas sin internet
                    <input type="number" min={1} max={168} className="input mt-1" disabled={!config.permitir_offline} value={config.offline_max_horas} onChange={(e) => set("offline_max_horas", Number(e.target.value))} />
                  </label>
                </div>
                <Opcion checked={config.permitir_offline} onChange={(v) => set("permitir_offline", v)} titulo="Permitir checar sin internet">
                  Se guarda en el teléfono y se envía al reconectar. Queda marcada como “sin conexión”.
                </Opcion>
              </fieldset>

              {mensaje && <p className={`rounded-lg px-3 py-2 text-sm ${mensaje.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{mensaje.texto}</p>}
              {esAdmin && (
                <div className="flex justify-end">
                  <button className="btn-primary">Guardar cambios</button>
                </div>
              )}
            </form>
          )}

          {esAdmin && (
            <section className="card space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold text-navy-900">Dispositivos</h2>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setErrorDisp(null);
                    setFormDisp({ nombre: "", sucursal_id: alcance || sucursales[0]?.id || "", tipo: "kiosco" });
                    setNuevoDisp(true);
                  }}
                >
                  Agregar dispositivo
                </button>
              </div>
              {dispositivos.length === 0 && <p className="text-sm text-slate-500">Aún no hay kioscos ni relojes vinculados.</p>}
              <ul className="space-y-3">
                {dispositivos.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                    <div>
                      <p className="font-medium text-navy-900">{d.nombre}</p>
                      <p className="text-xs text-slate-500">
                        {d.tipo === "kiosco" ? "Kiosco" : "Reloj biométrico"} · {d.sucursal.clave}
                        {d.ultima_conexion && ` · última conexión ${fechaHora(d.ultima_conexion)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      {!d.activo ? <Badge ok={false}>Desactivado</Badge> : d.vinculado ? <Badge ok>Vinculado</Badge> : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Pendiente</span>}
                      <button
                        className="text-brand-600 hover:underline"
                        onClick={async () => {
                          if (d.vinculado && !confirm("Se desvinculará el equipo actual. ¿Generar un código nuevo?")) return;
                          setCodigo(await post<Dispositivo>(`/dispositivos/${d.id}/codigo${query}`, {}));
                          cargarDisp();
                        }}
                      >
                        {d.vinculado ? "Re-vincular" : "Ver código"}
                      </button>
                      <button
                        className="text-slate-500 hover:underline"
                        onClick={async () => {
                          await patch(`/dispositivos/${d.id}${query}`, { activo: !d.activo });
                          cargarDisp();
                        }}
                      >
                        {d.activo ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <strong className="text-navy-900">Relojes biométricos (huella / rostro):</strong> el sistema ya recibe sus registros. La conexión con cada modelo (ZKTeco y compatibles) se configura en la etapa final.
              </div>
            </section>
          )}
        </div>

        {registroBitacora && (
          <aside className="card min-w-0 flex-[1_1_300px] p-5">
            <h2 className="mb-4 font-semibold text-navy-900">Historial de cambios</h2>
            <Bitacora key={registroBitacora} modelo="config_checadas" registroId={registroBitacora} query={query} recargar={rev} />
          </aside>
        )}
      </div>

      {nuevoDisp && (
        <Modal title="Agregar dispositivo" onClose={() => setNuevoDisp(false)}>
          <form onSubmit={crearDisp} className="space-y-4">
            <div>
              <label className="label">Nombre</label>
              <input className="input" required placeholder="Tablet recepción" value={formDisp.nombre} onChange={(e) => setFormDisp({ ...formDisp, nombre: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Sucursal</label>
                <select className="input" required value={formDisp.sucursal_id} onChange={(e) => setFormDisp({ ...formDisp, sucursal_id: e.target.value })}>
                  <option value="">Selecciona…</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.clave} — {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Tipo</label>
                <select className="input" value={formDisp.tipo} onChange={(e) => setFormDisp({ ...formDisp, tipo: e.target.value })}>
                  <option value="kiosco">Kiosco (tablet)</option>
                  <option value="biometrico">Reloj biométrico</option>
                </select>
              </div>
            </div>
            <ErrorBox message={errorDisp} />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setNuevoDisp(false)}>
                Cancelar
              </button>
              <button className="btn-primary">Crear y obtener código</button>
            </div>
          </form>
        </Modal>
      )}

      {codigo && (
        <Modal title={`Vincular “${codigo.nombre}”`} onClose={() => setCodigo(null)}>
          <div className="space-y-4 text-center">
            {codigo.tipo === "kiosco" ? (
              <ol className="list-decimal space-y-1 pl-5 text-left text-sm text-slate-600">
                <li>
                  En la tablet, abre <strong className="font-mono text-navy-900">{location.origin}/kiosco</strong>
                </li>
                <li>Escribe este código:</li>
              </ol>
            ) : (
              <p className="text-sm text-slate-600">Usa este código al configurar el puente del reloj biométrico.</p>
            )}
            <p className="font-mono text-5xl font-bold tracking-[0.3em] text-brand-600">{codigo.codigo_vinculacion}</p>
            {codigo.codigo_expira && <p className="text-xs text-slate-500">Vence a las {new Date(codigo.codigo_expira).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })} (15 minutos).</p>}
            <button className="btn-primary w-full" onClick={() => setCodigo(null)}>
              Listo
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
