import { useCallback, useEffect, useState, type FormEvent } from "react";
import Bitacora from "../components/Bitacora";
import Icono from "../components/Iconos";
import Registro, { useFormulario } from "../components/Registro";
import Vista, { useAbrirDesdeUrl, useVista, type ConfigVista } from "../components/Vista";
import { Badge, Campos, ErrorBox, Fila, Modal, PageHeader, Plegable, useEmpresaScope, type ItemSubmenu } from "../components/ui";
import { fechaHora, get, patch, post, type Dispositivo, type Sucursal } from "../lib/api";

type Form = { nombre: string; sucursal_id: string; tipo: string; serie: string };
const VACIO: Form = { nombre: "", sucursal_id: "", tipo: "kiosco", serie: "" };
const aForm = (d: Dispositivo): Form => ({ nombre: d.nombre, sucursal_id: d.sucursal.id, tipo: d.tipo, serie: d.serie ?? "" });
const TIPO = { kiosco: "Kiosco (tablet)", biometrico: "Reloj biométrico" } as const;

function estado(d: Dispositivo) {
  if (!d.activo) return <Badge ok={false}>Desactivado</Badge>;
  if (d.vinculado) return <Badge ok>Vinculado</Badge>;
  return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Pendiente</span>;
}

/** Kioscos y relojes de la empresa: kanban o lista y su formulario (como las demás pantallas). */
export default function Dispositivos({ submenu }: { submenu?: ItemSubmenu[] }) {
  const { query, listo, selector } = useEmpresaScope();
  const [lista, setLista] = useState<Dispositivo[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [editando, setEditando] = useState<Dispositivo | "nuevo" | null>(null);
  const { form, setForm, cargar: cargarForm, sucio, descartar } = useFormulario<Form>(VACIO);
  const [codigo, setCodigo] = useState<Dispositivo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!listo) return;
    get<Dispositivo[]>(`/dispositivos${query}`).then(setLista);
    get<Sucursal[]>(`/sucursales${query}`).then((s) => setSucursales(s.filter((x) => x.activa)));
  }, [query, listo]);
  useEffect(cargar, [cargar]);

  function abrir(d: Dispositivo | "nuevo") {
    setError(null);
    cargarForm(d === "nuevo" ? { ...VACIO, sucursal_id: sucursales[0]?.id ?? "" } : aForm(d));
    setEditando(d);
  }

  async function guardar(): Promise<boolean> {
    setError(null);
    const datos = { nombre: form.nombre, sucursal_id: form.sucursal_id, tipo: form.tipo, serie: form.serie || null };
    try {
      if (editando === "nuevo") {
        const d = await post<Dispositivo>(`/dispositivos${query}`, datos);
        setCodigo(d);
        cargarForm(aForm(d));
        setEditando(d);
      } else {
        const d = await patch<Dispositivo>(`/dispositivos/${(editando as Dispositivo).id}${query}`, datos);
        cargarForm(aForm(d));
        setEditando(d);
      }
      cargar();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function nuevoCodigo(d: Dispositivo) {
    if (d.vinculado && !confirm("Se desvinculará el equipo actual. ¿Generar un código nuevo?")) return;
    setCodigo(await post<Dispositivo>(`/dispositivos/${d.id}/codigo${query}`, {}));
    cargar();
  }

  async function alternar(d: Dispositivo) {
    const r = await patch<Dispositivo>(`/dispositivos/${d.id}${query}`, { activo: !d.activo });
    setEditando(r);
    cargar();
  }

  const config: ConfigVista<Dispositivo> = {
    id: "dispositivos",
    tituloReporte: "Dispositivos",
    clave: (d) => d.id,
    onAbrir: abrir,
    acciones: (
      <button className="btn-primary" onClick={() => abrir("nuevo")} disabled={!sucursales.length}>
        <Icono nombre="plus" /> Nuevo
      </button>
    ),
    vacio: "Aún no hay kioscos ni relojes. Agrega uno y vincúlalo con su código.",
    ordenInicial: { clave: "nombre", dir: "asc" },
    columnas: [
      { clave: "nombre", titulo: "Nombre", fija: true, buscable: true, enlace: true, valor: (d) => d.nombre },
      { clave: "tipo", titulo: "Tipo", agrupable: true, valor: (d) => TIPO[d.tipo] },
      { clave: "sucursal", titulo: "Sucursal", agrupable: true, buscable: true, valor: (d) => `${d.sucursal.clave} · ${d.sucursal.nombre}` },
      { clave: "conexion", titulo: "Última conexión", valor: (d) => d.ultima_conexion, render: (d) => (d.ultima_conexion ? fechaHora(d.ultima_conexion) : "—") },
      { clave: "estado", titulo: "Estado", agrupable: true, valor: (d) => (!d.activo ? "Desactivado" : d.vinculado ? "Vinculado" : "Pendiente"), render: estado },
    ],
    filtros: [
      { clave: "activos", titulo: "Activos", grupo: "estado", prueba: (d) => d.activo },
      { clave: "pendientes", titulo: "Sin vincular", grupo: "estado", prueba: (d) => d.activo && !d.vinculado },
    ],
    filtrosIniciales: ["activos"],
    kanban: (d) => (
      <div className="space-y-1 pr-6">
        <div className="flex items-center gap-2">
          <Icono nombre={d.tipo === "kiosco" ? "smartphone" : "fingerprint-pattern"} className="h-5 w-5 text-brand-600" />
          <p className="truncate font-semibold text-tinta-900">{d.nombre}</p>
        </div>
        <p className="text-xs text-slate-500">
          {TIPO[d.tipo]} · {d.sucursal.clave}
        </p>
        <p className="text-xs text-slate-500">{d.ultima_conexion ? `Última conexión ${fechaHora(d.ultima_conexion)}` : "Sin conexión aún"}</p>
        <div className="pt-1">{estado(d)}</div>
      </div>
    ),
  };
  const vista = useVista(config, lista);
  useAbrirDesdeUrl(lista, (d) => d.id, abrir);
  const indice = editando && editando !== "nuevo" ? vista.ordenados.findIndex((x) => x.id === editando.id) : -1;

  return (
    <>
      <PageHeader submenu={submenu} icono="monitor" title="Dispositivos" action={selector} />
      <Vista vista={vista} />
      {editando && (
        <Registro
          titulo={editando === "nuevo" ? "Nuevo dispositivo" : editando.nombre}
          subtitulo={editando === "nuevo" ? undefined : `${TIPO[editando.tipo]} · ${editando.sucursal.nombre}`}
          indice={indice >= 0 ? indice : undefined}
          total={vista.ordenados.length}
          onIr={(i) => abrir(vista.ordenados[i])}
          sucio={editando === "nuevo" || sucio}
          autoguardar={editando !== "nuevo"}
          onGuardar={guardar}
          onDescartar={descartar}
          onCerrar={() => setEditando(null)}
          acciones={
            editando === "nuevo"
              ? []
              : [
                  { etiqueta: editando.vinculado ? "Re-vincular (código nuevo)" : "Ver código de vinculación", icono: "key-round", onClick: () => nuevoCodigo(editando) },
                  { etiqueta: editando.activo ? "Desactivar" : "Activar", icono: "eye-off", onClick: () => alternar(editando), separar: true },
                ]
          }
        >
          <form onSubmit={(e: FormEvent) => (e.preventDefault(), guardar())} className="space-y-5">
            <Campos>
              <Fila etiqueta="Nombre" htmlFor="disp-nombre">
                <input id="disp-nombre" className="input" required placeholder="Tablet recepción" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              </Fila>
              <Fila etiqueta="Sucursal" htmlFor="disp-suc" ayuda="Los empleados de esta sucursal checan aquí por omisión.">
                <select id="disp-suc" className="input" required value={form.sucursal_id} onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })}>
                  <option value="">Selecciona…</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.clave} — {s.nombre}
                    </option>
                  ))}
                </select>
              </Fila>
              <Fila etiqueta="Tipo" htmlFor="disp-tipo">
                <select id="disp-tipo" className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                  {Object.entries(TIPO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Fila>
              <Fila etiqueta="Número de serie" htmlFor="disp-serie">
                <input id="disp-serie" className="input" maxLength={60} value={form.serie} onChange={(e) => setForm({ ...form, serie: e.target.value })} />
              </Fila>
              {editando !== "nuevo" && (
                <>
                  <Fila etiqueta="Estado">{estado(editando)}</Fila>
                  <Fila etiqueta="Última conexión">
                    <span className="text-sm text-tinta-900">{editando.ultima_conexion ? fechaHora(editando.ultima_conexion) : "Sin conexión aún"}</span>
                  </Fila>
                </>
              )}
            </Campos>
            {editando !== "nuevo" && (
              <Plegable titulo="Historial de cambios">
                <Bitacora modelo="dispositivo" registroId={editando.id} query={query} />
              </Plegable>
            )}
            <ErrorBox message={error} />
            <button type="submit" className="sr-only">
              Guardar
            </button>
          </form>
        </Registro>
      )}
      {codigo && (
        <Modal title={`Vincular «${codigo.nombre}»`} onClose={() => setCodigo(null)}>
          <div className="space-y-4 text-center">
            {codigo.tipo === "kiosco" ? (
              <ol className="mx-auto max-w-md list-decimal space-y-1 pl-5 text-left text-sm text-slate-600">
                <li>
                  En la tablet, abre <strong className="font-mono text-tinta-900">{location.origin}/kiosco</strong>
                </li>
                <li>Escribe este código:</li>
              </ol>
            ) : (
              <p className="text-sm text-slate-600">Usa este código al configurar el puente del reloj biométrico.</p>
            )}
            <p className="font-mono text-5xl font-bold tracking-[0.3em] text-brand-600">{codigo.codigo_vinculacion}</p>
            {codigo.codigo_expira && <p className="text-xs text-slate-500">Vence a las {new Date(codigo.codigo_expira).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })} (15 minutos).</p>}
            <button className="btn-primary" onClick={() => setCodigo(null)}>
              Listo
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
