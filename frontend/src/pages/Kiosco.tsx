import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Camara from "../components/Camara";
import { comprimir, hora } from "../lib/api";

/** Modo kiosco: tablet fija en la entrada, autenticada con su propio token (sin usuario). */

const TOKEN = "odaitime.kiosco";

interface Estado {
  dispositivo: { id: string; nombre: string };
  empresa: string | null;
  sucursal: { clave: string; nombre: string; zona_horaria: string };
  config: { permitir_kiosco: boolean; pin: boolean; foto: boolean; qr: boolean };
  qr: { url: string; expira: string };
  ultimas: { nombre: string; tipo: string; momento: string }[];
  hora_servidor: string;
}

const leerToken = () => {
  try {
    return localStorage.getItem(TOKEN);
  } catch {
    return null;
  }
};

export default function Kiosco() {
  const [token, setToken] = useState<string | null>(leerToken);
  return token ? (
    <PantallaKiosco
      token={token}
      onDesvinculado={() => {
        localStorage.removeItem(TOKEN);
        setToken(null);
      }}
    />
  ) : (
    <Vincular
      onListo={(t) => {
        localStorage.setItem(TOKEN, t);
        setToken(t);
      }}
    />
  );
}

function Vincular({ onListo }: { onListo: (token: string) => void }) {
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await fetch("/api/kiosco/vincular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo }),
    });
    const body = await r.json().catch(() => null);
    if (r.ok) onListo(body.token);
    else setError(typeof body?.detail === "string" ? body.detail : "Código inválido");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 p-6">
      <form onSubmit={enviar} className="card w-full max-w-sm space-y-5 p-8 text-center">
        <img src="/logo.png" alt="ODAI" className="mx-auto h-8" />
        <div>
          <h1 className="text-xl font-semibold text-navy-900">Vincular kiosco</h1>
          <p className="mt-1 text-sm text-slate-500">Escribe el código de 6 dígitos que aparece en Configuración › Checadas › Dispositivos.</p>
        </div>
        <label className="sr-only" htmlFor="codigo">
          Código de vinculación
        </label>
        <input
          id="codigo"
          className="input text-center font-mono text-3xl tracking-[0.4em]"
          inputMode="numeric"
          maxLength={6}
          pattern="\d{6}"
          required
          autoFocus
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full py-3">Vincular</button>
      </form>
    </div>
  );
}

