import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { ErrorBox } from "../components/ui";
import { AVISO_BLOQUEO, type TenantInfo } from "../lib/api";
import { estiloFondoLogin, useTema } from "../lib/tema";
import Icono from "../components/Iconos";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const destino = (useLocation().state as { desde?: string } | null)?.desde ?? "/";
  const tema = useTema();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [noExiste, setNoExiste] = useState(false);
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
    setEnviando(true);
    try {
      await login(email, password);
      navigate(destino, { replace: true });
    } catch (err) {
      // Si entra por una dirección que no es la suya, solo se le pide usar la de su empresa.
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const imagenLogin = tema?.login_version ? `/api/sistema/imagen/login?v=${encodeURIComponent(tema.login_version)}` : null;
  const colores = tema?.login_colores ?? {};
  const tamanos = tema?.login_tamanos ?? {};
  // Tamaño de letra de cada renglón (px); sin configurar: 36 · 30 · 16.
  const estilo = (color?: string | null, px?: number | null, defecto = 16) => ({ color: color ?? undefined, fontSize: `${px ?? defecto}px` });
  // Lo que Odai deje vacío en la configuración se queda en blanco.
  const textoLogin = tema?.login_texto ?? "";
  // Con texto, el título y el subtítulo no ensanchan el bloque: cortan al ancho del texto.
  const ajustar = textoLogin ? "w-0 min-w-full" : "";

  return (
    <div className="flex min-h-screen">
      {/* Panel izquierdo: imagen de Odai o, si no hay, el color del menú. */}
      <div
        className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-navy-950 p-12 lg:flex"
        style={imagenLogin ? { backgroundImage: `url(${imagenLogin})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {imagenLogin && <div className="absolute inset-0 bg-gradient-to-t from-navy-950/85 via-navy-950/30 to-transparent" />}
        <span />
        {/* Textos en la parte baja del panel; el color de cada renglón lo elige Odai. */}
        {/* Los tres renglones comparten el mismo ancho: el título y el subtítulo cortan donde corta el texto. */}
        <div className="relative mt-auto grid max-w-2xl self-start">
          {tema?.login_titulo && (
            <h2 className={`font-semibold leading-tight text-white ${ajustar}`} style={estilo(colores.titulo, tamanos.titulo, 36)}>
              {tema.login_titulo}
            </h2>
          )}
          {tema?.login_subtitulo && (
            <p className={`font-semibold leading-tight text-brand-500 ${ajustar}`} style={estilo(colores.subtitulo, tamanos.subtitulo, 30)}>
              {tema.login_subtitulo}
            </p>
          )}
          {textoLogin && (
            <p className="mt-4 whitespace-pre-line text-slate-200" style={estilo(colores.texto, tamanos.texto, 16)}>
              {textoLogin}
            </p>
          )}
        </div>
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center gap-4 bg-slate-50 p-6 pb-12" style={estiloFondoLogin(tema)}>
        <form onSubmit={recuperando ? recuperar : onSubmit} className="card w-full max-w-sm space-y-5 p-8 shadow-xl shadow-navy-950/10">
          {/* Logo de Odai, raya, nombre de la empresa y el título. */}
          <div className="flex flex-col items-center text-center">
            <img src="/logo.png" alt="ODAI" className="h-9 w-auto" />
            <hr className="my-4 w-full border-t-2 border-slate-400" />
            {tenant?.modo === "tenant" && <p className="text-base font-semibold text-tinta-900">{tenant.nombre}</p>}
            {tenant?.modo === "base" && <p className="text-sm font-medium text-slate-600">Panel de administración Odai</p>}
            <h1 className="mt-4 text-xl font-semibold text-tinta-900">{recuperando ? "Recuperar contraseña" : "Iniciar sesión"}</h1>
          </div>

          {noExiste && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
              Esta dirección no corresponde a ninguna empresa registrada. Revisa el enlace que te compartieron.
            </p>
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
              <div className="relative">
                <input id="password" type={verClave ? "text" : "password"} className="input pr-10" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-tinta-900"
                  onClick={() => setVerClave((v) => !v)}
                  title={verClave ? "Ocultar contraseña" : "Ver contraseña"}
                  aria-label={verClave ? "Ocultar contraseña" : "Ver contraseña"}
                >
                  <Icono nombre={verClave ? "eye-off" : "eye"} className="h-4 w-4" />
                </button>
              </div>
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
              {enviando ? "Ingresando…" : "Ingresar al sistema"}
            </button>
          )}
          {!recuperando && tema && Object.values(tema.frases ?? {}).some((n) => n > 0) && (
            <>
              <hr className="border-t-2 border-slate-400" />
              <Frases conteo={tema.frases ?? {}} />
            </>
          )}
        </form>
        <p className="absolute bottom-4 right-6 text-xs text-slate-500">© {new Date().getFullYear()} Odai · Cancún, México</p>
      </div>
    </div>
  );
}


type Frase = { id: string; tipo: "frase" | "proverbio" | "cita"; texto: string; autor: string | null };
type Preferencia = "todas" | "frase" | "proverbio" | "cita";
const OPCIONES: [Preferencia, string][] = [
  ["frase", "Frases"],
  ["proverbio", "Proverbios"],
  ["cita", "Citas bíblicas"],
  ["todas", "Todas"],
];
const PREF = "odaitime.frases";

/** Frases, proverbios y citas bíblicas al azar bajo el botón; la flecha trae otra. */
function Frases({ conteo }: { conteo: Record<string, number> }) {
  const [pref, setPref] = useState<Preferencia>(() => {
    try {
      const p = localStorage.getItem(PREF) as Preferencia | null;
      return p && OPCIONES.some(([k]) => k === p) ? p : "todas";
    } catch {
      return "todas";
    }
  });
  const [frase, setFrase] = useState<Frase | null>(null);

  const siguiente = useCallback((tipo: Preferencia, excluir?: string) => {
    const q = new URLSearchParams({ tipo });
    if (excluir) q.set("excluir", excluir);
    fetch(`/api/sistema/frases/aleatoria?${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setFrase)
      .catch(() => {});
  }, []);
  useEffect(() => siguiente(pref), [pref, siguiente]);

  function elegir(p: Preferencia) {
    setPref(p);
    try {
      localStorage.setItem(PREF, p);
    } catch {
      /* sin almacenamiento */
    }
  }

  return (
    <div>
      {frase ? (
        <figure>
          <blockquote className="text-sm italic text-tinta-900">“{frase.texto}”</blockquote>
          <figcaption className="mt-3 text-right text-xs text-slate-500">
            — {frase.autor || "Anónimo"}
          </figcaption>
        </figure>
      ) : (
        <p className="text-xs text-slate-400">Sin frases de este tipo.</p>
      )}
      {/* Qué ver y la flecha para otra, separados del autor. */}
      <div className="mt-6 flex items-center justify-between gap-2">
        <select className="-ml-1 rounded-md border-0 bg-transparent py-0.5 pl-1 pr-7 text-xs font-medium text-brand-700 focus:ring-1 focus:ring-brand-300" value={pref} onChange={(e) => elegir(e.target.value as Preferencia)} aria-label="Qué frases ver">
          {OPCIONES.filter(([k]) => k === "todas" || conteo[k]).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button type="button" className="rounded-md p-1 text-slate-400 hover:text-brand-600" onClick={() => siguiente(pref, frase?.id)} title="Otra" aria-label="Otra frase">
          <Icono nombre="arrow-right" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
