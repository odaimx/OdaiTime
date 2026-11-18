import { useEffect, useState } from "react";
import { ArticuloLFT } from "../components/LFT";
import { ErrorBox, PageHeader, useEmpresaScope } from "../components/ui";
import { api, descargar, get, type ConceptoNomina, type Sucursal } from "../lib/api";
import { useAuth } from "../lib/auth";
import { periodo } from "../lib/periodo";

const SISTEMAS: { clave: string; nombre: string; formato: string; ayuda: string }[] = [
  {
    clave: "contpaqi",
    nombre: "CONTPAQi Nóminas",
    formato: "xlsx",
    ayuda: "Excel de movimientos: código de empleado, concepto, valor (horas o días) y fecha, para importar desde Excel en CONTPAQi Nóminas.",
  },
  {
    clave: "noi",
    nombre: "Aspel NOI",
    formato: "xlsx",
    ayuda: "Excel de movimientos: clave del trabajador, clave de percepción/deducción, unidades y fecha. El importe lo calcula NOI.",
  },
  {
    clave: "odoo",
    nombre: "Odoo",
    formato: "csv",
    ayuda: "CSV de entradas de trabajo (hr.work.entry) día por día. La clave debe ser el nombre del tipo de entrada de trabajo en Odoo.",
  },
  {
    clave: "generico",
    nombre: "Genérico (Excel)",
    formato: "xlsx",
    ayuda: "Prenómina con una columna por concepto y la lista de movimientos, para cualquier otro sistema o para revisión.",
  },
];

const UNIDADES: Record<string, string> = { horas: "horas", dias: "días", eventos: "eventos" };
const ARTICULO: Record<string, string> = { HE2: "66", HE3: "68", PDOM: "71", DLAB: "73", FLAB: "75" };