function PantallaKiosco({ token, onDesvinculado }: { token: string; onDesvinculado: () => void }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [ahora, setAhora] = useState(new Date());
  const [numero, setNumero] = useState("");
  const [pin, setPin] = useState("");
  const [campo, setCampo] = useState<"numero" | "pin">("numero");
  const [camara, setCamara] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string; detalle?: string } | null>(null);
  const headers = { "X-Dispositivo-Token": token };

  const cargar = useCallback(async () => {
    const r = await fetch("/api/kiosco/estado", { headers: { "X-Dispositivo-Token": token } }).catch(() => null);
    if (!r) return; // sin red: se reintenta en el siguiente ciclo
    if (r.status === 401) return onDesvinculado();
    if (!r.ok) return;
    const e: Estado = await r.json();
    setEstado(e);
    setQrImg(await QRCode.toDataURL(e.qr.url, { margin: 1, width: 320, color: { dark: "#1a2c4f", light: "#ffffff" } }));
  }, [token, onDesvinculado]);

  useEffect(() => {
    cargar();
    const reloj = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(reloj);
  }, [cargar]);

  // Refresca el QR justo cuando vence (cada 30 s).
  useEffect(() => {
    if (!estado) return;
    const ms = Math.max(1000, new Date(estado.qr.expira).getTime() - Date.now() + 300);
    const t = setTimeout(cargar, ms);
    return () => clearTimeout(t);
  }, [estado, cargar]);

  // El mensaje de resultado se limpia solo.
  useEffect(() => {
    if (!mensaje) return;
    const t = setTimeout(() => setMensaje(null), 5000);
    return () => clearTimeout(t);
  }, [mensaje]);

  const restante = estado ? Math.max(0, Math.round((new Date(estado.qr.expira).getTime() - ahora.getTime()) / 1000)) : 0;
  const tz = estado?.sucursal.zona_horaria;

  function tecla(t: string) {
    const set = campo === "numero" ? setNumero : setPin;
    const max = campo === "numero" ? 20 : 6;
    if (t === "borrar") set((v) => v.slice(0, -1));
    else set((v) => (v.length < max ? v + t : v));
  }

  function checar() {
    if (!numero) return setCampo("numero");
    if (estado?.config.pin && !pin) return setCampo("pin");
    if (estado?.config.foto) setCamara(true);
    else enviar(null);
  }

  async function enviar(foto: Blob | null) {
    setCamara(false);
    try {
      // fetch directo: el kiosco no usa la sesión de usuario (un PIN incorrecto responde 401).
      const body = new FormData();
      body.append("numero", numero);
      if (pin) body.append("pin", pin);
      if (foto) body.append("foto", await comprimir(foto), "foto.jpg");
      const resp = await fetch("/api/kiosco/checar", { method: "POST", headers, body });
      const datos = await resp.json().catch(() => null);
      if (!resp.ok) {
        const d = datos?.detail;
        throw new Error(typeof d === "string" ? d : (d?.mensaje ?? "No se pudo registrar"));
      }
      const r = datos as { nombre: string; tipo: string; momento: string; retardo_minutos: number | null };
      setMensaje({
        ok: true,
        texto: `${r.tipo === "entrada" ? "Entrada" : "Salida"} registrada · ${hora(r.momento, tz)}`,
        detalle: `${r.nombre}${r.retardo_minutos ? ` · retardo de ${r.retardo_minutos} min` : ""}`,
      });
      cargar();
    } catch (e) {
      setMensaje({ ok: false, texto: e instanceof TypeError ? "Sin conexión con el servidor" : (e as Error).message });
    } finally {
      setNumero("");
      setPin("");
      setCampo("numero");
    }
  }

  if (camara) return <Camara titulo="Mira a la cámara" onFoto={enviar} onCancelar={() => setCamara(false)} />;

  if (!estado) {
    return <div className="flex min-h-screen items-center justify-center bg-navy-900 text-slate-300">Conectando…</div>;
  }

  return (
    <div className="grid min-h-screen bg-navy-900 text-white lg:grid-cols-2">
      <section className="flex flex-col gap-6 p-6 sm:p-10">
        <div className="flex items-center justify-between gap-4">
          <img src="/logo.png" alt="ODAI" className="h-7" />
          <span className="text-sm text-slate-300">
            <span className="font-mono font-semibold text-accent-500">{estado.sucursal.clave}</span> · {estado.sucursal.nombre}
          </span>
        </div>
        <div>
          <p className="text-7xl font-bold tracking-tight tabular-nums sm:text-8xl">{ahora.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: tz })}</p>
          <p className="mt-2 text-lg capitalize text-slate-300">{ahora.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: tz })}</p>
        </div>

        {estado.config.qr && qrImg && (
          <div className="flex flex-col items-center gap-5 rounded-3xl bg-white p-5 text-navy-900 sm:flex-row">
            <img src={qrImg} alt="Código QR para checar con el celular" className="h-48 w-48 shrink-0" />
            <div className="space-y-2">
              <p className="text-xl font-bold">Escanea con tu celular</p>
              <p className="text-sm text-slate-600">Abre la cámara de tu teléfono y apunta a este código. Cambia cada 30 segundos.</p>
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-brand-500 transition-[width] duration-1000 ease-linear" style={{ width: `${(restante / 30) * 100}%` }} />
                </div>
                <span className="text-sm font-semibold tabular-nums text-brand-700">0:{String(restante).padStart(2, "0")}</span>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Últimas checadas</p>
          {estado.ultimas.length === 0 && <p className="text-sm text-slate-400">Nadie ha checado hoy.</p>}
          {estado.ultimas.slice(0, 5).map((u, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span>{u.nombre}</span>
              <span className={u.tipo === "entrada" ? "text-emerald-300" : "text-sky-300"}>
                {u.tipo === "entrada" ? "Entrada" : "Salida"} {hora(u.momento, tz)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col justify-center gap-5 bg-slate-50 p-6 text-navy-900 sm:p-10">
        {!estado.config.permitir_kiosco ? (
          <p className="text-center text-lg text-slate-600">El kiosco está desactivado para esta sucursal.</p>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold">Checar con tu número</h1>
              <p className="mt-1 text-slate-500">{estado.config.pin ? "Escribe tu número de empleado y tu PIN." : "Escribe tu número de empleado."}</p>
            </div>

            <div className={`grid gap-3 ${estado.config.pin ? "grid-cols-2" : "grid-cols-1"}`}>
              <button type="button" onClick={() => setCampo("numero")} className={`rounded-2xl border-2 bg-white px-4 py-3 text-left ${campo === "numero" ? "border-brand-500" : "border-slate-200"}`}>
                <span className="block text-xs font-semibold text-slate-500">Número de empleado</span>
                <span className="block h-9 text-3xl font-bold tabular-nums">{numero}</span>
              </button>
              {estado.config.pin && (
                <button type="button" onClick={() => setCampo("pin")} className={`rounded-2xl border-2 bg-white px-4 py-3 text-left ${campo === "pin" ? "border-brand-500" : "border-slate-200"}`}>
                  <span className="block text-xs font-semibold text-slate-500">PIN</span>
                  <span className="block h-9 text-3xl tracking-[0.3em]">{"•".repeat(pin.length)}</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
                <button key={n} type="button" onClick={() => tecla(n)} className="h-16 rounded-2xl border border-slate-200 bg-white text-3xl font-semibold transition active:scale-95 active:bg-brand-50 sm:h-20">
                  {n}
                </button>
              ))}
              <button type="button" onClick={() => tecla("borrar")} aria-label="Borrar" className="flex h-16 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 sm:h-20">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 5H9l-6 7 6 7h12zM17 9l-6 6M11 9l6 6" />
                </svg>
              </button>
              <button type="button" onClick={() => tecla("0")} className="h-16 rounded-2xl border border-slate-200 bg-white text-3xl font-semibold transition active:scale-95 sm:h-20">
                0
              </button>
              <button type="button" onClick={checar} className="h-16 rounded-2xl bg-brand-500 text-lg font-bold text-white transition active:scale-95 sm:h-20">
                {campo === "numero" && estado.config.pin ? "Siguiente" : "Checar"}
              </button>
            </div>
            {estado.config.foto && <p className="text-sm text-slate-500">Al checar, la tablet tomará tu foto.</p>}
          </>
        )}
      </section>

      {mensaje && (
        <div role="status" className={`fixed inset-x-0 bottom-0 p-6 text-center text-white ${mensaje.ok ? "bg-emerald-600" : "bg-red-600"}`}>
          <p className="text-2xl font-bold">{mensaje.texto}</p>
          {mensaje.detalle && <p className="mt-1 text-lg">{mensaje.detalle}</p>}
        </div>
      )}
    </div>
  );
}
