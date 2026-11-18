import { useCallback, useEffect, useState, type FormEvent } from "react";
import Bitacora from "../components/Bitacora";
import { ArticuloLFT, FuenteLFT, TextoLFT } from "../components/LFT";
import Registro, { useFormulario } from "../components/Registro";
import { Badge, ErrorBox, PageHeader, useEmpresaScope } from "../components/ui";
import { DIAS, DIAS_CORTOS, get, horas, hhmm, JORNADAS, patch, post, type TipoJornada, type Turno } from "../lib/api";
import { useAuth } from "../lib/auth";

type FilaDia = { activo: boolean; entrada: string; salida: string; comida: string; quebrado: boolean; entrada2: string; salida2: string };
type Form = { nombre: string; tipo_jornada: TipoJornada; tolerancia: string; dias: FilaDia[] };

const filaBase = (activo: boolean): FilaDia => ({ activo, entrada: "09:00", salida: "18:00", comida: "60", quebrado: false, entrada2: "16:00", salida2: "19:00" });
const VACIO: Form = {
  nombre: "",
  tipo_jornada: "diurna",
  tolerancia: "10",
  dias: DIAS.map((_, i) => filaBase(i < 5)),
};

const aMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const dur = (a: string, b: string) => {
  const d = aMin(b) - aMin(a);
  return d > 0 ? d : d + 1440;
};

function minutosDia(f: FilaDia): number {
  const segundo = f.quebrado && f.entrada2 && f.salida2 ? dur(f.entrada2, f.salida2) : 0;
  return dur(f.entrada, f.salida) + segundo - (f.quebrado ? 0 : Number(f.comida) || 0);
}

