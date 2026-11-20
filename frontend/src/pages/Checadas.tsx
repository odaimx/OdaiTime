import { useCallback, useEffect, useState, type FormEvent } from "react";
import Avatar from "../components/Avatar";
import Bitacora from "../components/Bitacora";
import Registro from "../components/Registro";
import FotoChecada from "../components/FotoChecada";
import Icono from "../components/Iconos";
import Vista, { useVista, type ConfigVista } from "../components/Vista";
import { Badge, Campos, ErrorBox, Fila, Modal, PageHeader, useEmpresaScope, Plegable } from "../components/ui";
import { fechaHora, get, hoyISO, ORIGENES, patch, post, type Checada, type Empleado, type Sucursal } from "../lib/api";
import { useBanda } from "../lib/bandas";

const haceDias = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA");
};

const localInput = (iso: string) => {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export default function Checadas() {
  const banda = useBanda("asistencias");
  const { query, listo, selector, empresaId } = useEmpresaScope();
  const sep = query ? "&" : "?";
  const [filtros, setFiltros] = useState({ desde: haceDias(6), hasta: hoyISO() });
  const [checadas, setChecadas] = useState<Checada[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [sel, setSel] = useState<Checada | null>(null);
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ empleado_id: "", tipo: "entrada", momento: "", motivo: "" });
  const [corr, setCorr] = useState({ tipo: "", momento: "", estado: "", motivo: "" });
  const [rev, setRev] = useState(0);

  const cargar = useCallback(() => {
    if (!listo) return;
    const p = new URLSearchParams({ desde: filtros.desde, hasta: filtros.hasta, incluir_anuladas: "true" });
    get<Checada[]>(`/checadas${query}${sep}${p}`).then(setChecadas).catch((e) => setError(e.message));
  }, [listo, query, sep, filtros]);
  useEffect(cargar, [cargar]);

  useEffect(() => {
    if (!listo) return;
    get<Sucursal[]>(`/sucursales${query}`).then(setSucursales);
    get<Empleado[]>(`/empleados${query}`).then(setEmpleados);
  }, [listo, query]);

  function abrir(c: Checada) {
    setError(null);
    setCorr({ tipo: c.tipo, momento: localInput(c.momento), estado: c.estado, motivo: "" });
    setSel(c);
  }

  async function corregir(e?: FormEvent): Promise<boolean> {
    e?.preventDefault();
    if (!sel) return false;
    setError(null);
    if (corr.motivo.trim().length < 3) {
      setError("Escribe el motivo de la corrección (al menos 3 letras).");
      return false;
    }
    try {
      const cambios: Record<string, string> = { motivo: corr.motivo };
      if (corr.tipo !== sel.tipo) cambios.tipo = corr.tipo;
      if (corr.momento !== localInput(sel.momento)) cambios.momento = new Date(corr.momento).toISOString();
      if (corr.estado !== sel.estado) cambios.estado = corr.estado;
      const r = await patch<Checada>(`/checadas/${sel.id}${query}`, cambios);
      setSel(r);
      setCorr((x) => ({ ...x, motivo: "" }));
      setRev((n) => n + 1);
      cargar();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  const config: ConfigVista<Checada> = {
    id: "asistencias",
    clave: (c) => c.id,
    onAbrir: abrir,
    fuentes: "registro de jornada: art. 132, fracción XXXIV",
    tituloReporte: `Asistencias · ${filtros.desde} al ${filtros.hasta}`,
    acciones: listo && (
      <button
        className="btn-primary"
        title="Registrar checada manual"
        onClick={() => {
          setError(null);
          setForm({ empleado_id: "", tipo: "entrada", momento: localInput(new Date().toISOString()), motivo: "" });
          setManual(true);
        }}
      >
        <Icono nombre="alarm-clock-plus" /> Nuevo
      </button>
    ),
    vacio: "No hay checadas en ese periodo.",
    ordenInicial: { clave: "momento", dir: "desc" },
    columnas: [
      {
        clave: "empleado",
        titulo: "Empleado",
        fija: true,
        buscable: true,
        valor: (c) => c.empleado.nombre_completo,
        render: (c) => (
          <div className={`flex items-center gap-3 ${c.estado === "anulada" ? "opacity-50" : ""}`}>
            <Avatar empleadoId={c.empleado.id} nombre={c.empleado.nombre_completo} version={c.empleado.foto_actualizada} query={query} tam={32} />
            <div className="min-w-0">
              <p className="truncate font-medium text-tinta-900">{c.empleado.nombre_completo}</p>
              <p className="font-mono text-xs text-slate-500">#{c.empleado.numero}</p>
            </div>
          </div>
        ),
      },
      { clave: "numero", titulo: "Número", buscable: true, visible: false, valor: (c) => c.empleado.numero },
      {
        clave: "tipo",
        titulo: "Tipo",
        agrupable: true,
        valor: (c) => (c.tipo === "entrada" ? "Entrada" : "Salida"),
        render: (c) => (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.tipo === "entrada" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>{c.tipo === "entrada" ? "Entrada" : "Salida"}</span>
        ),
      },
      { clave: "momento", titulo: "Fecha y hora", valor: (c) => c.momento, render: (c) => <span className="whitespace-nowrap tabular-nums">{fechaHora(c.momento)}</span> },
      { clave: "dia", titulo: "Día", agrupable: true, visible: false, valor: (c) => c.momento.slice(0, 10) },
      { clave: "origen", titulo: "Origen", agrupable: true, valor: (c) => ORIGENES[c.origen] },
      { clave: "sucursal", titulo: "Sucursal", buscable: true, agrupable: true, valor: (c) => c.sucursal.nombre, render: (c) => <span className="font-mono text-xs font-semibold text-brand-600">{c.sucursal.clave}</span> },
      { clave: "obra", titulo: "Zona", buscable: true, agrupable: true, valor: (c) => (c.obra ? c.obra.nombre : "Sin zona"), render: (c) => (c.obra ? <span title={c.obra.nombre} className="font-mono text-xs font-semibold text-brand-600">{c.obra.clave}</span> : <span className="text-slate-300">—</span>) },
      {
        clave: "obs",
        titulo: "Observaciones",
        valor: (c) => [c.retardo_minutos ? `Retardo ${c.retardo_minutos} min` : "", c.offline ? "Sin conexión" : "", c.corregida ? "Corregida" : "", c.estado === "anulada" ? "Anulada" : ""].filter(Boolean).join(", "),
        render: (c) => (
          <span className="space-x-1">
            {c.retardo_minutos ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Retardo {c.retardo_minutos} min</span> : null}
            {c.offline && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Sin conexión</span>}
            {c.corregida && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">Corregida</span>}
            {c.estado === "anulada" && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">Anulada</span>}
          </span>
        ),
      },
    ],
    filtros: [
      { clave: "entradas", titulo: "Entradas", grupo: "tipo", prueba: (c) => c.tipo === "entrada" },
      { clave: "salidas", titulo: "Salidas", grupo: "tipo", prueba: (c) => c.tipo === "salida" },
      { clave: "retardos", titulo: "Con retardo", grupo: "obs", prueba: (c) => !!c.retardo_minutos },
      { clave: "offline", titulo: "Sin conexión", grupo: "obs", prueba: (c) => c.offline },
      { clave: "corregidas", titulo: "Corregidas", grupo: "obs", prueba: (c) => c.corregida },
      { clave: "hoy", titulo: "Hoy", grupo: "fecha", prueba: (c) => new Date(c.momento).toLocaleDateString("en-CA") === hoyISO() },
      { clave: "validas", titulo: "Válidas", grupo: "estado", prueba: (c) => c.estado !== "anulada" },
      { clave: "anuladas", titulo: "Anuladas", grupo: "estado", prueba: (c) => c.estado === "anulada" },
    ],
    filtrosIniciales: ["validas"],
    tarjetas: [
      { filtro: "hoy", color: "verde" },
      { filtro: "retardos", color: "naranja" },
      { filtro: "corregidas", color: "morado" },
      { filtro: "offline", color: "azul" },
    ],
    panel: (
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-500">
          Desde
          <input type="date" className="input mt-1 w-40" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Hasta
          <input type="date" className="input mt-1 w-40" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
        </label>
      </div>
    ),
  };
  const vista = useVista(config, checadas);
  const enOrden = vista.ordenados;

  async function crearManual(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await post(`/checadas/manual${query}`, { ...form, momento: new Date(form.momento).toISOString() });
      setManual(false);
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader submenu={banda}
        icono="fingerprint-pattern"
        title="Asistencias"
        subtitle="Registros de entrada y salida (checadas) de todas las sucursales"
        action={selector}
      />

      <ErrorBox message={!sel && !manual ? error : null} />

      <Vista vista={vista} />


      {manual && (
        <Modal title="Registrar checada manual" onClose={() => setManual(false)}>
          <form onSubmit={crearManual} className="space-y-4">
            <div>
              <label className="label">Empleado</label>
              <select className="input" required value={form.empleado_id} onChange={(e) => setForm({ ...form, empleado_id: e.target.value })}>
                <option value="">Selecciona…</option>
                {empleados.map((e) => (
                  <option key={e.id} value={e.id}>
                    #{e.numero} — {e.nombre_completo}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Tipo</label>
                <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                  <option value="entrada">Entrada</option>
                  <option value="salida">Salida</option>
                </select>
              </div>
              <div>
                <label className="label">Fecha y hora</label>
                <input type="datetime-local" className="input" required value={form.momento} onChange={(e) => setForm({ ...form, momento: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">Motivo</label>
              <input className="input" required minLength={3} placeholder="Olvidó checar, falla del kiosco…" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} />
            </div>
            <p className="text-xs text-slate-500">Queda registrada en el historial con tu nombre y el motivo.</p>
            <ErrorBox message={error} />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setManual(false)}>
                Cancelar
              </button>
              <button className="btn-primary">Registrar</button>
            </div>
          </form>
        </Modal>
      )}

      {sel && (
        <Registro
          titulo={sel.empleado.nombre_completo}
          subtitulo={`${sel.tipo === "entrada" ? "Entrada" : "Salida"} · ${fechaHora(sel.momento)}`}
          imagen={sel.tiene_foto ? <FotoChecada checadaId={sel.id} query={query} className="h-36 w-28" /> : undefined}
          indice={Math.max(enOrden.findIndex((x) => x.id === sel.id), 0)}
          total={enOrden.length}
          onIr={(i) => abrir(enOrden[i])}
          sucio={corr.tipo !== sel.tipo || corr.momento !== localInput(sel.momento) || corr.estado !== sel.estado}
          autoguardar={false}
          onGuardar={() => corregir()}
          onDescartar={() => abrir(sel)}
          onCerrar={() => setSel(null)}
        >
          <form onSubmit={corregir} className="space-y-5">
            <Campos>
              <Fila etiqueta="Tipo" htmlFor="ch-tipo">
                <select id="ch-tipo" className="input" value={corr.tipo} onChange={(e) => setCorr({ ...corr, tipo: e.target.value })}>
                  <option value="entrada">Entrada</option>
                  <option value="salida">Salida</option>
                </select>
              </Fila>
              <Fila etiqueta="Origen">
                <span className="text-sm text-tinta-900">{ORIGENES[sel.origen]}</span>
              </Fila>
              <Fila etiqueta="Fecha y hora" htmlFor="ch-momento">
                <input id="ch-momento" type="datetime-local" className="input" value={corr.momento} onChange={(e) => setCorr({ ...corr, momento: e.target.value })} />
              </Fila>
              <Fila etiqueta="Sucursal">
                <span className="text-sm text-tinta-900">
                  {sel.sucursal.clave} — {sel.sucursal.nombre}
                </span>
              </Fila>
              <Fila etiqueta="Estado" htmlFor="ch-estado">
                <select id="ch-estado" className="input" value={corr.estado} onChange={(e) => setCorr({ ...corr, estado: e.target.value })}>
                  <option value="valida">Válida</option>
                  <option value="anulada">Anulada</option>
                </select>
              </Fila>
              <Fila etiqueta="Distancia">
                <span className="text-sm text-tinta-900">{sel.distancia_m != null ? `${sel.distancia_m} m` : "—"}</span>
              </Fila>
              <Fila etiqueta="Motivo del cambio" htmlFor="ch-motivo" ayuda="Obligatorio para corregir una checada; queda en el historial.">
                <input id="ch-motivo" className="input" placeholder="Obligatorio si corriges" value={corr.motivo} onChange={(e) => setCorr({ ...corr, motivo: e.target.value })} />
              </Fila>
              <Fila etiqueta="Retardo">
                <span className="text-sm text-tinta-900">{sel.retardo_minutos ? `${sel.retardo_minutos} min` : "—"}</span>
              </Fila>
            </Campos>
            <ErrorBox message={error} />
            <button type="submit" className="sr-only">
              Guardar
            </button>
            <Plegable titulo="Historial de cambios">
              <Bitacora modelo="checada" registroId={sel.id} query={query} recargar={rev} />
            </Plegable>
          </form>
        </Registro>
      )}
    </>
  );
}
