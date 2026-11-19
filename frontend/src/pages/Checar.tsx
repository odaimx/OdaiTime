import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import Camara from "../components/Camara";
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
              {c.sucursal.clave} · {c.sucursal.nombre}
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

  return (
    <>
    <PageHeader icono="fingerprint-pattern" title="Checar" />
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex flex-col items-center rounded-3xl bg-navy-900 p-6 text-center text-white">
        <FotoUsuario className="mb-4 h-36 w-36" />
        <p className="text-sm text-slate-300">Hola, {usuario?.nombre.split(" ")[0]}</p>
        <p className="mt-1 text-5xl font-bold tracking-tight tabular-nums">
          {ahora.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: tz })}
          <span className="text-2xl text-slate-400">:{String(ahora.getSeconds()).padStart(2, "0")}</span>
        </p>
        <p className="mt-1 text-sm capitalize text-slate-300">{ahora.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: tz })}</p>
      </div>

      {estado && (
        <div className="card space-y-3 p-4">
          <div>
            <p className="text-xs text-slate-500">Sucursal</p>
            <p className="font-medium text-tinta-900">
              <span className="font-mono text-brand-600">{estado.sucursal.clave}</span> {estado.sucursal.nombre}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Turno de hoy</p>
            <p className="font-medium text-tinta-900">
              {estado.turno
                ? `${estado.turno.nombre} · ${estado.turno.bloques.map((b) => `${hora(b.entrada, tz)} – ${hora(b.salida, tz)}`).join(" y ")}`
                : "Hoy no tienes turno asignado"}
            </p>
          </div>
        </div>
      )}

      {estado && (
        <div className="space-y-2 text-sm">
          {estado.requiere.gps && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">Se validará que estés dentro de tu sucursal (ubicación).</p>}
          {estado.requiere.foto && <p className="rounded-xl bg-brand-50 px-3 py-2 text-brand-700">Tu empresa pide una foto al checar.</p>}
          {qr && <p className="rounded-xl bg-accent-500/10 px-3 py-2 text-tinta-900">Código del kiosco leído. Toca el botón para registrar.</p>}
          {estado.festivo_hoy && estado.designado_festivo && <p className="rounded-xl bg-sky-50 px-3 py-2 text-sky-800">Hoy es {estado.festivo_hoy}: estás designado para trabajar.</p>}
          {pendientes > 0 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">{pendientes} checada(s) guardada(s) sin conexión; se enviarán al reconectar.</p>}
        </div>
      )}

      <ErrorBox message={error} />

      {estado?.festivo_hoy && !estado.designado_festivo ? (
        <div className="card space-y-2 p-6 text-center">
          <p className="text-lg font-semibold text-tinta-900">Hoy es día de descanso</p>
          <p className="text-sm text-slate-600">
            {estado.festivo_hoy}. No necesitas checar. Solo registra asistencia el personal que la empresa designó para trabajar.
          </p>
        </div>
      ) : estado && !estado.permitir_movil && !qr ? (
        <p className="card p-6 text-center text-slate-600">En tu sucursal se checa en el kiosco de la entrada.</p>
      ) : necesitaQr ? (
        <div className="card space-y-3 p-6 text-center">
          <p className="text-lg font-semibold text-tinta-900">Escanea el QR del kiosco</p>
          <p className="text-sm text-slate-600">Abre la cámara de tu teléfono y apunta al código de la tablet de tu sucursal. Se abrirá esta app lista para checar.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center py-4">
          <button
            onClick={iniciar}
            disabled={!estado || paso === "enviando"}
            className="flex h-52 w-52 flex-col items-center justify-center gap-2 rounded-full border-[10px] border-brand-100 bg-brand-500 text-white shadow-xl shadow-brand-500/30 transition active:scale-95 disabled:opacity-60"
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {estado?.siguiente_tipo === "salida" ? <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /> : <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />}
            </svg>
            <span className="text-xl font-bold">{paso === "enviando" ? "Registrando…" : estado?.siguiente_tipo === "salida" ? "Registrar salida" : "Registrar entrada"}</span>
          </button>
        </div>
      )}

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
