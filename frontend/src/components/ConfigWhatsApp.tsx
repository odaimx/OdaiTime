import { useEffect, useState, type FormEvent } from "react";
import { Ayuda, ErrorBox } from "./ui";
import { api, get, post } from "../lib/api";

interface Config {
  activo: boolean;
  todos: boolean;
  phone_number_id: string | null;
  waba_id: string | null;
  numero: string | null;
  tiene_token: boolean;
  tiene_secreto: boolean;
  webhook_url: string | null;
  verify_token: string | null;
}

/** Número de WhatsApp Business de la empresa (Cloud API de Meta) para checar por WhatsApp. */
export default function ConfigWhatsApp({ query }: { query: string }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [form, setForm] = useState({ activo: false, todos: true, phone_number_id: "", waba_id: "", numero: "", token: "", app_secret: "" });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [tel, setTel] = useState("");

  function cargar(c: Config) {
    setCfg(c);
    setForm({ activo: c.activo, todos: c.todos, phone_number_id: c.phone_number_id ?? "", waba_id: c.waba_id ?? "", numero: c.numero ?? "", token: "", app_secret: "" });
  }
  useEffect(() => {
    get<Config>(`/whatsapp/config${query}`).then(cargar);
  }, [query]);

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    setOk(null);
    try {
      cargar(await api<Config>(`/whatsapp/config${query}`, { method: "PUT", body: JSON.stringify({ ...form, token: form.token || null, app_secret: form.app_secret || null }) }));
      setOk("Configuración guardada.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function probar() {
    setError(null);
    setOk(null);
    try {
      await post(`/whatsapp/prueba${query}`, { telefono: tel });
      setOk("Mensaje de prueba enviado.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const copiar = (t: string | null) => t && navigator.clipboard?.writeText(t);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  if (!cfg) return <p className="text-sm text-slate-500">Cargando…</p>;
  return (
    <form onSubmit={guardar} className="card space-y-5 p-5">
      <div>
        <h2 className="font-semibold text-tinta-900">Checar por WhatsApp</h2>
        <p className="mt-1 text-sm text-slate-600">
          El empleado escribe al número de WhatsApp de la empresa y manda su <strong>ubicación actual</strong>; se valida contra su obra o sucursal y se registra su entrada o
          salida. Se identifica por el <strong>celular de su ficha</strong>. Usa tu propio número de WhatsApp Business: Meta te cobra directamente (1,000 respuestas gratis al mes por número).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">
            Identificador del número (Phone number ID)
            <Ayuda texto="En developers.facebook.com → tu app → WhatsApp → Configuración de la API." />
          </label>
          <input className="input font-mono" inputMode="numeric" value={form.phone_number_id} onChange={set("phone_number_id")} />
        </div>
        <div>
          <label className="label">Número para mostrar</label>
          <input className="input" placeholder="+52 998 000 0000" value={form.numero} onChange={set("numero")} />
        </div>
        <div>
          <label className="label">ID de la cuenta de WhatsApp Business (opcional)</label>
          <input className="input font-mono" inputMode="numeric" value={form.waba_id} onChange={set("waba_id")} />
        </div>
        <div>
          <label className="label">
            Token de acceso
            <Ayuda texto="Token permanente de un usuario del sistema con permiso whatsapp_business_messaging. Se guarda cifrado." />
          </label>
          <input className="input font-mono" type="password" autoComplete="off" placeholder={cfg.tiene_token ? "•••••• (guardado; escribe para cambiarlo)" : ""} value={form.token} onChange={set("token")} />
        </div>
        <div>
          <label className="label">
            Secreto de la app (App secret)
            <Ayuda texto="En la app de Meta → Configuración → Básica. Sirve para comprobar que los mensajes vienen de Meta. Se guarda cifrado." />
          </label>
          <input className="input font-mono" type="password" autoComplete="off" placeholder={cfg.tiene_secreto ? "•••••• (guardado; escribe para cambiarlo)" : ""} value={form.app_secret} onChange={set("app_secret")} />
        </div>
      </div>

      {cfg.webhook_url && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium text-tinta-900">Webhook: pégalo en tu app de Meta (WhatsApp → Configuración) y suscríbete a «messages».</p>
          {[
            ["URL de devolución de llamada", cfg.webhook_url],
            ["Token de verificación", cfg.verify_token],
          ].map(([t, v]) => (
            <div key={t} className="flex flex-wrap items-center gap-2">
              <span className="w-56 text-slate-500">{t}</span>
              <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-xs ring-1 ring-slate-200">{v}</code>
              <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => copiar(v)}>
                Copiar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.todos} onChange={(e) => setForm({ ...form, todos: e.target.checked })} />
          Todos los empleados con celular en su ficha pueden checar por WhatsApp
          <Ayuda texto="Si lo desmarcas, solo quienes tengan «WhatsApp» en sus medios de checado (ficha del empleado)." />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
          <strong>Activar checado por WhatsApp</strong>
        </label>
      </div>

      <ErrorBox message={error} />
      {ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</p>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        {cfg.tiene_token && (
          <div className="flex items-end gap-2">
            <div>
              <label className="label">Probar: enviar a</label>
              <input className="input w-44" placeholder="52 998 123 4567" value={tel} onChange={(e) => setTel(e.target.value)} />
            </div>
            <button type="button" className="btn-secondary" disabled={tel.replace(/\D/g, "").length < 10} onClick={probar}>
              Enviar prueba
            </button>
          </div>
        )}
        <button className="btn-primary">Guardar</button>
      </div>
      <p className="text-xs text-slate-500">Para la prueba, el número destino debe haber escrito antes al WhatsApp de la empresa (Meta solo permite responder dentro de 24 h).</p>
    </form>
  );
}
