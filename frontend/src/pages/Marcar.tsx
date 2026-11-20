import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import Camara from "../components/Camara";
import EscanerQR from "../components/EscanerQR";
import Icono from "../components/Iconos";
import PantallaChecado, { ACCIONES, type Accion, type MarcaHoy } from "../components/PantallaChecado";
import { comprimir, urlLogo, type EstadoHoy, type TenantInfo } from "../lib/api";

/**
 * Checado público (sin usuario ni contraseña), en una sola dirección: /marcar.
 *  - Kiosco (QR): se escanea el QR de la tablet, se escribe número + PIN; ubicación y selfie siempre.
 *  - Celular: se vincula una vez con número de empleado o celular + PIN y queda pendiente hasta que
 *    un administrador lo aprueba; después cada checada pide PIN + ubicación + selfie.
 */

type Posicion = { latitud: string; longitud: string; precision: string };
type Modo = "qr" | "celular";
type Resultado = { ok: boolean; texto: string; detalle?: string };

const TOKEN = "odaitime.celular";
const AVISO = "odaitime.aviso_privacidad.v1";

const leer = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const escribir = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* almacenamiento bloqueado */
  }
};

function ubicar(): Promise<Posicion> {
  return new Promise((ok, mal) => {
    if (!navigator.geolocation) return mal(new Error("Tu teléfono no permite obtener la ubicación."));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        ok({
          latitud: p.coords.latitude.toFixed(6),
          longitud: p.coords.longitude.toFixed(6),
          precision: String(Math.round(p.coords.accuracy)),
        }),
      (e) =>
        mal(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? "Permite el acceso a tu ubicación para checar (configuración del navegador)."
              : "No se pudo obtener tu ubicación. Intenta de nuevo.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

/** Petición sin sesión: devuelve el JSON o lanza el mensaje del servidor (con su código). */
class ErrorPublico extends Error {
  constructor(
    public status: number,
    message: string,
    public codigo?: string,
  ) {
    super(message);
  }
}
async function pedir<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let r: Response;
  try {
    r = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ErrorPublico(0, "Sin conexión. Revisa tu internet e intenta de nuevo.");
  }
  const datos = await r.json().catch(() => null);
  if (!r.ok) {
    const d = datos?.detail;
    const texto = typeof d === "string" ? d : Array.isArray(d) ? "Revisa los datos e intenta de nuevo." : (d?.mensaje ?? "No se pudo completar.");
    throw new ErrorPublico(r.status, texto, typeof d === "object" && d && !Array.isArray(d) ? d.codigo : undefined);
  }
  return datos as T;
}
const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : "No se pudo completar.");

const horaDe = (iso: string, tz?: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: tz });

function resultadoDe(r: { tipo: string; comida?: boolean; momento: string; retardo_minutos: number | null }, tz?: string): Resultado {
  const accion: Accion = r.comida ? (r.tipo === "salida" ? "salida_comida" : "regreso_comida") : (r.tipo as Accion);
  const retardo = r.retardo_minutos ? ` · ${r.retardo_minutos} min de retardo` : "";
  return { ok: true, texto: ACCIONES[accion].listo, detalle: `${horaDe(r.momento, tz)}${retardo}` };
}

function FotoCirculo({ src, nombre }: { src: string | null; nombre: string }) {
  return src ? (
    <img src={src} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-white" />
  ) : (
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-700">{nombre.slice(0, 1).toUpperCase() || "?"}</span>
  );
}

function Aviso({ resultado, onCerrar }: { resultado: Resultado; onCerrar: () => void }) {
  useEffect(() => {
    const t = setTimeout(onCerrar, resultado.ok ? 5000 : 7000);
    return () => clearTimeout(t);
  }, [resultado, onCerrar]);
  return (
    <div role="status" className={`card flex items-center gap-3 p-4 ${resultado.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
      <Icono nombre={resultado.ok ? "check" : "triangle-exclamation-point"} className="h-7 w-7 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{resultado.texto}</p>
        {resultado.detalle && <p className="text-sm opacity-80">{resultado.detalle}</p>}
      </div>
      <button type="button" onClick={onCerrar} className="rounded p-1 opacity-60 hover:opacity-100" aria-label="Cerrar">
        <Icono nombre="x" className="h-5 w-5" />
      </button>
    </div>
  );
}

/** Campo de PIN: solo dígitos, oculto. */
function CampoPin({ valor, onCambio, autoFocus }: { valor: string; onCambio: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      className="input text-center font-mono text-2xl tracking-[0.5em]"
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={6}
      minLength={4}
      required
      autoFocus={autoFocus}
      placeholder="••••"
      value={valor}
      onChange={(e) => onCambio(e.target.value.replace(/\D/g, ""))}
    />
  );
}

// ------------------------------------------------------------------ Aviso de privacidad

function AvisoPrivacidad({ empresa, onAceptar }: { empresa: string; onAceptar: () => void }) {
  const [acepto, setAcepto] = useState(false);
  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
          <Icono nombre="lock" className="h-5 w-5" />
        </span>
        <h2 className="text-lg font-semibold text-tinta-900">Aviso de privacidad</h2>
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto text-sm leading-relaxed text-slate-600">
        <p>
          <strong>{empresa || "Tu empleador"}</strong> es responsable de los datos personales que se recaban al registrar tu asistencia, conforme a la Ley Federal de Protección de Datos
          Personales en Posesión de los Particulares.
        </p>
        <p>
          <strong>Datos que se recaban:</strong> tu número de empleado, una fotografía en el momento de checar y la ubicación de tu dispositivo únicamente en ese momento (no se te
          rastrea en otro momento). En el celular también se guarda un identificador del equipo vinculado.
        </p>
        <p>
          <strong>Finalidad:</strong> llevar el registro de tu jornada laboral (entradas, salidas y descansos) que exige la Ley Federal del Trabajo (arts. 132 y 804), y comprobar que la
          checada la hizo la persona correcta en el lugar de trabajo.
        </p>
        <p>
          <strong>Conservación:</strong> las checadas se conservan el tiempo que marca la ley; las fotografías se eliminan pasado el plazo que fije la empresa.
        </p>
        <p>
          <strong>Derechos ARCO:</strong> puedes pedir acceso, rectificación, cancelación u oposición al tratamiento de tus datos con el área de Recursos Humanos de tu empresa.
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} />
        <span>He leído el aviso de privacidad y acepto el tratamiento de mis datos para el registro de asistencia.</span>
      </label>
      <button type="button" className="btn-primary w-full py-3" disabled={!acepto} onClick={onAceptar}>
        Continuar
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Kiosco (QR)

interface Identificado {
  sesion: string;
  empleado: { nombre: string; nombre_completo: string; numero: string; puesto: string | null };
  foto: string | null;
  checadas: MarcaHoy[];
  acciones: { accion: Accion; habilitada: boolean }[];
}

function ConQR({ qr, onQr }: { qr: string | null; onQr: (qr: string | null) => void }) {
  const [numero, setNumero] = useState("");
  const [pin, setPin] = useState("");
  const [pos, setPos] = useState<Posicion | null>(null);
  const [quien, setQuien] = useState<Identificado | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ahora, setAhora] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  function leido(valor: string) {
    try {
      const token = new URL(valor, window.location.origin).searchParams.get("qr");
      if (token) return onQr(token);
    } catch {
      /* no es URL */
    }
    setResultado({ ok: false, texto: "Ese código no es el QR de un kiosco." });
  }

  const terminar = useCallback(() => {
    setQuien(null);
    setAccion(null);
    setPin("");
    setNumero("");
    onQr(null); // el QR cambia cada 30 s: para otra checada se vuelve a escanear
  }, [onQr]);

  async function identificar(e: FormEvent) {
    e.preventDefault();
    if (!qr) return;
    setOcupado(true);
    setResultado(null);
    try {
      const p = await ubicar();
      setPos(p);
      const datos = await pedir<Identificado>("/publico/qr/identificar", {
        method: "POST",
        body: JSON.stringify({ qr, numero, pin, latitud: Number(p.latitud), longitud: Number(p.longitud), precision: Number(p.precision) }),
      });
      setQuien(datos);
    } catch (err) {
      setPin("");
      setResultado({ ok: false, texto: mensajeDe(err) });
      if (err instanceof ErrorPublico && err.codigo === "qr_invalido") onQr(null);
    } finally {
      setOcupado(false);
    }
  }

  async function enviar(foto: Blob) {
    if (!quien || !accion || !pos) return;
    setAccion(null);
    setOcupado(true);
    try {
      const body = new FormData();
      body.append("sesion", quien.sesion);
      body.append("accion", accion);
      body.append("latitud", pos.latitud);
      body.append("longitud", pos.longitud);
      body.append("precision", pos.precision);
      body.append("foto", await comprimir(foto), "selfie.webp");
      const r = await pedir<{ tipo: string; comida: boolean; momento: string; retardo_minutos: number | null }>("/publico/qr/checar", { method: "POST", body });
      setResultado({ ...resultadoDe(r), texto: `${resultadoDe(r).texto}, ${quien.empleado.nombre}` });
      terminar();
    } catch (err) {
      setResultado({ ok: false, texto: mensajeDe(err) });
      if (err instanceof ErrorPublico && err.status === 401) terminar();
    } finally {
      setOcupado(false);
    }
  }

  if (accion) return <Camara titulo={`${ACCIONES[accion].titulo}: centra tu rostro`} onFoto={enviar} onCancelar={() => setAccion(null)} />;

  return (
    <div className="space-y-4">
      {resultado && <Aviso resultado={resultado} onCerrar={() => setResultado(null)} />}
      {quien ? (
        <>
          <PantallaChecado
            nombre={quien.empleado.nombre_completo}
            subtitulo={quien.empleado.puesto ?? `No. ${quien.empleado.numero}`}
            foto={<FotoCirculo src={quien.foto} nombre={quien.empleado.nombre} />}
            marcas={quien.checadas}
            acciones={quien.acciones}
            ahora={ahora}
            ocupado={ocupado}
            onAccion={setAccion}
          />
          <button type="button" className="btn-secondary w-full" onClick={terminar}>
            Cancelar
          </button>
        </>
      ) : !qr ? (
        <div className="card space-y-3 p-5">
          <p className="text-center text-sm text-slate-600">Apunta la cámara al QR que aparece en la tablet del kiosco.</p>
          <EscanerQR onLeido={leido} />
        </div>
      ) : (
        <form onSubmit={identificar} className="card space-y-4 p-6">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <Icono nombre="check" className="h-4 w-4" /> QR del kiosco leído
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Número de empleado</span>
            <input className="input text-lg" inputMode="numeric" autoComplete="off" required autoFocus value={numero} onChange={(e) => setNumero(e.target.value.trim())} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">PIN</span>
            <CampoPin valor={pin} onCambio={setPin} />
          </label>
          <p className="text-xs text-slate-500">Se registrará tu ubicación y una selfie al checar.</p>
          <button className="btn-primary w-full py-3" disabled={ocupado}>
            {ocupado ? "Verificando…" : "Continuar"}
          </button>
          <button type="button" className="btn-secondary w-full" onClick={() => onQr(null)}>
            Escanear otro QR
          </button>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Celular vinculado

interface EstadoCelular {
  estado: "pendiente" | "aprobado" | "revocado";
  nombre: string;
  hoy: EstadoHoy | null;
}

function ConCelular({ slug }: { slug: string | null }) {
  const [token, setToken] = useState<string | null>(() => leer(TOKEN));
  const [estado, setEstado] = useState<EstadoCelular | null>(null);
  const [identificador, setIdentificador] = useState("");
  const [pin, setPin] = useState("");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [pedirPin, setPedirPin] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ahora, setAhora] = useState(new Date());

  const olvidar = useCallback(() => {
    escribir(TOKEN, null);
    setToken(null);
    setEstado(null);
  }, []);

  const cargar = useCallback(async () => {
    if (!token) return;
    try {
      setEstado(await pedir<EstadoCelular>("/publico/celular/estado", { headers: { "X-Celular-Token": token } }));
    } catch (err) {
      if (err instanceof ErrorPublico && err.status === 401) {
        olvidar();
        setResultado({ ok: false, texto: "Este celular ya no está vinculado. Vincúlalo de nuevo." });
      } else setResultado({ ok: false, texto: mensajeDe(err) });
    }
  }, [token, olvidar]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Mientras está pendiente, revisa cada 20 s si ya lo aprobaron.
  useEffect(() => {
    if (estado?.estado !== "pendiente") return;
    const t = setInterval(cargar, 20_000);
    return () => clearInterval(t);
  }, [estado, cargar]);

  async function vincular(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setResultado(null);
    try {
      const r = await pedir<{ token: string; estado: string; nombre: string }>("/publico/celular/vincular", {
        method: "POST",
        body: JSON.stringify({ empresa: slug, identificador, pin, equipo: navigator.userAgent.slice(0, 200) }),
      });
      escribir(TOKEN, r.token);
      setToken(r.token);
      setPin("");
    } catch (err) {
      setPin("");
      setResultado({ ok: false, texto: mensajeDe(err) });
    } finally {
      setOcupado(false);
    }
  }

  function elegir(a: Accion) {
    setAccion(a);
    setPin("");
    setPedirPin(true);
  }

  async function enviar(foto: Blob) {
    if (!token || !accion) return;
    const a = accion;
    setAccion(null);
    setOcupado(true);
    try {
      const p = await ubicar();
      const body = new FormData();
      body.append("pin", pin);
      body.append("accion", a);
      body.append("latitud", p.latitud);
      body.append("longitud", p.longitud);
      body.append("precision", p.precision);
      body.append("foto", await comprimir(foto), "selfie.webp");
      const r = await pedir<{ tipo: string; comida: boolean; momento: string; retardo_minutos: number | null }>("/publico/celular/checar", {
        method: "POST",
        headers: { "X-Celular-Token": token },
        body,
      });
      setResultado(resultadoDe(r, estado?.hoy?.sucursal.zona_horaria));
      await cargar();
    } catch (err) {
      setResultado({ ok: false, texto: mensajeDe(err) });
      if (err instanceof ErrorPublico && err.status === 401 && err.codigo !== "credenciales" && err.codigo !== "bloqueado") olvidar();
    } finally {
      setPin("");
      setOcupado(false);
    }
  }

  if (accion && !pedirPin) return <Camara titulo={`${ACCIONES[accion].titulo}: centra tu rostro`} onFoto={enviar} onCancelar={() => setAccion(null)} />;

  let cuerpo: ReactNode;
  if (!token) {
    cuerpo = (
      <form onSubmit={vincular} className="card space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold text-tinta-900">Vincular este celular</h2>
          <p className="mt-1 text-sm text-slate-500">Solo se hace una vez. Tu administrador deberá aprobarlo antes de que puedas checar.</p>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Número de empleado o celular</span>
          <input className="input text-lg" inputMode="tel" autoComplete="off" required autoFocus value={identificador} onChange={(e) => setIdentificador(e.target.value.trim())} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">PIN</span>
          <CampoPin valor={pin} onCambio={setPin} />
        </label>
        <button className="btn-primary w-full py-3" disabled={ocupado}>
          {ocupado ? "Vinculando…" : "Vincular"}
        </button>
      </form>
    );
  } else if (!estado) {
    cuerpo = <p className="card p-6 text-center text-sm text-slate-500">Cargando…</p>;
  } else if (estado.estado !== "aprobado" || !estado.hoy) {
    cuerpo = (
      <div className="card space-y-4 p-6 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <Icono nombre="clock" className="h-7 w-7" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-tinta-900">Hola, {estado.nombre}</h2>
          <p className="mt-1 text-sm text-slate-600">Tu celular está pendiente de aprobación. Pide a tu administrador o gerente que lo apruebe en tu ficha de empleado.</p>
        </div>
        <button type="button" className="btn-primary w-full" onClick={cargar}>
          Ya lo aprobaron
        </button>
        <button type="button" className="text-sm text-slate-500 underline" onClick={olvidar}>
          Vincular con otros datos
        </button>
      </div>
    );
  } else {
    const hoy = estado.hoy;
    const acciones = (hoy.acciones ?? []) as { accion: Accion; habilitada: boolean }[];
    cuerpo = (
      <>
        <PantallaChecado
          nombre={hoy.empleado.nombre_completo}
          subtitulo={hoy.obra?.nombre ?? hoy.sucursal.nombre}
          foto={<FotoCirculo src={null} nombre={estado.nombre} />}
          marcas={hoy.checadas_hoy.filter((c) => c.estado === "valida").map((c) => ({ tipo: c.tipo, momento: c.momento, comida: c.comida }))}
          acciones={acciones}
          tz={hoy.sucursal.zona_horaria}
          ahora={ahora}
          ocupado={ocupado}
          onAccion={elegir}
        />
        {!hoy.permitir_movil && <p className="text-center text-sm text-amber-700">Tu empresa no tiene habilitado el checado por celular para ti.</p>}
        <p className="text-center text-xs text-slate-500">Al checar se registra tu ubicación y una selfie.</p>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {resultado && <Aviso resultado={resultado} onCerrar={() => setResultado(null)} />}
      {cuerpo}
      {pedirPin && accion && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <form
            className="card w-full max-w-sm space-y-4 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (pin.length >= 4) setPedirPin(false); // sigue la selfie
            }}
          >
            <h2 className="text-lg font-semibold text-tinta-900">{ACCIONES[accion].titulo}</h2>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">Escribe tu PIN</span>
              <CampoPin valor={pin} onCambio={setPin} autoFocus />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={() => {
                  setPedirPin(false);
                  setAccion(null);
                  setPin("");
                }}
              >
                Cancelar
              </button>
              <button className="btn-primary flex-1">Tomar selfie</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Página

export default function Marcar() {
  const [params, setParams] = useSearchParams();
  const qr = params.get("qr");
  const [modo, setModo] = useState<Modo>(() => (qr ? "qr" : leer(TOKEN) ? "celular" : "qr"));
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [slug, setSlug] = useState<string | null>(params.get("empresa"));
  const [aceptado, setAceptado] = useState(() => leer(AVISO) === "1");

  useEffect(() => {
    fetch("/api/tenant")
      .then((r) => (r.ok ? r.json() : null))
      .then((t: TenantInfo | null) => {
        setTenant(t);
        if (t?.modo === "tenant" && t.slug) setSlug(t.slug);
      })
      .catch(() => {});
  }, []);

  const cambiarQr = useCallback(
    (valor: string | null) => {
      const p = new URLSearchParams(params);
      if (valor) p.set("qr", valor);
      else p.delete("qr");
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  const pestaña = (m: Modo, etiqueta: string, icono: "qr-code" | "smartphone") => (
    <button
      type="button"
      onClick={() => setModo(m)}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
        modo === m ? "bg-white text-tinta-900 shadow" : "text-slate-500 hover:text-slate-700"
      }`}
      aria-pressed={modo === m}
    >
      <Icono nombre={icono} className="h-5 w-5" />
      {etiqueta}
    </button>
  );

  let contenido: ReactNode;
  if (tenant?.modo === "base") {
    contenido = <p className="card p-6 text-center text-sm text-slate-600">Entra desde la dirección de tu empresa para checar asistencia.</p>;
  } else if (!aceptado) {
    contenido = (
      <AvisoPrivacidad
        empresa={tenant?.nombre ?? ""}
        onAceptar={() => {
          escribir(AVISO, "1");
          setAceptado(true);
        }}
      />
    );
  } else if (modo === "celular" && !slug) {
    // Solo en instalaciones sin subdominio por empresa (desarrollo / modo libre).
    contenido = (
      <form
        className="card space-y-3 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          const v = new FormData(e.currentTarget).get("empresa");
          if (typeof v === "string" && v.trim()) setSlug(v.trim().toLowerCase());
        }}
      >
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Clave de tu empresa</span>
          <input name="empresa" className="input" required autoFocus />
        </label>
        <button className="btn-primary w-full">Continuar</button>
      </form>
    );
  } else {
    contenido = modo === "qr" ? <ConQR qr={qr} onQr={cambiarQr} /> : <ConCelular slug={slug} />;
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto w-full max-w-lg space-y-4 p-4 sm:py-8">
        <header className="flex items-center gap-3">
          {tenant?.empresa_id && tenant.logo_version ? (
            <img src={urlLogo(tenant.empresa_id, tenant.logo_version)} alt="" className="h-10 max-w-[8rem] object-contain" />
          ) : (
            <img src="/logo.png" alt="ODAI" className="h-8" />
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-tinta-900">{tenant?.nombre ?? "Checar asistencia"}</p>
            <p className="text-xs text-slate-500">Registro de asistencia</p>
          </div>
        </header>
        {aceptado && tenant?.modo !== "base" && (
          <nav className="flex gap-1 rounded-xl bg-slate-200 p-1">
            {pestaña("qr", "Kiosco (QR)", "qr-code")}
            {pestaña("celular", "Mi celular", "smartphone")}
          </nav>
        )}
        {contenido}
        <p className="pt-2 text-center text-xs text-slate-400">
          ¿Quieres ver tu historial o pedir vacaciones?{" "}
          <a href="/login" className="underline">
            Entra al portal
          </a>
        </p>
      </div>
    </div>
  );
}