export default function Turnos() {
  const { usuario } = useAuth();
  const puedeEditar = usuario?.rol === "superadmin" || usuario?.rol === "admin_empresa";
  const { query, listo, selector } = useEmpresaScope();
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [editando, setEditando] = useState<Turno | "nuevo" | null>(null);
  const { form, setForm, cargar: cargarForm, sucio, descartar } = useFormulario<Form>(VACIO);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (listo) get<Turno[]>(`/turnos${query}`).then(setTurnos);
  }, [query, listo]);
  useEffect(cargar, [cargar]);

  function abrir(t: Turno | "nuevo") {
    setError(null);
    if (t === "nuevo") cargarForm(VACIO);
    else
      cargarForm({
        nombre: t.nombre,
        tipo_jornada: t.tipo_jornada,
        tolerancia: String(t.tolerancia_minutos),
        dias: DIAS.map((_, i) => {
          const d = t.dias.find((x) => x.dia_semana === i);
          return d
            ? {
                activo: true,
                entrada: hhmm(d.entrada),
                salida: hhmm(d.salida),
                comida: String(d.comida_minutos),
                quebrado: !!d.entrada2,
                entrada2: d.entrada2 ? hhmm(d.entrada2) : "16:00",
                salida2: d.salida2 ? hhmm(d.salida2) : "19:00",
              }
            : { ...filaBase(false) };
        }),
      });
    setEditando(t);
  }

  function setDia(i: number, cambio: Partial<FilaDia>) {
    setForm((f) => ({ ...f, dias: f.dias.map((d, j) => (j === i ? { ...d, ...cambio } : d)) }));
  }

  function copiarPrimero() {
    const primero = form.dias.find((d) => d.activo);
    if (!primero) return;
    setForm((f) => ({ ...f, dias: f.dias.map((d) => (d.activo ? { ...primero } : d)) }));
  }

  async function guardar(): Promise<boolean> {
    setError(null);
    const datos = {
      nombre: form.nombre,
      tipo_jornada: form.tipo_jornada,
      tolerancia_minutos: Number(form.tolerancia) || 0,
      dias: form.dias.flatMap((d, i) =>
        d.activo
          ? [
              {
                dia_semana: i,
                entrada: d.entrada,
                salida: d.salida,
                comida_minutos: d.quebrado ? 0 : Number(d.comida) || 0,
                entrada2: d.quebrado ? d.entrada2 : null,
                salida2: d.quebrado ? d.salida2 : null,
              },
            ]
          : [],
      ),
    };
    if (datos.dias.length === 0) {
      setError("Marca al menos un día laborable");
      return false;
    }
    try {
      const guardado =
        editando === "nuevo" ? await post<Turno>(`/turnos${query}`, datos) : await patch<Turno>(`/turnos/${(editando as Turno).id}${query}`, datos);
      abrir(guardado);
      setTurnos((lista) => (lista.some((x) => x.id === guardado.id) ? lista.map((x) => (x.id === guardado.id ? guardado : x)) : [...lista, guardado]));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  const indice = editando && editando !== "nuevo" ? turnos.findIndex((x) => x.id === editando.id) : -1;

  async function alternar(t: Turno) {
    await patch(`/turnos/${t.id}${query}`, { activo: !t.activo });
    cargar();
  }

  const semanaForm = form.dias.filter((d) => d.activo).reduce((s, d) => s + minutosDia(d), 0);

  return (
    <>
      <PageHeader
        title="Turnos"
        subtitle="Horarios semanales reutilizables, revisados contra la jornada máxima de la Ley Federal del Trabajo"
        action={
          <div className="flex flex-col gap-3 sm:flex-row">
            {selector}
            {puedeEditar && listo && (
              <button className="btn-primary" onClick={() => abrir("nuevo")}>
                Nuevo turno
              </button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {turnos.map((t) => (
          <div key={t.id} onClick={() => abrir(t)} className={`card cursor-pointer p-5 transition hover:ring-brand-200 ${t.activo ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-navy-900">{t.nombre}</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {JORNADAS[t.tipo_jornada].label} · {horas(t.minutos_semana)} de {horas(t.semana_max_minutos)} por semana · tolerancia {t.tolerancia_minutos} min
                </p>
              </div>
              <Badge ok={t.activo}>{t.activo ? "Activo" : "Inactivo"}</Badge>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs">
              {DIAS_CORTOS.map((corto, i) => {
                const d = t.dias.find((x) => x.dia_semana === i);
                return (
                  <div key={i} className={`rounded-md px-0.5 py-2 ${d ? "bg-brand-50 text-navy-900" : "bg-slate-50 text-slate-400"}`}>
                    <p className="font-semibold">{corto}</p>
                    {d ? (
                      <p className="mt-1 leading-tight">
                        {hhmm(d.entrada)}
                        <br />
                        {hhmm(d.salida)}
                        {d.entrada2 && d.salida2 && (
                          <>
                            <span className="my-0.5 block border-t border-brand-200" aria-label="y" />
                            {hhmm(d.entrada2)}
                            <br />
                            {hhmm(d.salida2)}
                          </>
                        )}
                      </p>
                    ) : (
                      <p className="mt-1 leading-tight">Des&shy;canso</p>
                    )}
                  </div>
                );
              })}
            </div>

            {t.advertencias.length > 0 && (
              <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
                {t.advertencias.map((a) => (
                  <li key={a}>
                    ⚠ <TextoLFT texto={a} />
                  </li>
                ))}
              </ul>
            )}

            {puedeEditar && (
              <div className="mt-4 flex gap-4 text-sm">
                <button className="text-slate-500 hover:underline" onClick={(e) => (e.stopPropagation(), alternar(t))}>
                  {t.activo ? "Desactivar" : "Activar"}
                </button>
              </div>
            )}
          </div>
        ))}
        {turnos.length === 0 && <p className="card p-10 text-center text-slate-500 lg:col-span-2">Aún no hay turnos.</p>}
      </div>
      <FuenteLFT articulos="arts. 59 a 69: jornada, descansos y horas extra" className="mt-4" />

      {editando && (
        <Registro
          titulo={editando === "nuevo" ? "Nuevo turno" : editando.nombre}
          indice={indice >= 0 ? indice : undefined}
          total={turnos.length}
          onIr={(i) => abrir(turnos[i])}
          sucio={puedeEditar && sucio}
          onGuardar={puedeEditar ? guardar : undefined}
          onDescartar={descartar}
          onCerrar={() => setEditando(null)}
        >
          <form onSubmit={(e: FormEvent) => (e.preventDefault(), guardar())} className="space-y-4">
            {editando !== "nuevo" && editando.advertencias.length > 0 && !sucio && (
              <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
                {editando.advertencias.map((a) => (
                  <li key={a}>
                    ⚠ <TextoLFT texto={a} />
                  </li>
                ))}
              </ul>
            )}
            <fieldset disabled={!puedeEditar} className="space-y-4">
            <div>
              <label className="label">Nombre</label>
              <input className="input" required placeholder="Matutino recepción" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">
                  Tipo de jornada <span className="font-normal text-slate-500">(<ArticuloLFT art="60" /> y <ArticuloLFT art="61" />)</span>
                </label>
                <select className="input" value={form.tipo_jornada} onChange={(e) => setForm({ ...form, tipo_jornada: e.target.value as TipoJornada })}>
                  {(Object.keys(JORNADAS) as TipoJornada[]).map((k) => (
                    <option key={k} value={k}>
                      {JORNADAS[k].label} — máx. {JORNADAS[k].max}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Tolerancia de retardo (min)</label>
                <input className="input" type="number" min={0} max={120} value={form.tolerancia} onChange={(e) => setForm({ ...form, tolerancia: e.target.value })} />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="label mb-0">Horario</span>
                <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={copiarPrimero}>
                  Copiar el primer día a los marcados
                </button>
              </div>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                <div className="hidden grid-cols-[6.5rem_1fr_1fr_4.5rem_3.5rem] gap-2 px-3 py-2 text-xs font-medium text-slate-500 sm:grid">
                  <span>Día</span>
                  <span>Entrada</span>
                  <span>Salida</span>
                  <span>Comida</span>
                  <span className="text-right">Horas</span>
                </div>
                {form.dias.map((d, i) => (
                  <div key={i} className="space-y-2 px-3 py-2">
                    <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[6.5rem_1fr_1fr_4.5rem_3.5rem]">
                      <label className="col-span-2 flex items-center gap-2 text-sm text-navy-900 sm:col-span-1">
                        <input type="checkbox" className="accent-brand-500" checked={d.activo} onChange={(e) => setDia(i, { activo: e.target.checked })} />
                        {DIAS[i]}
                      </label>
                      {d.activo ? (
                        <>
                          <input type="time" className="input px-2" aria-label={`Entrada ${DIAS[i]}`} value={d.entrada} onChange={(e) => setDia(i, { entrada: e.target.value })} required />
                          <input type="time" className="input px-2" aria-label={`Salida ${DIAS[i]}`} value={d.salida} onChange={(e) => setDia(i, { salida: e.target.value })} required />
                          {d.quebrado ? (
                            <span className="text-center text-xs text-slate-400">—</span>
                          ) : (
                            <input type="number" className="input px-2" aria-label={`Minutos de comida ${DIAS[i]}`} min={0} max={180} step={5} value={d.comida} onChange={(e) => setDia(i, { comida: e.target.value })} />
                          )}
                          <span className="text-right text-sm text-slate-600">{horas(minutosDia(d))}</span>
                        </>
                      ) : (
                        <span className="col-span-2 text-sm text-slate-400 sm:col-span-4">Descanso</span>
                      )}
                    </div>
                    {d.activo && d.quebrado && (
                      <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[6.5rem_1fr_1fr_4.5rem_3.5rem]">
                        <span className="col-span-2 text-xs text-slate-500 sm:col-span-1">2º horario</span>
                        <input type="time" className="input px-2" aria-label={`Regreso ${DIAS[i]}`} value={d.entrada2} onChange={(e) => setDia(i, { entrada2: e.target.value })} required />
                        <input type="time" className="input px-2" aria-label={`Salida final ${DIAS[i]}`} value={d.salida2} onChange={(e) => setDia(i, { salida2: e.target.value })} required />
                        <button type="button" className="col-span-2 text-left text-xs text-slate-500 hover:text-red-600 sm:col-span-2" onClick={() => setDia(i, { quebrado: false })}>
                          Quitar
                        </button>
                      </div>
                    )}
                    {d.activo && !d.quebrado && (
                      <button type="button" className="text-xs font-medium text-brand-600 hover:underline sm:ml-[7rem]" onClick={() => setDia(i, { quebrado: true })}>
                        + Agregar segundo horario (turno quebrado)
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Total semanal: <strong className="text-navy-900">{horas(semanaForm)}</strong>. Si la salida es menor que la entrada, el turno termina al día siguiente.
                En turno quebrado el empleado checa al salir y al regresar; el tiempo entre horarios no cuenta como trabajado (<ArticuloLFT art="64" />).
                Tope semanal: <ArticuloLFT art="59" />.
              </p>
            </div>

            </fieldset>
            {editando !== "nuevo" && (
              <details className="rounded-lg border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-medium text-navy-900">Historial de cambios</summary>
                <div className="mt-3">
                  <Bitacora modelo="turno" registroId={editando.id} query={query} />
                </div>
              </details>
            )}
            <ErrorBox message={error} />
            <button type="submit" className="sr-only">
              Guardar
            </button>
          </form>
        </Registro>
      )}
    </>
  );
}
