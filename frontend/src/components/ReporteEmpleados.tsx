import { useMemo, useState } from "react";
import type { Categoria, Empleado } from "../lib/api";
import { fechaCorta } from "../lib/api";
import { imprimirTabla } from "../lib/imprimir";
import Icono from "./Iconos";
import { Modal } from "./ui";

type Col = { clave: string; titulo: string; valor: (e: Empleado) => string; defecto?: boolean };

/** Reporte de empleados para imprimir, con sus propios filtros y columnas. */
export default function ReporteEmpleados({ empleados, categorias, catsDe, onCerrar }: { empleados: Empleado[]; categorias: Categoria[]; catsDe: (id: string) => Categoria[]; onCerrar: () => void }) {
  const columnas: Col[] = [
    { clave: "numero", titulo: "Número", valor: (e) => e.numero, defecto: true },
    { clave: "nombre", titulo: "Nombre", valor: (e) => e.nombre_completo, defecto: true },
    { clave: "sucursal", titulo: "Sucursal", valor: (e) => e.sucursal.nombre, defecto: true },
    { clave: "puesto", titulo: "Puesto", valor: (e) => e.puesto ?? "", defecto: true },
    { clave: "departamento", titulo: "Departamento", valor: (e) => e.departamento ?? "", defecto: true },
    { clave: "turno", titulo: "Turno", valor: (e) => e.turno_actual?.nombre ?? "Sin turno", defecto: true },
    { clave: "ingreso", titulo: "Fecha de ingreso", valor: (e) => fechaCorta(e.fecha_ingreso), defecto: true },
    { clave: "categorias", titulo: "Categorías", valor: (e) => catsDe(e.id).map((c) => c.nombre).join(", ") },
    { clave: "telefono", titulo: "Teléfono", valor: (e) => e.telefono ?? "" },
    { clave: "email", titulo: "Correo", valor: (e) => e.email ?? "" },
    { clave: "curp", titulo: "CURP", valor: (e) => e.curp ?? "" },
    { clave: "rfc", titulo: "RFC", valor: (e) => e.rfc ?? "" },
    { clave: "nss", titulo: "NSS", valor: (e) => e.nss ?? "" },
    { clave: "salario", titulo: "Salario diario", valor: (e) => (e.salario_diario ? Number(e.salario_diario).toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : "") },
    { clave: "accesos", titulo: "Accesos", valor: (e) => [e.tiene_pin && "PIN", e.portal && "Portal"].filter(Boolean).join(", ") },
    { clave: "estado", titulo: "Estado", valor: (e) => (e.activo ? "Activo" : `Baja ${fechaCorta(e.fecha_baja)}`) },
  ];
  const unicos = (f: (e: Empleado) => string | null | undefined) => [...new Set(empleados.map(f).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "es"));
  const opciones = useMemo(
    () => ({
      sucursales: unicos((e) => e.sucursal.nombre),
      puestos: unicos((e) => e.puesto),
      departamentos: unicos((e) => e.departamento),
      turnos: unicos((e) => e.turno_actual?.nombre),
    }),
    [empleados], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [f, setF] = useState({ estado: "activos", sucursal: "", puesto: "", departamento: "", turno: "", categoria: "", orden: "nombre", agrupar: "" });
  const [cols, setCols] = useState<string[]>(columnas.filter((c) => c.defecto).map((c) => c.clave));

  const filtrados = empleados
    .filter((e) => (f.estado === "activos" ? e.activo : f.estado === "bajas" ? !e.activo : true))
    .filter((e) => !f.sucursal || e.sucursal.nombre === f.sucursal)
    .filter((e) => !f.puesto || e.puesto === f.puesto)
    .filter((e) => !f.departamento || e.departamento === f.departamento)
    .filter((e) => !f.turno || (e.turno_actual?.nombre ?? "") === f.turno)
    .filter((e) => !f.categoria || catsDe(e.id).some((c) => c.id === f.categoria))
    .sort((a, b) => {
      const k = (e: Empleado) => (f.orden === "numero" ? e.numero : f.orden === "sucursal" ? `${e.sucursal.nombre} ${e.nombre_completo}` : f.orden === "ingreso" ? e.fecha_ingreso : e.nombre_completo);
      return k(a).localeCompare(k(b), "es", { numeric: true });
    });

  function generar() {
    const usadas = columnas.filter((c) => cols.includes(c.clave));
    const desc = [
      f.estado === "activos" ? "Activos" : f.estado === "bajas" ? "Bajas" : "Activos y bajas",
      f.sucursal && `Sucursal: ${f.sucursal}`,
      f.puesto && `Puesto: ${f.puesto}`,
      f.departamento && `Departamento: ${f.departamento}`,
      f.turno && `Turno: ${f.turno}`,
      f.categoria && `Categoría: ${categorias.find((c) => c.id === f.categoria)?.nombre}`,
    ].filter(Boolean) as string[];
    imprimirTabla(
      "Reporte de empleados",
      usadas.map((c) => c.titulo),
      filtrados.map((e) => usadas.map((c) => c.valor(e))),
      desc,
    );
  }

  const select = (k: keyof typeof f, label: string, lista: [string, string][], todos = "Todos") => (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        {todos && <option value="">{todos}</option>}
        {lista.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
  const par = (l: string[]) => l.map((v) => [v, v] as [string, string]);

  return (
    <Modal title="Reporte PDF de empleados" onClose={onCerrar} ancho="xl">
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
          {select(
            "estado",
            "Estado",
            [
              ["activos", "Activos"],
              ["bajas", "Bajas"],
              ["todos", "Activos y bajas"],
            ],
            "",
          )}
          {select("sucursal", "Sucursal", par(opciones.sucursales), "Todas")}
          {select("turno", "Turno", par(opciones.turnos))}
          {select("puesto", "Puesto", par(opciones.puestos))}
          {select("departamento", "Departamento", par(opciones.departamentos))}
          {select(
            "categoria",
            "Categoría",
            categorias.map((c) => [c.id, c.nombre] as [string, string]),
            "Todas",
          )}
          {select(
            "orden",
            "Ordenar por",
            [
              ["nombre", "Nombre"],
              ["numero", "Número"],
              ["sucursal", "Sucursal"],
              ["ingreso", "Fecha de ingreso"],
            ],
            "",
          )}
        </div>
        <div>
          <p className="label">Columnas</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            {columnas.map((c) => (
              <label key={c.clave} className="flex items-center gap-2 text-sm text-tinta-900">
                <input type="checkbox" className="accent-brand-500" checked={cols.includes(c.clave)} onChange={() => setCols((l) => (l.includes(c.clave) ? l.filter((x) => x !== c.clave) : [...l, c.clave]))} />
                {c.titulo}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <span className="text-sm text-slate-600">{filtrados.length} empleado(s) en el reporte</span>
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={onCerrar}>
              Cancelar
            </button>
            <button className="btn-primary" disabled={!filtrados.length || !cols.length} onClick={generar}>
              <Icono nombre="printer" /> Generar PDF
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
