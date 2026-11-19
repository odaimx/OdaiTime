import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { ErrorBox } from "../components/ui";
import { ApiError, AVISO_BLOQUEO, urlLogo, type TenantInfo } from "../lib/api";
import { estiloFondoApp, useTema } from "../lib/tema";
import Icono from "../components/Iconos";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const destino = (useLocation().state as { desde?: string } | null)?.desde ?? "/";
  const tema = useTema();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [noExiste, setNoExiste] = useState(false);
  const [redirigir, setRedirigir] = useState<{ mensaje: string; url: string } | null>(null);
  const [recuperando, setRecuperando] = useState(false);
  const [recuperado, setRecuperado] = useState<string | null>(null);

  async function recuperar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const r = await fetch("/api/auth/recuperar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const b = await r.json().catch(() => null);
      if (!r.ok) throw new Error(typeof b?.detail === "string" ? b.detail : "No se pudo enviar la solicitud.");
      setRecuperado(b.mensaje);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  useEffect(() => {
    // Si la sesión terminó porque la empresa se suspendió o venció, se explica aquí.
    try {
      const aviso = sessionStorage.getItem(AVISO_BLOQUEO);
      if (aviso) {
        setError(aviso);
        sessionStorage.removeItem(AVISO_BLOQUEO);
      }
    } catch {
      /* sin almacenamiento */
    }
    fetch("/api/tenant")
      .then((r) => {
        if (r.status === 404) setNoExiste(true);
        return r.ok ? r.json() : null;
      })
      .then((t) => {
        if (!t) return;
        setTenant(t);
        if (t.aviso) setError(t.aviso);
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setRedirigir(null);
    setEnviando(true);
    try {
      await login(email, password);
      navigate(destino, { replace: true });
    } catch (err) {
      const d = err instanceof ApiError ? (err.detalle as { codigo?: string; mensaje: string; url?: string }) : null;
      if (d?.codigo === "usar_subdominio" && d.url) setRedirigir({ mensaje: d.mensaje, url: d.url });
      else setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const imagenLogin = tema?.login_version ? `/api/sistema/imagen/login?v=${encodeURIComponent(tema.login_version)}` : null;
  const textoLogin = tema?.login_texto ?? "Checadas, retardos, horas extra y reportes apegados a la Ley Federal del Trabajo, para todas tus sucursales.";

  return (
    <div className="flex min-h-screen">
      {/* Panel izquierdo: imagen de Odai o, si no hay, el color del menú. */}
      <div
        className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-navy-950 p-12 lg:flex"
        style={imagenLogin ? { backgroundImage: `url(${imagenLogin})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {imagenLogin && <div className="absolute inset-0 bg-gradient-to-t from-navy-950/85 via-navy-950/30 to-transparent" />}
        <span />
        <div className="relative">
          <h2 className="text-4xl font-semibold leading-tight text-white">{tema?.login_titulo ?? "Control de asistencia"}</h2>
          <p className="text-4xl font-semibold leading-tight text-brand-500">{tema?.login_subtitulo ?? "claro y en regla."}</p>
          {textoLogin && <p className="mt-4 max-w-md whitespace-pre-line text-slate-200">{textoLogin}</p>}
        </div>
        <p className="relative text-xs text-slate-300">© {new Date().getFullYear()} Odai · Cancún, México</p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-50 p-6" style={estiloFondoApp(tema)}>
        <form onSubmit={recuperando ? recuperar : onSubmit} className="card w-full max-w-sm space-y-5 p-8">
          <div>
            <img src="/logo.png" alt="ODAI" className="mb-6 h-9 w-auto" />
            <h1 className="text-xl font-semibold text-tinta-900">{recuperando ? "Recuperar contraseña" : "Iniciar sesión"}</h1>
            {tenant?.empresa_id && tenant.logo_version && (
              <img src={urlLogo(tenant.empresa_id, tenant.logo_version)} alt={tenant.nombre ?? ""} className="my-3 max-h-16 max-w-[12rem] object-contain" />
            )}
            {tenant?.modo === "tenant" ? (
              <p className="mt-1 text-sm font-medium text-brand-600">{tenant.nombre}</p>
            ) : (
              <p className="mt-1 text-sm text-slate-500">{tenant?.modo === "base" ? "Panel de administración Odai" : "ODAITIME"}</p>
            )}
          </div>

          {noExiste && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
              Esta dirección no corresponde a ninguna empresa registrada. Revisa el enlace que te compartieron.
            </p>
          )}

          {redirigir && (
            <div className="space-y-3 rounded-lg bg-brand-50 p-4 ring-1 ring-brand-200">
              <p className="text-sm text-tinta-900">{redirigir.mensaje} Inicia sesión desde:</p>
              <p className="break-all font-mono text-sm font-semibold text-brand-700">{redirigir.url.replace("https://", "")}</p>
              <a href={redirigir.url} className="btn-primary w-full">
                Ir a mi empresa
              </a>
            </div>
          )}

          <div>
            <label className="label" htmlFor="email">Correo</label>
            <input id="email" type="email" className="input" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {!recuperando && (
            <div>
              <div className="flex items-baseline justify-between">
                <label className="label" htmlFor="password">Contraseña</label>
                <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => (setRecuperando(true), setError(null), setRecuperado(null))}>
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <input id="password" type="password" className="input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}

          {recuperado && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">{recuperado}</p>}
          <ErrorBox message={error} />

          {recuperando ? (
            <>
              <button type="submit" className="btn-primary w-full" disabled={enviando || !!recuperado}>
                {enviando ? "Enviando…" : "Enviarme el enlace"}
              </button>
              <button type="button" className="w-full text-sm text-slate-500 hover:text-tinta-900 hover:underline" onClick={() => (setRecuperando(false), setError(null))}>
                Volver a iniciar sesión
              </button>
            </>
          ) : (
            <button type="submit" className="btn-primary w-full" disabled={enviando}>
              {enviando ? "Entrando…" : "Entrar"}
            </button>
          )}
          {!recuperando && tema && Object.values(tema.frases ?? {}).some((n) => n > 0) && <Frases conteo={tema.frases ?? {}} />}
        </form>
      </div>
    </div>
  );
}


type Frase = { id: string; tipo: "refran" | "cita"; texto: string; autor: string | null };
type Preferencia = "ambas" | "refran" | "cita";
const ETIQUETA: Record<Frase["tipo"], string> = { refran: "Refrán", cita: "Cita bíblica" };
const PREF = "odaitime.frases";

/** Refranes y citas bíblicas al pie del acceso; la flecha trae otra y el selector elige cuáles. */
function Frases({ conteo }: { conteo: Record<string, number> }) {
  const [pref, setPref] = useState<Preferencia>(() => {
    try {
      return (localStorage.getItem(PREF) as Preferencia) || "ambas";
    } catch {
      return "ambas";
    }
  });
  const [frase, setFrase] = useState<Frase | null>(null);

  const siguiente = useCallback(
    (tipo: Preferencia, excluir?: string) => {
      const q = new URLSearchParams({ tipo });
      if (excluir) q.set("excluir", excluir);
      fetch(`/api/sistema/frases/aleatoria?${q}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setFrase)
        .catch(() => {});
    },
    [],
  );
  useEffect(() => siguiente(pref), [pref, siguiente]);

  function elegir(p: Preferencia) {
    setPref(p);
    try {
      localStorage.setItem(PREF, p);
    } catch {
      /* sin almacenamiento */
    }
  }

  const opciones: [Preferencia, string][] = [
    ["ambas", "Ambas"],
    ...(conteo.refran ? ([["refran", "Refranes"]] as [Preferencia, string][]) : []),
    ...(conteo.cita ? ([["cita", "Citas bíblicas"]] as [Preferencia, string][]) : []),
  ];

  return (
    <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="mb-2 flex items-center justify-between gap-2">
        <select className="rounded-md border-0 bg-transparent py-0.5 pl-0 pr-6 text-xs font-medium text-brand-700 focus:ring-0" value={pref} onChange={(e) => elegir(e.target.value as Preferencia)} aria-label="Qué frases ver">
          {opciones.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-brand-600" onClick={() => siguiente(pref, frase?.id)} title="Otra frase" aria-label="Otra frase">
          <Icono nombre="arrow-right" className="h-4 w-4" />
        </button>
      </div>
      {frase ? (
        <figure>
          <blockquote className="text-sm italic text-tinta-900">“{frase.texto}”</blockquote>
          <figcaption className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
            <span>— {frase.autor || "Anónimo"}</span>
            <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">{ETIQUETA[frase.tipo]}</span>
          </figcaption>
        </figure>
      ) : (
        <p className="text-xs text-slate-400">Sin frases de este tipo.</p>
      )}
    </div>
  );
}
