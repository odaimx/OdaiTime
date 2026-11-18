import { useCallback, useEffect, useState } from "react";
import Icono from "../components/Iconos";
import { ArticuloLFT } from "../components/LFT";
import Registro from "../components/Registro";
import Vista, { useVista, type ConfigVista } from "../components/Vista";
import { ErrorBox, PageHeader, useEmpresaScope } from "../components/ui";
import { api, descargar, get, type ConceptoNomina, type FilaResumen, type Sucursal } from "../lib/api";
import { useAuth } from "../lib/auth";
import { periodo } from "../lib/periodo";

interface Sistema {
  clave: string;
  nombre: string;
  formato: "xlsx" | "csv";
  descripcion: string;
  marcador: string;
}

const SISTEMAS: Sistema[] = [
  {
    clave: "contpaqi",
    nombre: "CONTPAQi Nóminas",
    formato: "xlsx",
    descripcion: "Excel de movimientos: código de empleado, concepto, valor (horas o días) y fecha.",
    marcador: "Clave del concepto",
  },
  {
    clave: "noi",
    nombre: "Aspel NOI",
    formato: "xlsx",
    descripcion: "Excel de movimientos: clave del trabajador, clave de percepción/deducción, unidades y fecha. El importe lo calcula NOI.",
    marcador: "Clave de percepción o deducción",
  },
  {
    clave: "odoo",
    nombre: "Odoo",
    formato: "csv",
    descripcion: "CSV de entradas de trabajo (hr.work.entry) día por día.",
    marcador: "Nombre del tipo de entrada",
  },
  {
    clave: "generico",
    nombre: "Genérico (Excel)",
    formato: "xlsx",
    descripcion: "Prenómina con una columna por concepto y la lista de movimientos, para cualquier otro sistema.",
    marcador: "Clave (opcional)",
  },
];

const UNIDADES: Record<string, string> = { horas: "horas", dias: "días", eventos: "eventos" };
const ARTICULO: Record<string, string> = { HE2: "66", HE3: "68", PDOM: "71", DLAB: "73", FLAB: "75" };
const PRESETS: [string, string][] = [
  ["semana", "Esta semana"],
  ["semana_pasada", "Semana pasada"],
  ["quincena", "Quincena"],
  ["mes", "Este mes"],
];

/** Exportaciones a sistemas de nómina: cada sistema abre su propia vista. */
export default function Exportaciones() {
  const { usuario } = useAuth();
  const puedeEditar = usuario?.rol === "superadmin" || usuario?.rol === "admin_empresa";
  const { query, listo, selector } = useEmpresaScope();
  const sep = query ? "&" : "?";
  const [claves, setClaves] = useState<Record<string, ConceptoNomina[]>>({});
  const [abierto, setAbierto] = useState<Sistema | null>(null);

  const cargarClaves = useCallback(() => {
    if (!listo) return;
    Promise.all(SISTEMAS.map((s) => get<ConceptoNomina[]>(`/reportes/claves${query}${sep}sistema=${s.clave}`).then((l) => [s.clave, l] as const))).then((pares) =>
      setClaves(Object.fromEntries(pares)),
    );
  }, [listo, query, sep]);
  useEffect(cargarClaves, [cargarClaves]);

  const configuradas = (s: Sistema) => (claves[s.clave] ?? []).filter((c) => c.codigo).length;
  const total = (s: Sistema) => (claves[s.clave] ?? []).length;

  const config: ConfigVista<Sistema> = {
    id: "exportaciones",
    tituloReporte: "Exportaciones a nómina",
    clave: (s) => s.clave,
    onAbrir: setAbierto,
    modoInicial: "kanban",
    fuentes: "arts. 66, 68, 71, 73 y 75",
    columnas: [
      { clave: "nombre", titulo: "Sistema de nómina", fija: true, buscable: true, valor: (s) => s.nombre, className: "font-medium text-navy-900" },
      { clave: "formato", titulo: "Archivo", agrupable: true, valor: (s) => s.formato.toUpperCase() },
      { clave: "descripcion", titulo: "Contenido", valor: (s) => s.descripcion, className: "text-slate-600" },
      {
        clave: "claves",
        titulo: "Claves configuradas",
        alinear: "derecha",
        valor: (s) => configuradas(s),
        render: (s) => (
          <span className={configuradas(s) === total(s) || s.clave === "generico" ? "text-emerald-700" : "text-amber-700"}>
            {configuradas(s)} / {total(s)}
          </span>
        ),
      },
    ],
    filtros: [{ clave: "incompletos", titulo: "Con claves pendientes", prueba: (s) => s.clave !== "generico" && configuradas(s) < total(s) }],
    kanban: (s) => (
      <div className="flex gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-navy-950 text-oro-400">
          <Icono nombre={s.formato === "csv" ? "file-text" : "sheet"} className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-navy-900">{s.nombre}</p>
          <p className="line-clamp-2 text-xs text-slate-500">{s.descripcion}</p>
          <p className="mt-1 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{s.formato.toUpperCase()}</span>
            {s.clave !== "generico" && (
              <span className={`ml-2 font-medium ${configuradas(s) === total(s) ? "text-emerald-700" : "text-amber-700"}`}>
                Claves {configuradas(s)}/{total(s)}
              </span>
            )}
          </p>
        </div>
      </div>
    ),
  };
  const vista = useVista(config, SISTEMAS);
  const enOrden = vista.ordenados;

  return (
    <>
      <PageHeader icono="file-chart-column" title="Exportaciones" submenu={[{ etiqueta: "Nómina", activo: true }]} action={selector} />
      {listo && <Vista vista={vista} />}
      {abierto && (
        <ExportarSistema
          key={abierto.clave}
          sistema={abierto}
          query={query}
          puedeEditar={puedeEditar}
          indice={enOrden.findIndex((s) => s.clave === abierto.clave)}
          total={enOrden.length}
          onIr={(i) => setAbierto(enOrden[i])}
          onCerrar={() => setAbierto(null)}
          onClaves={cargarClaves}
        />
      )}
    </>
  );
}