export default function Reportes() {
  const { usuario } = useAuth();
  const puedeEditar = usuario?.rol === "superadmin" || usuario?.rol === "admin_empresa";
  const { query, listo, selector } = useEmpresaScope();
  const sep = query ? "&" : "?";
  const [preset, setPreset] = useState("quincena");
  const [rango, setRango] = useState(periodo("quincena"));
  const [sucursal, setSucursal] = useState("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sistema, setSistema] = useState("contpaqi");
  const [conceptos, setConceptos] = useState<ConceptoNomina[]>([]);
  const [codigos, setCodigos] = useState<Record<string, string>>({});
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);

  useEffect(() => {
    if (listo) get<Sucursal[]>(`/sucursales${query}`).then(setSucursales);
  }, [listo, query]);

  useEffect(() => {
    if (!listo) return;
    setGuardado(false);
    get<ConceptoNomina[]>(`/reportes/claves${query}${sep}sistema=${sistema}`).then((l) => {
      setConceptos(l);
      setCodigos(Object.fromEntries(l.map((c) => [c.clave, c.codigo ?? ""])));
    });
  }, [listo, query, sep, sistema]);

  const params = () => {
    const p = new URLSearchParams(rango);
    if (sucursal) p.set("sucursal_id", sucursal);
    return p;
  };
  const sufijo = `${rango.desde.replace(/-/g, "")}_${rango.hasta.replace(/-/g, "")}`;

  async function bajar(clave: string, ruta: string, nombre: string) {
    setError(null);
    setDescargando(clave);
    try {
      await descargar(`${ruta}${ruta.includes("?") ? "&" : "?"}${params()}${query ? `&${query.slice(1)}` : ""}`, nombre);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDescargando(null);
    }
  }

  async function guardarClaves() {
    setError(null);
    try {
      const l = await api<ConceptoNomina[]>(`/reportes/claves${query}${sep}sistema=${sistema}`, { method: "PUT", body: JSON.stringify({ claves: codigos }) });
      setConceptos(l);
      setGuardado(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const actual = SISTEMAS.find((s) => s.clave === sistema)!;
  const sinClave = conceptos.filter((c) => !c.codigo).length;
  const sucio = conceptos.some((c) => (c.codigo ?? "") !== (codigos[c.clave] ?? ""));

  const claves = (
      <section className="-mx-1 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
              {SISTEMAS.map((x) => (
                <button key={x.clave} onClick={() => setSistema(x.clave)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${sistema === x.clave ? "bg-white text-navy-900 shadow-sm" : "text-slate-600 hover:text-navy-900"}`}>
                  {x.nombre}
                </button>
              ))}
            </div>
            <h2 className="font-semibold text-navy-900">Claves de nómina · {actual.nombre}</h2>
            <p className="text-sm text-slate-500">Relaciona cada concepto de ODAITIME con la clave que usa tu sistema de nómina.</p>
          </div>
          {puedeEditar && (
            <div className="flex items-center gap-3">
              {guardado && !sucio && <span className="text-sm text-emerald-600">Guardado</span>}
              <button className="btn-primary" disabled={!sucio} onClick={guardarClaves}>
                Guardar claves
              </button>
            </div>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-6 py-3">Concepto ODAITIME</th>
              <th className="px-3 py-3">Descripción</th>
              <th className="px-3 py-3">Unidad</th>
              <th className="px-6 py-3">Clave en {actual.nombre}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {conceptos.map((c) => (
              <tr key={c.clave}>
                <td className="px-6 py-2 font-mono text-xs font-semibold text-brand-600">{c.clave}</td>
                <td className="px-3 py-2 text-navy-900">
                  {c.descripcion.replace(/ \(art\. \d+\)/, "")}
                  {ARTICULO[c.clave] && (
                    <span className="ml-1 text-xs text-slate-500">
                      (<ArticuloLFT art={ARTICULO[c.clave]} />)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">{UNIDADES[c.unidad] ?? c.unidad}</td>
                <td className="px-6 py-2">
                  <input
                    className="input w-full max-w-xs font-mono"
                    placeholder={sistema === "odoo" ? "Nombre del tipo de entrada" : "Clave"}
                    disabled={!puedeEditar}
                    value={codigos[c.clave] ?? ""}
                    onChange={(e) => setCodigos({ ...codigos, [c.clave]: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
  );

  return (
    <>
      <PageHeader icono="file-chart-column" ajustes={{ titulo: "Claves de nómina", ancho: "xl", contenido: claves }} fuentes="arts. 66, 68, 71, 73 y 75" title="Reportes y nómina" subtitle="Descarga los reportes del periodo y el archivo de incidencias para tu sistema de nómina" action={selector} />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {[
            ["semana", "Esta semana"],
            ["semana_pasada", "Semana pasada"],
            ["quincena", "Quincena"],
            ["mes", "Mes"],
          ].map(([k, l]) => (
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
      </div>

      <ErrorBox message={error} />

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <section className="card space-y-4 p-6">
          <h2 className="font-semibold text-navy-900">Reportes de asistencia</h2>
          <BotonReporte
            titulo="Resumen del periodo"
            texto="Una fila por empleado: asistencias, faltas, retardos, horas extra dobles y triples, domingos, descansos y festivos trabajados, vacaciones e incapacidades."
            cargando={descargando === "resumen"}
            onClick={() => bajar("resumen", "/reportes/asistencia.xlsx", `asistencia_${sufijo}.xlsx`)}
          />
          <BotonReporte
            titulo="Detalle diario"
            texto="Cada día de cada empleado: estado, horas de entrada y salida, horas trabajadas, retardo, horas extra y observaciones."
            cargando={descargando === "detalle"}
            onClick={() => bajar("detalle", "/reportes/detalle.xlsx", `detalle_diario_${sufijo}.xlsx`)}
          />
          <p className="text-xs text-slate-500">
            Los cálculos siguen la LFT: horas extra (<ArticuloLFT art="66" />, <ArticuloLFT art="68" />), prima dominical (<ArticuloLFT art="71" />), descanso y festivo trabajados (
            <ArticuloLFT art="73" />, <ArticuloLFT art="75" />).
          </p>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="font-semibold text-navy-900">Exportar a nómina</h2>
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {SISTEMAS.map((s) => (
              <button
                key={s.clave}
                onClick={() => setSistema(s.clave)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${sistema === s.clave ? "bg-white text-navy-900 shadow-sm" : "text-slate-600 hover:text-navy-900"}`}
              >
                {s.nombre}
              </button>
            ))}
          </div>
          <p className="text-sm text-slate-600">{actual.ayuda}</p>
          {sistema !== "generico" && sinClave > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {sinClave} concepto(s) sin clave de {actual.nombre}. Se exportan con la clave de ODAITIME; configúralas en el engrane ⚙ junto al título.
            </p>
          )}
          <button
            className="btn-primary w-full sm:w-auto"
            disabled={descargando === "nomina" || sucio}
            title={sucio ? "Guarda las claves antes de exportar" : undefined}
            onClick={() => bajar("nomina", `/reportes/nomina?sistema=${sistema}`, `nomina_${sistema}_${sufijo}.${actual.formato}`)}
          >
            {descargando === "nomina" ? "Generando…" : `Descargar archivo para ${actual.nombre}`}
          </button>
          <p className="text-xs text-slate-500">ODAITIME envía cantidades (horas, días o eventos). El importe lo calcula tu sistema de nómina con el salario de cada trabajador.</p>
        </section>
      </div>

    </>
  );
}

function BotonReporte({ titulo, texto, cargando, onClick }: { titulo: string; texto: string; cargando: boolean; onClick: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium text-navy-900">{titulo}</p>
        <p className="text-sm text-slate-500">{texto}</p>
      </div>
      <button className="btn-secondary shrink-0" disabled={cargando} onClick={onClick}>
        {cargando ? "Generando…" : "Excel"}
      </button>
    </div>
  );
}
