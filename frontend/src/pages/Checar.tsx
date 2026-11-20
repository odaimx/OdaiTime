import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import Camara from "../components/Camara";
import Icono, { type NombreIcono } from "../components/Iconos";
import { ErrorBox, FotoUsuario, PageHeader } from "../components/ui";
import { ApiError, comprimir, get, hora, postForm, type Checada, type EstadoHoy } from "../lib/api";
import { useAuth } from "../lib/auth";

type Posicion = { latitud: string; longitud: string; precision: string };
type Pendiente = { momento: string; pos: Posicion | null; qr: string | null; foto: string | null };

const COLA = "odaitime.pendientes";

function leerCola(): Pendiente[] {
  try {
    return JSON.parse(localStorage.getItem(COLA) ?? "[]");
  } catch {
    return [];
  }
}
function guardarCola(c: Pendiente[]) {
  try {
    localStorage.setItem(COLA, JSON.stringify(c));
  } catch {
    /* almacenamiento lleno o bloqueado */
  }
}

const aDataUrl = (b: Blob) =>
  new Promise<string>((ok) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.readAsDataURL(b);
  });
const deDataUrl = async (u: string) => (await fetch(u)).blob();

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

type Metodo = "celular" | "qr" | "kiosco";
const METODOS: Record<Metodo, { etiqueta: string; icono: NombreIcono }> = {
  celular: { etiqueta: "Celular", icono: "smartphone" },
  qr: { etiqueta: "QR del kiosco", icono: "qr-code" },
  kiosco: { etiqueta: "Kiosco", icono: "monitor" },
};

/** Lector del QR del kiosco con la cámara (en navegadores con BarcodeDetector, como Chrome en Android). */
function EscanerQR({ onLeido }: { onLeido: (valor: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problema, setProblema] = useState<"soporte" | "camara" | null>(null);
  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setProblema("soporte");
      return;
    }
    const detector = new Detector({ formats: ["qr_code"] });
    let flujo: MediaStream | null = null;
    let vivo = true;
    let t = 0;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        flujo = s;
        if (!vivo || !video.current) return s.getTracks().forEach((x) => x.stop());
        video.current.srcObject = s;
        void video.current.play();
        const leer = async () => {
          if (!vivo || !video.current) return;
          try {
            const r = await detector.detect(video.current);
            if (r[0]?.rawValue) return onLeido(r[0].rawValue);
          } catch {
            /* sigue intentando */
          }
          t = window.setTimeout(leer, 300);
        };
        void leer();
      })
      .catch(() => setProblema("camara"));
    return () => {
      vivo = false;
      clearTimeout(t);
      flujo?.getTracks().forEach((x) => x.stop());
    };
  }, [onLeido]);

  if (problema)
    return (
      <div className="card space-y-2 p-6 text-center">
        <p className="text-lg font-semibold text-tinta-900">Escanea el QR del kiosco</p>
        <p className="text-sm text-slate-600">
          {problema === "camara" ? "Permite el acceso a la cámara para leer el código, o " : ""}
          Abre la cámara de tu teléfono y apunta al código de la tablet de tu sucursal; se abrirá esta app lista para checar.
        </p>
      </div>
    );
  return (
    <div className="space-y-2 text-center">
      <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-3xl bg-black">
        <video ref={video} className="h-full w-full object-cover" playsInline muted />
        <div className="pointer-events-none absolute inset-8 rounded-2xl border-4 border-white/80" />
      </div>
      <p className="text-sm text-slate-600">Apunta al QR de la tablet de tu sucursal.</p>
    </div>
  );
}

