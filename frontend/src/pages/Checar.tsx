import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import AvisoPrivacidad, { type DatosAviso } from "../components/AvisoPrivacidad";
import Camara from "../components/Camara";
import EscanerQR from "../components/EscanerQR";
import PantallaChecado, { ACCIONES, type Accion } from "../components/PantallaChecado";
import Icono, { type NombreIcono } from "../components/Iconos";
import { ErrorBox, FotoUsuario, PageHeader } from "../components/ui";
import { ApiError, api, comprimir, get, hora, postForm, type Checada, type EstadoHoy } from "../lib/api";
import { useAuth } from "../lib/auth";

type Posicion = { latitud: string; longitud: string; precision: string };
type Pendiente = { momento: string; pos: Posicion | null; qr: string | null; foto: string | null; accion?: Accion | null };

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
  const [accion, setAccion] = useState<Accion | null>(null);
  const [datosAviso, setDatosAviso] = useState<DatosAviso | null>(null);

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
          accion: p.accion ?? null,
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

  // Aviso de privacidad pendiente: se muestra antes de los botones.
  useEffect(() => {
    if (estado?.aviso_aceptado === false && !datosAviso) get<DatosAviso>("/checadas/aviso").then(setDatosAviso).catch(() => null);
  }, [estado, datosAviso]);

  async function aceptarAviso() {
    try {
      await api("/checadas/aviso", { method: "POST" });
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

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

  function iniciar(a: Accion) {
    setError(null);
    setAccion(a);
    setPaso("camara"); // la selfie siempre se toma (protección contra checar por otro)
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
      const checada = await postForm<Checada>("/checadas", { ...(pos ?? {}), qr, accion, foto: fotoC });
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
        const cola = [...leerCola(), { momento, pos, qr, accion, foto: fotoC ? await aDataUrl(fotoC) : null }];
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
    return <Camara titulo="Mira a la cámara" onFoto={(b) => enviar(b)} onCancelar={() => setPaso("inicio")} />;
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
            <p className="text-slate-500">{accion ? ACCIONES[accion].listo : c.tipo === "entrada" ? "Entrada registrada" : "Salida registrada"}</p>
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
        <div className="flex items-center justify-between gap-4 rounded-3xl bg-navy-900 px-5 py-4 text-white">
          <p className="truncate text-sm text-slate-300">Hola, {usuario?.nombre.split(" ")[0]}</p>
          <div className="min-w-0 text-right">
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
        ) : estado.aviso_aceptado === false ? (
          <AvisoPrivacidad datos={datosAviso} empresa={usuario?.empresa?.nombre} onAceptar={aceptarAviso} />
        ) : descanso ? (
          <div className="card space-y-2 p-6 text-center">
            <p className="text-lg font-semibold text-tinta-900">Hoy es día de descanso</p>
            <p className="text-sm text-slate-600">{estado.festivo_hoy}. No necesitas checar. Solo registra asistencia el personal que la empresa designó para trabajar.</p>
          </div>
        ) : actual === "celular" ? (
          <div className="space-y-3">
            {qr && <p className="rounded-xl bg-accent-500/10 px-3 py-2 text-sm text-tinta-900">Código del kiosco leído. Elige qué vas a registrar.</p>}
            <PantallaChecado
              nombre={estado.empleado.nombre_completo}
              subtitulo={estado.obra ? `Zona ${estado.obra.nombre}` : `${estado.sucursal.clave} · ${estado.sucursal.nombre}`}
              foto={<FotoUsuario className="h-16 w-16" />}
              marcas={estado.checadas_hoy.filter((c) => c.estado === "valida")}
              acciones={estado.acciones ?? []}
              tz={tz}
              ahora={ahora}
              ocupado={paso === "enviando"}
              onAccion={iniciar}
            />
            <p className="text-center text-xs text-slate-500">
              {[estado.requiere.gps && `Se valida tu ubicación en ${estado.obra ? `la zona ${estado.obra.nombre}` : "tu sucursal"}`, "se toma una selfie"].filter(Boolean).join(" y ")}.
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