/** Vista propia de cada sistema: periodo, vista previa de la prenómina, archivo y claves. */
function ExportarSistema({
  sistema,
  query,
  puedeEditar,
  indice,
  total,
  onIr,
  onCerrar,
  onClaves,
}: {
  sistema: Sistema;
  query: string;
  puedeEditar: boolean;
  indice: number;
  total: number;
  onIr: (i: number) => void;
  onCerrar: () => void;
  onClaves: () => void;
}) {
  const sep = query ? "&" : "?";
  const [preset, setPreset] = useState("quincena");
  const [rango, setRango] = useState(periodo("quincena"));
  const [sucursal, setSucursal] = useState("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [conceptos, setConceptos] = useState<ConceptoNomina[]>([]);
  const [codigos, setCodigos] = useState<Record<string, string>>({});
  const [filas, setFilas] = useState<FilaResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);

  useEffect(() => {
    get<Sucursal[]>(`/sucursales${query}`).then(setSucursales);
    get<ConceptoNomina[]>(`/reportes/claves${query}${sep}sistema=${sistema.clave}`).then((l) => {
      setConceptos(l);
      setCodigos(Object.fromEntries(l.map((c) => [c.clave, c.codigo ?? ""])));
    });
  }, [query, sep, sistema.clave]);

  useEffect(() => {
    setFilas(null);
    const p = new URLSearchParams(rango);
    if (sucursal) p.set("sucursal_id", sucursal);
    get<FilaResumen[]>(`/asistencia/resumen${query}${sep}${p}`)
      .then(setFilas)
      .catch((e) => setError(e.message));
  }, [rango, sucursal, query, sep]);

  const sucio = conceptos.some((c) => (c.codigo ?? "") !== (codigos[c.clave] ?? ""));
  const codigo = (k: string) => codigos[k] || k;

  async function guardar(): Promise<boolean> {
    setError(null);
    try {
      const l = await api<ConceptoNomina[]>(`/reportes/claves${query}${sep}sistema=${sistema.clave}`, { method: "PUT", body: JSON.stringify({ claves: codigos }) });
      setConceptos(l);
      onClaves();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function bajar() {
    setError(null);
    setBajando(true);
    const p = new URLSearchParams({ ...rango, sistema: sistema.clave });
    if (sucursal) p.set("sucursal_id", sucursal);
    try {
      await descargar(`/reportes/nomina${query}${sep}${p}`, `nomina_${sistema.clave}_${rango.desde.replace(/-/g, "")}_${rango.hasta.replace(/-/g, "")}.${sistema.formato}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBajando(false);
    }
  }

  // Columnas de la vista previa: solo los conceptos que tienen movimientos en el periodo.
  const usados = conceptos.filter((c) => filas?.some((f) => f.conceptos?.some((x) => x.clave === c.clave && x.cantidad)));
  const sinClave = conceptos.filter((c) => !c.codigo).length;

  return (
    <Registro
      titulo={`Exportar a ${sistema.nombre}`}
      indice={indice >= 0 ? indice : undefined}
      total={total}
      onIr={onIr}
      sucio={puedeEditar && sucio}
      onGuardar={puedeEditar ? guardar : undefined}
      onDescartar={() => setCodigos(Object.fromEntries(conceptos.map((c) => [c.clave, c.codigo ?? ""])))}
      onCerrar={onCerrar}
    >
      <div className="space-y-6">
        <p className="text-sm text-slate-600">{sistema.descripcion}</p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {PRESETS.map(([k, l]) => (
              <button
                key={k}
                onClick={() => {
                  setPreset(k);
                  setRango(periodo(k));
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${preset === k ? "bg-white text-navy-900 shadow-sm" : "text-slate-600 hover:text-navy-900"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <label className="text-xs font-medium text-slate-500">
            Desde
            <input type="date" className="input mt-1 w-40" value={rango.desde} onChange={(e) => (setPreset(""), setRango({ ...rango, desde: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Hasta
            <input type="date" className="input mt-1 w-40" value={rango.hasta} onChange={(e) => (setPreset(""), setRango({ ...rango, hasta: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Sucursal
            <select className="input mt-1 w-56" value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
              <option value="">Todas</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.clave} — {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary ml-auto" disabled={bajando || sucio} title={sucio ? "Guarda las claves antes de exportar" : undefined} onClick={bajar}>
            <Icono nombre="download" /> {bajando ? "Generando…" : `Descargar ${sistema.formato.toUpperCase()}`}
          </button>
        </div>

        {sistema.clave !== "generico" && sinClave > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {sinClave} concepto(s) sin clave de {sistema.nombre}. Se exportan con la clave de ODAITIME; configúralas abajo.
          </p>
        )}
        <ErrorBox message={error} />

        <section>
          <h3 className="mb-2 text-sm font-semibold text-navy-900">Vista previa de la prenómina</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left font-medium text-navy-900">
                <tr>
                  <th className="px-3 py-2">Empleado</th>
                  {usados.map((c) => (
                    <th key={c.clave} className="whitespace-nowrap px-3 py-2 text-right" title={c.descripcion}>
                      <span className="font-mono">{codigo(c.clave)}</span>
                      <span className="block text-[11px] font-normal text-slate-500">{UNIDADES[c.unidad] ?? c.unidad}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas === null && (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={usados.length + 1}>
                      Calculando…
                    </td>
                  </tr>
                )}
                {filas?.map((f) => {
                  const v = Object.fromEntries((f.conceptos ?? []).map((x) => [x.clave, x.cantidad]));
                  return (
                    <tr key={f.empleado.id}>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className="font-mono text-xs text-slate-500">#{f.empleado.numero}</span> <span className="text-navy-900">{f.empleado.nombre_completo}</span>
                      </td>
                      {usados.map((c) => (
                        <td key={c.clave} className={`px-3 py-2 text-right tabular-nums ${v[c.clave] ? "text-navy-900" : "text-slate-300"}`}>
                          {v[c.clave] ?? 0}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {filas?.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={usados.length + 1}>
                      No hay empleados en ese periodo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-slate-500">ODAITIME envía cantidades; el importe lo calcula tu sistema de nómina con el salario de cada trabajador.</p>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-navy-900">Claves de nómina en {sistema.nombre}</h3>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
            {conceptos.map((c) => (
              <label key={c.clave} className="flex items-center gap-3">
                <span className="w-12 shrink-0 font-mono text-xs font-semibold text-brand-600">{c.clave}</span>
                <span className="min-w-0 flex-1 text-sm text-navy-900">
                  {c.descripcion.replace(/ \(art\. \d+\)/, "")}
                  {ARTICULO[c.clave] && (
                    <span className="ml-1 text-xs text-slate-500">
                      (<ArticuloLFT art={ARTICULO[c.clave]} />)
                    </span>
                  )}
                  <span className="block text-xs text-slate-500">{UNIDADES[c.unidad] ?? c.unidad}</span>
                </span>
                <input
                  className="input w-40 font-mono"
                  placeholder={sistema.marcador}
                  disabled={!puedeEditar}
                  value={codigos[c.clave] ?? ""}
                  onChange={(e) => setCodigos({ ...codigos, [c.clave]: e.target.value })}
                />
              </label>
            ))}
          </div>
        </section>
      </div>
    </Registro>
  );
}
