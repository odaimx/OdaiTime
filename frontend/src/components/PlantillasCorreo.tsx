import { useEffect, useState } from "react";
import { api, get } from "../lib/api";
import { BarraGuardar, ErrorBox, Fila } from "./ui";

type Plantilla = { clave: string; nombre: string; descripcion: string; asunto: string; titulo: string; cuerpo: string; boton: string | null; personalizada: boolean };
type Editable = { asunto: string; titulo: string; cuerpo: string; boton: string };

const editable = (p: Plantilla): Editable => ({ asunto: p.asunto, titulo: p.titulo, cuerpo: p.cuerpo, boton: p.boton ?? "" });

/** Textos de los correos que envía ODAITIME (invitaciones, recuperar contraseña…), editables por Odai. */
export default function PlantillasCorreo() {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [clave, setClave] = useState<string | null>(null);
  const [form, setForm] = useState<Editable | null>(null);
  const [vista, setVista] = useState<{ asunto: string; html: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<{ variables: Record<string, string>; plantillas: Plantilla[] }>("/correo/plantillas")
      .then((r) => {
        setPlantillas(r.plantillas);
        setVariables(r.variables);
        if (r.plantillas[0]) {
          setClave(r.plantillas[0].clave);
          setForm(editable(r.plantillas[0]));
        }
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const actual = plantillas.find((p) => p.clave === clave) ?? null;
  const sucio = !!actual && !!form && JSON.stringify(form) !== JSON.stringify(editable(actual));

  // Vista previa con datos de ejemplo mientras se escribe.
  useEffect(() => {
    if (!clave || !form || !form.asunto || !form.titulo || !form.cuerpo) return;
    const t = setTimeout(() => {
      api<{ asunto: string; html: string }>(`/correo/plantillas/${clave}/vista-previa`, { method: "POST", body: JSON.stringify({ ...form, boton: form.boton || null }) })
        .then(setVista)
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [clave, form]);

  function elegir(p: Plantilla) {
    if (sucio && !confirm("Hay cambios sin guardar en esta plantilla. ¿Descartarlos?")) return;
    setClave(p.clave);
    setForm(editable(p));
    setError(null);
  }

  async function enviar(init: RequestInit) {
    if (!clave) return;
    setError(null);
    setGuardando(true);
    try {
      const p = await api<Plantilla>(`/correo/plantillas/${clave}`, init);
      setPlantillas((l) => l.map((x) => (x.clave === p.clave ? p : x)));
      setForm(editable(p));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }
  const guardar = () => form && enviar({ method: "PUT", body: JSON.stringify({ ...form, boton: form.boton || null }) });

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav className="space-y-1">
        {plantillas.map((p) => (
          <button key={p.clave} type="button" onClick={() => elegir(p)} className={`w-full rounded-lg px-3 py-2 text-left text-sm ${p.clave === clave ? "bg-brand-50 font-medium text-tinta-900 ring-1 ring-brand-300" : "text-slate-600 hover:bg-slate-100"}`}>
            {p.nombre}
            {p.personalizada && <span className="mt-0.5 block text-[11px] text-brand-700">Personalizada</span>}
          </button>
        ))}
      </nav>

      {actual && form && (
        <div className="min-w-0 space-y-4">
          <BarraGuardar sucio={sucio} guardando={guardando} onGuardar={guardar}>
            {actual.personalizada && (
              <button type="button" className="text-xs text-slate-600 hover:underline" onClick={() => confirm("¿Volver al texto de fábrica?") && enviar({ method: "DELETE" })}>
                Restablecer texto de fábrica
              </button>
            )}
          </BarraGuardar>
          <p className="text-xs text-slate-500">{actual.descripcion}</p>
          <ErrorBox message={error} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="space-y-2">
              <Fila etiqueta="Asunto" htmlFor="pc-asunto">
                <input id="pc-asunto" className="input" maxLength={200} value={form.asunto} onChange={(e) => setForm({ ...form, asunto: e.target.value })} />
              </Fila>
              <Fila etiqueta="Título" htmlFor="pc-titulo">
                <input id="pc-titulo" className="input" maxLength={200} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
              </Fila>
              <Fila etiqueta="Texto" htmlFor="pc-cuerpo" ayuda="Deja un renglón en blanco entre párrafos. Escribe **así** para poner negritas.">
                <textarea id="pc-cuerpo" className="input min-h-48 font-mono text-[13px]" maxLength={4000} value={form.cuerpo} onChange={(e) => setForm({ ...form, cuerpo: e.target.value })} />
              </Fila>
              {actual.boton !== null || form.boton ? (
                <Fila etiqueta="Botón" htmlFor="pc-boton" ayuda="Texto del botón que lleva al enlace.">
                  <input id="pc-boton" className="input" maxLength={80} value={form.boton} onChange={(e) => setForm({ ...form, boton: e.target.value })} />
                </Fila>
              ) : null}
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <p className="mb-1 font-medium text-tinta-900">Variables (se reemplazan al enviar)</p>
                <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                  {Object.entries(variables).map(([k, d]) => (
                    <li key={k}>
                      <code className="text-brand-700">{`{${k}}`}</code> · {d}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">Vista previa (datos de ejemplo)</p>
              {vista && (
                <>
                  <p className="text-sm">
                    <span className="text-slate-500">Asunto:</span> <span className="font-medium text-tinta-900">{vista.asunto}</span>
                  </p>
                  <iframe title="Vista previa del correo" sandbox="" srcDoc={vista.html} className="h-[28rem] w-full rounded-lg border border-slate-200 bg-white" />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
