import { useCallback, useEffect, useState } from "react";
import Icono from "../components/Iconos";
import FiltrosExportacion, { filtrosIniciales, hayFiltros, paramsDe, type Filtros } from "../components/FiltrosExportacion";
import { ArticuloLFT } from "../components/LFT";
import Registro from "../components/Registro";
import Vista, { useVista, type ConfigVista } from "../components/Vista";
import { Ayuda, ErrorBox, PageHeader, useEmpresaScope } from "../components/ui";
import { api, descargar, get, type ConceptoNomina, type FilaResumen } from "../lib/api";
import { useAuth } from "../lib/auth";

interface Sistema {
  clave: string;
  nombre: string;
  formato: "xlsx" | "csv" | "txt";
  descripcion: string;
  marcador: string;
}

const SISTEMAS: Sistema[] = [
  {
    clave: "contpaqi",
    nombre: "CONTPAQi Nóminas",
    formato: "xlsx",
    descripcion: "Layout de intercambio ODAI Time: una fila por empleado, fecha e incidencia (CodigoEmpleado, Fecha, Abreviatura, Unidades, Observaciones, TipoPeriodo, Ejercicio y NumeroPeriodo). En Excel, CSV o TXT tabulado.",
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
    formato: "xlsx",
    descripcion: "Plantilla definitiva de incidencias para Odoo 19/20: una fila por incidencia con fechas, horas, cantidad y códigos de integración (sin importes; Odoo calcula la nómina). Las ausencias de días seguidos van en un solo rango. En Excel o CSV.",
    marcador: "Código de integración",
  },
  {
    clave: "generico",
    nombre: "Genérico (Excel)",
    formato: "xlsx",
    descripcion: "Prenómina con una columna por concepto y la lista de movimientos, para cualquier otro sistema.",
    marcador: "Clave (opcional)",
  },
];

const TIPOS_PERIODO = ["Semanal", "Quincenal", "Catorcenal", "Mensual"];
const FORMATOS: [Sistema["formato"], string][] = [
  ["xlsx", "Excel"],
  ["csv", "CSV"],
  ["txt", "TXT tabulado"],
];

/** Número de periodo sugerido (solo cuando no depende del calendario de la empresa). */
function sugerirPeriodo(tipo: string, desde: string): string {
  const [, m, d] = desde.split("-").map(Number);
  if (tipo === "Quincenal") return String((m - 1) * 2 + (d <= 15 ? 1 : 2));
  if (tipo === "Mensual") return String(m);
  return "";
}

