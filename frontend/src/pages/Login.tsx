import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { ErrorBox } from "../components/ui";
import { ApiError, type TenantInfo } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const destino = (useLocation().state as { desde?: string } | null)?.desde ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [noExiste, setNoExiste] = useState(false);
  const [redirigir, setRedirigir] = useState<{ mensaje: string; url: string } | null>(null);

  useEffect(() => {
    fetch("/api/tenant")
      .then((r) => {
        if (r.status === 404) setNoExiste(true);
        return r.ok ? r.json() : null;
      })
      .then((t) => t && setTenant(t))
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

  return (
    <div className="flex min-h-screen">
      <div className="hidden flex-1 flex-col justify-between bg-navy-900 p-12 lg:flex">
        <img src="/logo.png" alt="ODAI" className="h-10 w-auto self-start" />
        <div>
          <h2 className="text-4xl font-semibold leading-tight text-white">
            Control de asistencia
            <br />
            <span className="text-brand-500">claro y en regla.</span>
          </h2>
          <p className="mt-4 max-w-md text-slate-300">
            Checadas, retardos, horas extra y reportes apegados a la Ley Federal del Trabajo, para todas tus sucursales.
          </p>
        </div>
        <p className="text-xs text-slate-500">© {new Date().getFullYear()} Odai · Cancún, México</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-slate-50 p-6">
        <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-5 p-8">
          <div>
            <img src="/logo.png" alt="ODAI" className="mb-6 h-8 w-auto lg:hidden" />
            <h1 className="text-xl font-semibold text-navy-900">Iniciar sesión</h1>
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
              <p className="text-sm text-navy-900">{redirigir.mensaje} Inicia sesión desde:</p>
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
          <div>
            <label className="label" htmlFor="password">Contraseña</label>
            <input id="password" type="password" className="input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <ErrorBox message={error} />

          <button type="submit" className="btn-primary w-full" disabled={enviando}>
            {enviando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
