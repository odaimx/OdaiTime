import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import AvisoPrivacidad, { type DatosAviso } from "../components/AvisoPrivacidad";
import Camara from "../components/Camara";
import PantallaChecado, { ACCIONES, EncabezadoEmpresa, Reloj, type Accion, type Bloque, type MarcaHoy } from "../components/PantallaChecado";
import { comprimir, hora } from "../lib/api";
import {
  agregar as cola_agregar,
  cifrarPin,
  contar as cola_contar,
  descifrarPin,
  guardarDesfase,
  horaCorregida,
  listar as cola_listar,
  quitar as cola_quitar,
} from "../lib/colaKiosco";

/** Modo kiosco: tablet fija en la entrada, autenticada con su propio token (sin usuario). */

const TOKEN = "odaitime.kiosco";

interface Estado {
  dispositivo: { id: string; nombre: string };
  empresa: string | null;
  empresa_id?: string | null;
  logo_version?: string | null;
  sucursal: { clave: string; nombre: string; zona_horaria: string };
  config: { permitir_kiosco: boolean; pin: boolean; foto: boolean; qr: boolean };
  qr: { url: string; expira: string };
  ultimas: { nombre: string; tipo: string; momento: string }[];
  hora_servidor: string;
  festivo_hoy: string | null;
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
          <h1 className="text-xl font-semibold text-tinta-900">Vincular kiosco</h1>
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

interface Identificado {
  sesion: string | null; // null = sin conexión
  empleado: { nombre: string; nombre_completo: string; numero: string; puesto: string | null };
  foto: string | null;
  sucursal?: string;
  turno?: Bloque[];
  aviso_aceptado?: boolean;
  aviso?: DatosAviso | null;
  checadas: MarcaHoy[];
  acciones: { accion: Accion; habilitada: boolean }[];
}

const INACTIVIDAD_S = 30;

function PantallaKiosco({ token, onDesvinculado }: { token: string; onDesvinculado: () => void }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [ahora, setAhora] = useState(new Date());
  const [numero, setNumero] = useState("");
  const [pin, setPin] = useState("");
  const [campo, setCampo] = useState<"numero" | "pin">("numero");
  const [quien, setQuien] = useState<Identificado | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [camara, setCamara] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [enLinea, setEnLinea] = useState(true);
  const [pendientes, setPendientes] = useState(0);
  const [inactivo, setInactivo] = useState(INACTIVIDAD_S);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string; detalle?: string; espera?: boolean } | null>(null);
  const headers = { "X-Dispositivo-Token": token };

  const reiniciar = useCallback(() => {
    setQuien(null);
    setAccion(null);
    setNumero("");
    setPin("");
    setCampo("numero");
    setCamara(false);
  }, []);

  // Envía las checadas guardadas sin conexión (en orden); el servidor comprueba el PIN.
  const sincronizar = useCallback(async () => {
    const cola = await cola_listar().catch(() => []);
    for (const p of cola) {
      const body = new FormData();
      body.append("numero", p.numero);
      const pinClaro = await descifrarPin(p.pin).catch(() => "");
      if (pinClaro) body.append("pin", pinClaro);
      body.append("accion", p.accion);
      body.append("offline", "true");
      body.append("momento", p.momento);
      if (p.foto) body.append("foto", p.foto, "foto.webp");
      const r = await fetch("/api/kiosco/checar", { method: "POST", headers: { "X-Dispositivo-Token": token }, body }).catch(() => null);
      if (!r) break; // sigue sin red
      if (r.status === 401 && !(await r.clone().json().catch(() => null))?.detail?.codigo) return onDesvinculado();
      await cola_quitar(p.id!); // enviada o rechazada (queda en la bitácora del servidor)
    }
    setPendientes(await cola_contar().catch(() => 0));
  }, [token, onDesvinculado]);