export default function Checar() {
  const { usuario } = useAuth();
  const [params, setParams] = useSearchParams();
  const qr = params.get("qr");
  const [estado, setEstado] = useState<EstadoHoy | null>(null);
  const [ahora, setAhora] = useState(new Date());
  const [paso, setPaso] = useState<"inicio" | "camara" | "enviando" | "listo">("inicio");
  const [resultado, setResultado] = useState<{ checada?: Checada; offline?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(leerCola().length);
  const [metodo, setMetodo] = useState<Metodo | null>(null);

  const cargar = useCallback(() => {
    get<EstadoHoy>("/checadas/hoy")
      .then(setEstado)
      .catch((e) => setError((e as Error).message));
  }, []);

  // Envía lo que quedó guardado sin conexión.
  const sincronizar = useCallback(async () => {
    const cola = leerCola();
    if (!cola.length || !navigator.onLine) return;
    const restantes: Pendiente[] = [];
    for (const p of cola) {
      try {
        await postForm("/checadas", {
          ...(p.pos ?? {}),
          qr: p.qr,
          offline: "true",
          momento: p.momento,
          foto: p.foto ? await deDataUrl(p.foto) : null,
        });
      } catch (e) {
        // Error de red: se reintenta después. Rechazo del servidor: se descarta.
        if (!(e instanceof ApiError)) restantes.push(p);
      }
    }
    guardarCola(restantes);
    setPendientes(restantes.length);
    cargar();
  }, [cargar]);

  useEffect(() => {
    cargar();
    sincronizar();
    const t = setInterval(() => setAhora(new Date()), 1000);
    window.addEventListener("online", sincronizar);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", sincronizar);
    };
  }, [cargar, sincronizar]);

  const tz = estado?.sucursal.zona_horaria;
  const necesitaQr = estado?.requiere.qr && !qr;

  function iniciar() {
    setError(null);
    if (estado?.requiere.foto) setPaso("camara");
    else enviar(null);
  }

  async function enviar(foto: Blob | null) {
    setPaso("enviando");
    setError(null);
    const momento = new Date().toISOString();
    let pos: Posicion | null = null;
    try {
      if (estado?.requiere.gps) pos = await ubicar();
      else pos = await ubicar().catch(() => null);
    } catch (e) {
      setError((e as Error).message);
      setPaso("inicio");
      return;
    }
    const fotoC = foto ? await comprimir(foto) : null;
    try {
      const checada = await postForm<Checada>("/checadas", { ...(pos ?? {}), qr, foto: fotoC });
      setResultado({ checada });
      setPaso("listo");
      if (qr) setParams({}, { replace: true });
      cargar();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setPaso("inicio");
      } else if (estado?.permitir_offline) {
        // Sin conexión: se guarda en el teléfono con la hora real.
        const cola = [...leerCola(), { momento, pos, qr, foto: fotoC ? await aDataUrl(fotoC) : null }];
        guardarCola(cola);
        setPendientes(cola.length);
        setResultado({ offline: true });
        setPaso("listo");
      } else {
        setError("Sin conexión. Conéctate a internet para checar.");
        setPaso("inicio");
      }
    }
  }

  if (paso === "camara") {
    return <Camara onFoto={(b) => enviar(b)} onCancelar={() => setPaso("inicio")} />;
  }

  if (paso === "listo" && resultado) {
    const c = resultado.checada;
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-5 text-center">
        <div className={`flex h-24 w-24 items-center justify-center rounded-full ${resultado.offline ? "bg-amber-100" : "bg-emerald-100"}`}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={resultado.offline ? "#b45309" : "#047857"} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        {c ? (
          <>
            <p className="text-slate-500">{c.tipo === "entrada" ? "Entrada registrada" : "Salida registrada"}</p>
            <p className="text-6xl font-bold tracking-tight text-tinta-900">{hora(c.momento, tz)}</p>
            {c.tipo === "entrada" && (
              <span className={`rounded-full px-3 py-1 text-sm font-medium ${c.retardo_minutos ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                {c.retardo_minutos ? `Retardo de ${c.retardo_minutos} min` : "A tiempo"}
              </span>
            )}
            <p className="text-sm text-slate-500">
              {c.obra ? `${c.obra.clave} · ${c.obra.nombre}` : `${c.sucursal.clave} · ${c.sucursal.nombre}`}
              {c.distancia_m != null && ` · a ${c.distancia_m} m`}
            </p>
          </>
        ) : (
          <>
            <p className="text-xl font-semibold text-tinta-900">Checada guardada sin conexión</p>
            <p className="max-w-xs text-sm text-slate-600">Se enviará sola en cuanto tu teléfono tenga internet. Conserva la hora en que checaste.</p>
          </>
        )}
        <button className="btn-primary mt-4 w-full max-w-xs bg-navy-900 py-3 hover:bg-navy-800" onClick={() => setPaso("inicio")}>
          Listo
        </button>
      </div>
    );
  }

  // Métodos de checado del empleado: cada uno en su pantalla, elegido en la banda de arriba.
  const metodos: Metodo[] = !estado
    ? []
    : [
        ...(estado.permitir_movil && !estado.requiere.qr ? (["celular"] as const) : []),
        ...(estado.permitir_movil ? (["qr"] as const) : []),
        ...(estado.permitir_kiosco ? (["kiosco"] as const) : []),
      ];
  const actual: Metodo | null = qr ? "celular" : metodo && metodos.includes(metodo) ? metodo : (metodos[0] ?? null);
  const descanso = !!estado?.festivo_hoy && !estado.designado_festivo;

  function leido(valor: string) {
    let codigo: string | null = null;
    try {
      codigo = new URL(valor).searchParams.get("qr");
    } catch {
      codigo = null;
    }
    if (!codigo) return setError("Ese código no es el QR de un kiosco de ODAITIME.");
    setError(null);
    setParams({ qr: codigo }, { replace: true });
  }

  return (
    <>
      <PageHeader
        icono="fingerprint-pattern"
        title="Checar"
        submenu={
          metodos.length > 1
            ? metodos.map((m) => ({ etiqueta: METODOS[m].etiqueta, icono: METODOS[m].icono, activo: actual === m, onClick: () => (setMetodo(m), qr && setParams({}, { replace: true })) }))
            : undefined
        }
      />
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center gap-4 rounded-3xl bg-navy-900 p-4 text-white">
          <FotoUsuario className="h-20 w-20" />
          <div className="min-w-0">
            <p className="truncate text-sm text-slate-300">Hola, {usuario?.nombre.split(" ")[0]}</p>
            <p className="text-4xl font-bold tracking-tight tabular-nums">
              {ahora.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: tz })}
              <span className="text-lg text-slate-400">:{String(ahora.getSeconds()).padStart(2, "0")}</span>
            </p>
            <p className="text-xs capitalize text-slate-300">{ahora.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: tz })}</p>
          </div>
        </div>

        <ErrorBox message={error} />

        {!estado ? (
          <p className="text-center text-sm text-slate-500">Cargando…</p>
        ) : descanso ? (
          <div className="card space-y-2 p-6 text-center">
            <p className="text-lg font-semibold text-tinta-900">Hoy es día de descanso</p>
            <p className="text-sm text-slate-600">{estado.festivo_hoy}. No necesitas checar. Solo registra asistencia el personal que la empresa designó para trabajar.</p>
          </div>
        ) : actual === "celular" ? (
          <div className="flex flex-col items-center gap-3 py-2">
            {qr && <p className="rounded-xl bg-accent-500/10 px-3 py-2 text-sm text-tinta-900">Código del kiosco leído. Toca el botón para registrar.</p>}
            <button
              onClick={iniciar}
              disabled={paso === "enviando"}
              className="flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-full border-[10px] border-brand-100 bg-brand-500 text-white shadow-xl shadow-brand-500/30 transition active:scale-95 disabled:opacity-60"
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {estado.siguiente_tipo === "salida" ? <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /> : <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />}
              </svg>
              <span className="text-xl font-bold">{paso === "enviando" ? "Registrando…" : estado.siguiente_tipo === "salida" ? "Registrar salida" : "Registrar entrada"}</span>
            </button>
            <p className="text-center text-xs text-slate-500">
              {[estado.requiere.gps && `Se valida tu ubicación en ${estado.obra ? `la zona ${estado.obra.nombre}` : "tu sucursal"}`, estado.requiere.foto && "se toma una foto"].filter(Boolean).join(" y ")}
            </p>
          </div>
        ) : actual === "qr" ? (
          <EscanerQR onLeido={leido} />
        ) : actual === "kiosco" ? (
          <div className="card space-y-3 p-6 text-center">
            <Icono nombre="monitor" className="mx-auto h-10 w-10 text-brand-500" />
            <p className="text-lg font-semibold text-tinta-900">Checa en el kiosco de tu sucursal</p>
            <p className="text-sm text-slate-600">
              En la tablet escribe tu número de empleado <strong className="font-mono text-tinta-900">{estado.empleado.numero}</strong> y tu PIN.
            </p>
          </div>
        ) : (
          <p className="card p-6 text-center text-slate-600">No tienes un medio de checado asignado. Pregunta a tu administrador.</p>
        )}

        {estado && (
          <div className="card grid grid-cols-2 gap-3 p-4 text-sm">
            <div className="min-w-0">
              <p className="text-xs text-slate-500">{estado.obra ? "Zona de hoy" : "Sucursal"}</p>
              <p className="truncate font-medium text-tinta-900">{estado.obra ? estado.obra.nombre : estado.sucursal.nombre}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Turno de hoy</p>
              <p className="truncate font-medium text-tinta-900">{estado.turno ? estado.turno.bloques.map((b) => `${hora(b.entrada, tz)}–${hora(b.salida, tz)}`).join(" y ") : "Sin turno"}</p>
            </div>
          </div>
        )}

        {pendientes > 0 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{pendientes} checada(s) guardada(s) sin conexión; se enviarán al reconectar.</p>}

        {estado && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Hoy</p>
            {estado.checadas_hoy.length === 0 ? (
              <p className="text-sm text-slate-400">Aún no tienes registros.</p>
            ) : (
              <ul className="card divide-y divide-slate-100">
                {estado.checadas_hoy.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="font-medium capitalize text-tinta-900">{c.tipo}</span>
                    <span className="tabular-nums text-slate-600">
                      {hora(c.momento, tz)}
                      {c.offline && <span className="ml-2 text-xs text-amber-700">sin conexión</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}
