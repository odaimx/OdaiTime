import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ErrorBox } from "../components/ui";
import { type Usuario } from "../lib/api";
import { useAuth } from "../lib/auth";

interface Enlace {
  tipo: "invitacion" | "recuperar";
  nombre: string;
  email: string;
  empresa: string | null;
}

/** Crear la contraseña (invitación al portal) o cambiarla (recuperación), con el enlace del correo. */
export default function Restablecer() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { entrar } = useAuth();
  const navigate = useNavigate();
  const [enlace, setEnlace] = useState<Enlace | null>(null);
  const [invalido, setInvalido] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ mensaje: string; url: string } | null>(null);

  useEffect(() => {
    fetch(`/api/auth/enlace?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const b = await r.json().catch(() => null);
        if (!r.ok) throw new Error(typeof b?.detail === "string" ? b.detail : "El enlace no es válido.");
        setEnlace(b);
      })
      .catch((e) => setInvalido(e.message));
  }, [token]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmar) return setError("Las contraseñas no coinciden.");
    setEnviando(true);
    try {
      const r = await fetch("/api/auth/restablecer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const b = await r.json().catch(() => null);
      if (r.status === 409 && b?.detail?.url) return setAviso({ mensaje: b.detail.mensaje, url: b.detail.url });
      if (!r.ok) throw new Error(typeof b?.detail === "string" ? b.detail : "No se pudo guardar la contraseña.");
      entrar(b as { usuario: Usuario });
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 p-6">
      <div className="card w-full max-w-sm space-y-5 p-8">
        <img src="/logo.png" alt="ODAI" className="h-8 w-auto" />
        {invalido && (
          <>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">{invalido}</p>
            <Link to="/login" className="btn-primary w-full">
              Ir al inicio de sesión
            </Link>
          </>
        )}
        {aviso && (
          <div className="space-y-3">
            <p className="text-sm text-tinta-900">{aviso.mensaje}</p>
            <a href={aviso.url} className="btn-primary w-full">
              Ir a mi empresa
            </a>
          </div>
        )}
        {enlace && !aviso && (
          <form onSubmit={guardar} className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold text-tinta-900">{enlace.tipo === "invitacion" ? `Bienvenido, ${enlace.nombre.split(" ")[0]}` : "Nueva contraseña"}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {enlace.tipo === "invitacion" ? "Crea tu contraseña para entrar al portal" : "Escribe tu nueva contraseña"}
                {enlace.empresa && ` de ${enlace.empresa}`}.
              </p>
              <p className="mt-2 text-sm font-medium text-tinta-900">{enlace.email}</p>
            </div>
            <div>
              <label className="label" htmlFor="pw">
                Contraseña
              </label>
              <input id="pw" type="password" className="input" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="mt-1 text-xs text-slate-500">Mínimo 8 caracteres.</p>
            </div>
            <div>
              <label className="label" htmlFor="pw2">
                Confirmar contraseña
              </label>
              <input id="pw2" type="password" className="input" autoComplete="new-password" minLength={8} required value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
            </div>
            <ErrorBox message={error} />
            <button className="btn-primary w-full" disabled={enviando}>
              {enviando ? "Guardando…" : enlace.tipo === "invitacion" ? "Crear contraseña y entrar" : "Guardar y entrar"}
            </button>
          </form>
        )}
        {!enlace && !invalido && <p className="text-sm text-slate-500">Revisando el enlace…</p>}
      </div>
    </div>
  );
}
