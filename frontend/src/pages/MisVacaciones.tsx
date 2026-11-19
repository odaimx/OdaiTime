import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ErrorBox, PageHeader } from "../components/ui";
import { fechaCorta, get, post, type MisVacaciones as Datos, type SolicitudVacaciones } from "../lib/api";

export const ESTADO_VAC: Record<SolicitudVacaciones["estado"], { texto: string; clase: string }> = {
  pendiente: { texto: "Por aprobar", clase: "bg-amber-100 text-amber-800" },
  aprobada: { texto: "Aprobada", clase: "bg-emerald-100 text-emerald-800" },
  rechazada: { texto: "Rechazada", clase: "bg-red-100 text-red-700" },
  cancelada: { texto: "Cancelada", clase: "bg-slate-100 text-slate-600" },
};

export const rango = (a: string, b: string) => (a === b ? fechaCorta(a) : `${fechaCorta(a)} – ${fechaCorta(b)}`);

const manana = () => {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Portal del empleado: saldo de vacaciones (art. 76), solicitar y ver sus solicitudes. */
export default function MisVacaciones() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [inicio, setInicio] = useState(manana());
  const [fin, setFin] = useState(manana());
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(() => {
    get<Datos>("/vacaciones/mias")
      .then(setDatos)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(cargar, [cargar]);

  async function pedir(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const s = await post<SolicitudVacaciones>("/vacaciones/mias", { fecha_inicio: inicio, fecha_fin: fin, motivo: motivo || null });
      setAviso(s.avisos);
      setPidiendo(false);
      setMotivo("");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function cancelar(s: SolicitudVacaciones) {
    if (!confirm(`¿Cancelar tu solicitud del ${rango(s.fecha_inicio, s.fecha_fin)}?`)) return;
    try {
      await post(`/vacaciones/mias/${s.id}/cancelar`, {});
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const saldo = datos?.saldo;
  const libres = saldo ? Math.max(saldo.dias_disponibles - (datos?.pendientes_dias ?? 0), 0) : 0;

  return (
    <>
      <PageHeader icono="tree-palm" title="Mis vacaciones" />
      <div className="mx-auto max-w-md space-y-4">
        {saldo && (
          <div className="rounded-3xl bg-navy-900 p-6 text-white">
            <p className="text-sm text-slate-300">Días disponibles</p>
            <p className="text-5xl font-bold tabular-nums">{libres}</p>
            <p className="mt-2 text-sm text-slate-300">
              {saldo.dias_correspondientes} por {saldo.antiguedad_anios} año(s) de antigüedad · {saldo.dias_tomados} tomados
              {datos.pendientes_dias ? ` · ${datos.pendientes_dias} por aprobar` : ""}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Periodo {rango(saldo.periodo_inicio, saldo.periodo_fin)}. Al {fechaCorta(saldo.proximo_aniversario)} te corresponden {saldo.dias_proximo_periodo} días.
            </p>
          </div>
        )}

        {aviso.length > 0 && (
          <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-medium">Solicitud enviada. Te avisaremos cuando la revisen.</p>
            {aviso.map((a) => (
              <p key={a} className="mt-1 text-xs text-emerald-700">{a}</p>
            ))}
          </div>
        )}
        <ErrorBox message={error} />

        {pidiendo ? (
          <form onSubmit={pedir} className="card space-y-3 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Desde</label>
                <input className="input" type="date" required min={manana()} value={inicio} onChange={(e) => (setInicio(e.target.value), e.target.value > fin && setFin(e.target.value))} />
              </div>
              <div>
                <label className="label">Hasta</label>
                <input className="input" type="date" required min={inicio} value={fin} onChange={(e) => setFin(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Motivo (opcional)</label>
              <textarea className="input" rows={2} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
            <p className="text-xs text-slate-500">Solo se descuentan los días que te toca trabajar (no tus descansos ni los festivos de ley).</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPidiendo(false)}>
                Cancelar
              </button>
              <button className="btn-primary" disabled={enviando}>
                {enviando ? "Enviando…" : "Enviar solicitud"}
              </button>
            </div>
          </form>
        ) : (
          <button className="btn-primary flex w-full justify-center py-3" disabled={!saldo || libres === 0} onClick={() => (setAviso([]), setPidiendo(true))}>
            Pedir vacaciones
          </button>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Mis solicitudes</p>
          {datos && datos.solicitudes.length === 0 ? (
            <p className="text-sm text-slate-400">Aún no has pedido vacaciones.</p>
          ) : (
            <ul className="card divide-y divide-slate-100">
              {datos?.solicitudes.map((s) => (
                <li key={s.id} className="space-y-1 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-tinta-900">{rango(s.fecha_inicio, s.fecha_fin)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_VAC[s.estado].clase}`}>{ESTADO_VAC[s.estado].texto}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {s.dias} día(s){s.motivo ? ` · ${s.motivo}` : ""}
                  </p>
                  {s.comentario && <p className="text-xs text-slate-600">Respuesta: {s.comentario}</p>}
                  {s.estado === "pendiente" && (
                    <button className="text-xs text-red-600 hover:underline" onClick={() => cancelar(s)}>
                      Cancelar solicitud
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