  const cargar = useCallback(async () => {
    const r = await fetch("/api/kiosco/estado", { headers: { "X-Dispositivo-Token": token } }).catch(() => null);
    if (!r) return setEnLinea(false); // sin red: se reintenta en el siguiente ciclo
    if (r.status === 401) return onDesvinculado();
    if (!r.ok) return;
    setEnLinea(true);
    const e: Estado = await r.json();
    guardarDesfase(e.hora_servidor);
    setEstado(e);
    setQrImg(await QRCode.toDataURL(e.qr.url, { margin: 1, width: 320, color: { dark: "#1a2c4f", light: "#ffffff" } }));
    void sincronizar();
  }, [token, onDesvinculado, sincronizar]);

  useEffect(() => {
    cargar();
    cola_contar().then(setPendientes).catch(() => null);
    const reloj = setInterval(() => setAhora(new Date()), 1000);
    const latido = setInterval(cargar, 60_000);
    window.addEventListener("online", cargar);
    return () => {
      clearInterval(reloj);
      clearInterval(latido);
      window.removeEventListener("online", cargar);
    };
  }, [cargar]);

  // Refresca el QR justo cuando vence (cada 30 s).
  useEffect(() => {
    if (!estado) return;
    const ms = Math.max(1000, new Date(estado.qr.expira).getTime() - Date.now() + 300);
    const t = setTimeout(cargar, ms);
    return () => clearTimeout(t);
  }, [estado, cargar]);

  // Con alguien identificado, regresa al inicio tras 30 s sin tocar la pantalla.
  useEffect(() => {
    if (!quien || camara) return;
    setInactivo(quien.aviso_aceptado === false ? 60 : INACTIVIDAD_S); // más tiempo para leer el aviso
    const t = setInterval(() => setInactivo((n) => (n <= 1 ? (reiniciar(), INACTIVIDAD_S) : n - 1)), 1000);
    return () => clearInterval(t);
  }, [quien, camara, reiniciar]);

