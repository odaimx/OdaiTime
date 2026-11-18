import { useEffect, useState, type FormEvent } from "react";
import { api, get, post } from "../lib/api";

interface Config {
  host: string;
  puerto: number;
  seguridad: "starttls" | "ssl" | "ninguna";
  usuario: string;
  remitente: string;
  activo: boolean;
  tiene_password: boolean;
}

/** Servidor de correo saliente general de Odai (invitaciones, recuperar contraseña…).
 * El remitente visible de cada correo es el nombre de la empresa del destinatario. */
export default function CorreoSaliente() {
  const [c, setC] = useState<Config | null>(null);
  const [password, setPassword] = useState("");
  const [prueba, setPrueba] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    get<Config>("/correo").then(setC);
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!c) return;
    setMsg(null);
    try {
      setC(await api<Config>("/correo", { method: "PUT", body: JSON.stringify({ ...c, password: password || null }) }));
      setPassword("");
      setMsg({ ok: true, texto: "Configuración guardada." });
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error).message });
    }
  }

  async function enviarPrueba() {
    setMsg(null);
    try {
      const r = await post<{ mensaje: string }>("/correo/prueba", { para: prueba });
      setMsg({ ok: true, texto: r.mensaje });
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error).message });
    }
  }

  if (!c) return <p className="text-sm text-slate-500">Cargando…</p>;
  const set = (k: keyof Config, v: string | number | boolean) => setC({ ...c, [k]: v });
  return (
    <form onSubmit={guardar} className="form-2col">
      <p className="completo text-sm text-slate-600">
        Un solo servidor envía los correos de todas las empresas (invitaciones al portal, recuperar contraseña). Cada correo sale con el <strong>nombre de la empresa</strong> como remitente.
      </p>
      <div>
        <label className="label">Servidor SMTP</label>
        <input className="input" placeholder="smtp.odai.lat" value={c.host} onChange={(e) => set("host", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Puerto</label>
          <input className="input" type="number" min={1} max={65535} value={c.puerto} onChange={(e) => set("puerto", Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Seguridad</label>
          <select className="input" value={c.seguridad} onChange={(e) => set("seguridad", e.target.value)}>
            <option value="starttls">STARTTLS (587)</option>
            <option value="ssl">SSL/TLS (465)</option>
            <option value="ninguna">Ninguna</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">Usuario</label>
        <input className="input" autoComplete="off" value={c.usuario} onChange={(e) => set("usuario", e.target.value)} />
      </div>
      <div>
        <label className="label">Contraseña</label>
        <input className="input" type="password" autoComplete="new-password" placeholder={c.tiene_password ? "•••••••• (guardada)" : ""} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div>
        <label className="label">Correo remitente</label>
        <input className="input" type="email" required placeholder="no-responder@odai.lat" value={c.remitente} onChange={(e) => set("remitente", e.target.value)} />
      </div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-navy-900">
        <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={c.activo} onChange={(e) => set("activo", e.target.checked)} />
        Enviar correos
      </label>
      <div className="completo flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
        <div className="min-w-56 flex-1">
          <label className="label">Enviar un correo de prueba a</label>
          <input className="input" type="email" value={prueba} onChange={(e) => setPrueba(e.target.value)} />
        </div>
        <button type="button" className="btn-secondary" disabled={!prueba} onClick={enviarPrueba}>
          Enviar prueba
        </button>
        <button className="btn-primary">Guardar</button>
      </div>
      {msg && <p className={`completo rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.texto}</p>}
    </form>
  );
}