const UNIDADES: Record<string, string> = { horas: "horas", dias: "días", eventos: "eventos" };
const ARTICULO: Record<string, string> = { HE2: "66", HE3: "68", PDOM: "71", DLAB: "73", FLAB: "75" };

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
      { clave: "nombre", titulo: "Sistema de nómina", fija: true, buscable: true, valor: (s) => s.nombre, className: "font-medium text-tinta-900" },
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
          <p className="font-semibold text-tinta-900">{s.nombre}</p>
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
  const [filtros, setFiltros] = useState<Filtros>(filtrosIniciales);
  const rango = { desde: filtros.desde, hasta: filtros.hasta };
  const [conceptos, setConceptos] = useState<ConceptoNomina[]>([]);
  const [codigos, setCodigos] = useState<Record<string, string>>({});
  const [filas, setFilas] = useState<FilaResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const esContpaqi = sistema.clave === "contpaqi";
  const esOdoo = sistema.clave === "odoo";
  const [checadas, setChecadas] = useState(false);
  const [formato, setFormato] = useState<Sistema["formato"]>(sistema.formato);
  const [tipoPeriodo, setTipoPeriodo] = useState("Quincenal");
  const [ejercicio, setEjercicio] = useState(rango.hasta.slice(0, 4));
  const [numPeriodo, setNumPeriodo] = useState(sugerirPeriodo("Quincenal", rango.desde));

  // Al cambiar las fechas o el tipo, se vuelve a sugerir ejercicio y número de periodo.
  useEffect(() => {
    setEjercicio(rango.hasta.slice(0, 4));
    setNumPeriodo(sugerirPeriodo(tipoPeriodo, rango.desde));
  }, [rango.desde, rango.hasta, tipoPeriodo]);

  useEffect(() => {
    get<ConceptoNomina[]>(`/reportes/claves${query}${sep}sistema=${sistema.clave}`).then((l) => {
      setConceptos(l);
      setCodigos(Object.fromEntries(l.map((c) => [c.clave, c.codigo ?? ""])));
    });
  }, [query, sep, sistema.clave]);

  const clave = paramsDe(filtros).toString();
  useEffect(() => {
    setFilas(null);
    setError(null);
    get<FilaResumen[]>(`/asistencia/resumen${query}${sep}${clave}`)
      .then(setFilas)
      .catch((e) => setError(e.message));
  }, [clave, query, sep]);

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
    const p = paramsDe(filtros, { sistema: sistema.clave });
    if (esContpaqi) {
      p.set("formato", formato);
      p.set("tipo_periodo", tipoPeriodo);
      if (ejercicio) p.set("ejercicio", ejercicio);
      if (numPeriodo) p.set("numero_periodo", numPeriodo);
    }
    if (esOdoo) {
      p.set("formato", formato);
      if (checadas) p.set("checadas", "true");
    }
    const ext = esContpaqi || esOdoo ? formato : sistema.formato;
    try {
      const h = await descargar(`/reportes/nomina${query}${sep}${p}`, `nomina_${sistema.clave}_${rango.desde.replace(/-/g, "")}_${rango.hasta.replace(/-/g, "")}.${ext}`);
      const movimientos = Number(h.get("X-Odai-Movimientos") ?? "-1");
      const empleados = Number(h.get("X-Odai-Empleados") ?? "-1");
      setAviso(
        movimientos === 0
          ? empleados === 0
            ? "El archivo salió vacío: ningún empleado cumple el periodo y los filtros."
            : "El archivo salió sin movimientos: en el periodo no hay faltas, horas extra, retardos ni incidencias. Revisa que los empleados tengan turno asignado (en la Tarjeta de asistencia aparecen como “Sin turno”) y que haya checadas."
          : null,
      );
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

        <FiltrosExportacion query={query} valor={filtros} onCambio={setFiltros} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {filas && (
            <span className="text-sm text-slate-500">
              {filas.length} empleado(s){hayFiltros(filtros) ? " con los filtros" : ""}
            </span>
          )}
          <button className="btn-primary" disabled={bajando || sucio || filas?.length === 0} title={sucio ? "Guarda las claves antes de exportar" : undefined} onClick={bajar}>
            <Icono nombre="download" /> {bajando ? "Generando…" : `Descargar ${(esContpaqi || esOdoo ? formato : sistema.formato).toUpperCase()}`}
          </button>
        </div>

        {esOdoo && (
          <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <label className="text-xs font-medium text-slate-500">
              Formato
              <select className="input mt-1 w-40" value={formato} onChange={(e) => setFormato(e.target.value as Sistema["formato"])}>
                {FORMATOS.filter(([k]) => k !== "txt").map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={checadas} onChange={(e) => setChecadas(e.target.checked)} />
              Incluir entradas y salidas
              <Ayuda texto="Agrega una fila por cada checada (CHECK_IN / CHECK_OUT) para hr.attendance." />
            </label>
          </div>
        )}

        {esContpaqi && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <label className="text-xs font-medium text-slate-500">
              Tipo de periodo
              <select
                className="input mt-1 w-40"
                value={tipoPeriodo}
                onChange={(e) => setTipoPeriodo(e.target.value)}
              >
                {TIPOS_PERIODO.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">
              Ejercicio
              <input type="number" min={2000} max={2100} className="input mt-1 w-28" value={ejercicio} onChange={(e) => setEjercicio(e.target.value)} />
            </label>
            <label className="text-xs font-medium text-slate-500">
              <span className="inline-flex items-center">
                Número de periodo
                <Ayuda texto="El número de periodo de nómina en CONTPAQi. Para quincenal y mensual se sugiere según la fecha; en semanal y catorcenal depende del calendario de la empresa." />
              </span>
              <input type="number" min={1} max={999} className="input mt-1 w-28" value={numPeriodo} onChange={(e) => setNumPeriodo(e.target.value)} />
            </label>
            <label className="text-xs font-medium text-slate-500">
              Formato
              <select className="input mt-1 w-40" value={formato} onChange={(e) => setFormato(e.target.value as Sistema["formato"])}>
                {FORMATOS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {sistema.clave !== "generico" && sinClave > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {sinClave} concepto(s) sin clave de {sistema.nombre}. Se exportan con la clave de ODAITIME; configúralas abajo.
          </p>
        )}
        <ErrorBox message={error} />
        {aviso && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">{aviso}</p>}

        <section>
          <h3 className="mb-2 text-sm font-semibold text-tinta-900">Vista previa de la prenómina</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left font-medium text-tinta-900">
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
                        <span className="font-mono text-xs text-slate-500">#{f.empleado.numero}</span> <span className="text-tinta-900">{f.empleado.nombre_completo}</span>
                      </td>
                      {usados.map((c) => (
                        <td key={c.clave} className={`px-3 py-2 text-right tabular-nums ${v[c.clave] ? "text-tinta-900" : "text-slate-300"}`}>
                          {v[c.clave] ?? 0}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {filas?.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={usados.length + 1}>
                      Ningún empleado cumple el periodo y los filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-slate-500">ODAITIME envía cantidades; el importe lo calcula tu sistema de nómina con el salario de cada trabajador.</p>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-tinta-900">Claves de nómina en {sistema.nombre}</h3>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
            {conceptos.map((c) => (
              <label key={c.clave} className="flex items-center gap-3">
                <span className="w-12 shrink-0 font-mono text-xs font-semibold text-brand-600">{c.clave}</span>
                <span className="min-w-0 flex-1 text-sm text-tinta-900">
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