  // El mensaje de resultado se limpia solo.
  useEffect(() => {
    if (!mensaje) return;
    const t = setTimeout(() => setMensaje(null), mensaje.ok ? 4000 : 25000);
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

  async function continuar() {
    if (!numero) return setCampo("numero");
    if (estado?.config.pin && campo === "numero") return setCampo("pin");
    if (estado?.config.pin && !pin) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/kiosco/identificar", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ numero, pin: pin || null }),
      });
      const datos = await r.json().catch(() => null);
      if (!r.ok) {
        const d = datos?.detail;
        setMensaje({ ok: false, texto: typeof d === "string" ? d : (d?.mensaje ?? "No se pudo identificar") });
        setPin("");
        setCampo(d?.codigo === "credenciales" && estado?.config.pin ? "pin" : "numero");
        return;
      }
      setEnLinea(true);
      setQuien(datos as Identificado);
    } catch {
      // Sin conexión: se puede checar igual; el servidor comprobará el PIN al reconectar.
      setEnLinea(false);
      setQuien({
        sesion: null,
        empleado: { nombre: "", nombre_completo: `Empleado ${numero}`, numero, puesto: null },
        foto: null,
        checadas: [],
        acciones: (["entrada", "salida"] as Accion[]).map((a) => ({ accion: a, habilitada: true })),
      });
    } finally {
      setOcupado(false);
    }
  }

  async function aceptarAviso() {
    if (!quien?.sesion) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/kiosco/aviso", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ sesion: quien.sesion }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => null))?.detail;
        setMensaje({ ok: false, texto: typeof d === "string" ? d : (d?.mensaje ?? "No se pudo registrar el aviso") });
        if (r.status === 401) reiniciar();
        return;
      }
      setQuien({ ...quien, aviso_aceptado: true });
    } catch {
      setMensaje({ ok: false, texto: "Sin conexión. Intenta de nuevo." });
    } finally {
      setOcupado(false);
    }
  }

  function elegir(a: Accion) {
    setAccion(a);
    setCamara(true); // la selfie siempre se toma
  }

  async function enviar(foto: Blob) {
    setCamara(false);
    if (!quien || !accion) return;
    setOcupado(true);
    const fotoC = await comprimir(foto);
    const guardarSinRed = async () => {
      await cola_agregar({ numero, pin: await cifrarPin(pin), accion, momento: horaCorregida().toISOString(), foto: fotoC });
      setPendientes(await cola_contar());
      setMensaje({ ok: true, espera: true, texto: `${ACCIONES[accion].listo} sin conexión`, detalle: "Se enviará en cuanto regrese el internet." });
    };
    try {
      if (!quien.sesion) {
        await guardarSinRed();
        return;
      }
      const body = new FormData();
      body.append("sesion", quien.sesion);
      body.append("accion", accion);
      body.append("foto", fotoC, "foto.webp");
      const resp = await fetch("/api/kiosco/checar", { method: "POST", headers, body });
      const datos = await resp.json().catch(() => null);
      if (!resp.ok) {
        const d = datos?.detail;
        throw new Error(typeof d === "string" ? d : (d?.mensaje ?? "No se pudo registrar"));
      }
      const r = datos as { nombre: string; tipo: string; momento: string; retardo_minutos: number | null };
      setMensaje({
        ok: true,
        texto: `${ACCIONES[accion].listo} · ${hora(r.momento, tz)}`,
        detalle: `${r.nombre}${r.retardo_minutos ? ` · retardo de ${r.retardo_minutos} min` : ""}`,
      });
      cargar();
    } catch (e) {
      if (e instanceof TypeError) await guardarSinRed();
      else setMensaje({ ok: false, texto: (e as Error).message });
    } finally {
      setOcupado(false);
      reiniciar();
    }
  }

  if (camara) return <Camara titulo="Mira a la cámara" onFoto={enviar} onCancelar={() => setCamara(false)} />;

  if (!estado) {
    return <div className="flex min-h-screen items-center justify-center bg-navy-900 text-slate-300">Conectando…</div>;
  }

  const conexion =
    !enLinea || pendientes > 0 ? (
      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${enLinea ? "bg-amber-400 text-amber-950" : "bg-red-500 text-white"}`}>
        {enLinea ? `Enviando ${pendientes} pendiente(s)…` : `Sin conexión${pendientes ? ` · ${pendientes} por enviar` : ""}`}
      </span>
    ) : null;

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-tinta-900 sm:p-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <EncabezadoEmpresa
          nombre={estado.empresa ?? "Kiosco"}
          empresaId={estado.empresa_id}
          logoVersion={estado.logo_version}
          detalle={`${estado.sucursal.clave} · ${estado.sucursal.nombre}`}
          derecha={conexion}
        />

        {/* El QR para checar con el celular en lugar de los botones de método; a un lado, el reloj. */}
        <div className="flex items-center justify-between gap-6">
          {estado.config.qr && qrImg && enLinea ? (
            <div className="card flex items-center gap-4 p-3">
              <img src={qrImg} alt="Código QR para checar con el celular" className="h-28 w-28" />
              <div className="w-36 space-y-2">
                <p className="text-sm font-semibold leading-tight">Checa con tu celular</p>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full bg-brand-500 transition-[width] duration-1000 ease-linear" style={{ width: `${(restante / 30) * 100}%` }} />
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-brand-700">0:{String(restante).padStart(2, "0")}</span>
                </div>
                <p className="text-xs leading-tight text-slate-500">Escanéalo con la cámara. Cambia cada 30 s.</p>
              </div>
            </div>
          ) : (
            <span />
          )}
          <Reloj grande ahora={ahora} tz={tz} />
        </div>

        <main>
          {!estado.config.permitir_kiosco ? (
            <p className="card p-10 text-center text-lg text-slate-600">El kiosco está desactivado para esta sucursal.</p>
          ) : quien && quien.sesion && quien.aviso_aceptado === false ? (
            <div className="mx-auto w-full max-w-3xl space-y-3">
              <p className="text-center text-lg">
                Hola, <strong>{quien.empleado.nombre}</strong>. Antes de tu primera checada, lee el aviso de privacidad.
              </p>
              <AvisoPrivacidad grande enterado datos={quien.aviso ?? null} empresa={estado.empresa ?? undefined} ocupado={ocupado} onAceptar={aceptarAviso} />
              <div className="text-right">
                <button type="button" className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white" onClick={reiniciar}>
                  No soy yo · Cancelar ({inactivo})
                </button>
              </div>
            </div>
          ) : quien ? (
            <div className="mx-auto w-full max-w-3xl space-y-4">
              <PantallaChecado
                grande
                nombre={quien.empleado.nombre_completo}
                subtitulo={quien.sucursal ?? `${estado.sucursal.clave} · ${estado.sucursal.nombre}`}
                bloques={quien.turno}
                foto={
                  quien.foto ? (
                    <img src={quien.foto} alt="" className="h-24 w-24 rounded-2xl object-cover ring-4 ring-slate-100" />
                  ) : (
                    <span className="flex h-24 w-24 items-center justify-center rounded-2xl bg-slate-100 text-3xl font-bold text-slate-400">{quien.empleado.nombre_completo.charAt(0)}</span>
                  )
                }
                marcas={quien.checadas}
                acciones={quien.acciones}
                tz={tz}
                ahora={ahora}
                ocupado={ocupado}
                onAccion={elegir}
              />
              {!quien.sesion && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Sin conexión: tu checada se guarda en la tablet y se envía en cuanto regrese el internet.</p>}
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>Al elegir, la tablet toma tu foto.</span>
                <button type="button" className="rounded-xl px-4 py-2 font-medium text-slate-600 hover:bg-white" onClick={reiniciar}>
                  No soy yo · Cancelar ({inactivo})
                </button>
              </div>
            </div>
          ) : (
            <div className="card mx-auto w-full max-w-md space-y-5 p-6 sm:p-8">
              {estado.festivo_hoy && (
                <p className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  Hoy es <strong>{estado.festivo_hoy}</strong>. Solo checa el personal designado para trabajar.
                </p>
              )}
              <div className="text-center">
                <h1 className="text-2xl font-bold">Bienvenido</h1>
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
                  <button key={n} type="button" onClick={() => tecla(n)} className="h-16 rounded-2xl border border-slate-200 bg-white text-3xl font-semibold transition active:scale-95 active:bg-brand-50">
                    {n}
                  </button>
                ))}
                <button type="button" onClick={() => tecla("borrar")} aria-label="Borrar" className="flex h-16 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 5H9l-6 7 6 7h12zM17 9l-6 6M11 9l6 6" />
                  </svg>
                </button>
                <button type="button" onClick={() => tecla("0")} className="h-16 rounded-2xl border border-slate-200 bg-white text-3xl font-semibold transition active:scale-95">
                  0
                </button>
                <button type="button" onClick={continuar} disabled={ocupado} className="h-16 rounded-2xl bg-brand-500 text-lg font-bold text-white transition active:scale-95 disabled:opacity-60">
                  {campo === "numero" && estado.config.pin ? "Siguiente" : ocupado ? "…" : "Entrar"}
                </button>
              </div>
            </div>
          )}
        </main>

        {!quien && estado.ultimas.length > 0 && (
          <div className="card space-y-1.5 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Últimas checadas</p>
            {estado.ultimas.slice(0, 5).map((u, i) => (
              <div key={i} className="flex justify-between gap-2 text-sm">
                <span className="truncate">{u.nombre}</span>
                <span className={`shrink-0 ${u.tipo === "entrada" ? "text-emerald-600" : "text-rose-600"}`}>
                  {u.tipo === "entrada" ? "Entrada" : "Salida"} {hora(u.momento, tz)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {mensaje && (
        <div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/60 p-6" onClick={() => setMensaje(null)}>
          <div className="card relative w-full max-w-md space-y-3 p-8 text-center">
            <button type="button" className="absolute right-3 top-3 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar aviso" onClick={() => setMensaje(null)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full ${mensaje.ok ? (mensaje.espera ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700") : "bg-red-100 text-red-700"}`}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {mensaje.ok ? <path d="M20 6L9 17l-5-5" /> : <path d="M18 6 6 18M6 6l12 12" />}
              </svg>
            </div>
            <p className="text-2xl font-bold">{mensaje.texto}</p>
            {mensaje.detalle && <p className="text-slate-600">{mensaje.detalle}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
