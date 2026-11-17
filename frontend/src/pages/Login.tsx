import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ErrorBox } from "../components/ui";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
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
            <p className="mt-1 text-sm text-slate-500">ODAITIME</p>
          </div>

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
