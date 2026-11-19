import { useEffect, useState } from "react";
import { api, get, post, type Usuario } from "../lib/api";
import Icono from "./Iconos";
import { ErrorBox, Fila } from "./ui";

/**
 * Único administrador de una empresa cliente. Lo asigna Odai; él da de alta a los demás
 * usuarios de su empresa.
 */
export default function AdministradorEmpresa({ empresaId }: { empresaId: string }) {
  const base = `/empresas/${empresaId}/administrador`;
  const [admin, setAdmin] = useState<Usuario | null | undefined>(undefined);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; enlace?: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    get<Usuario | null>(base)
      .then((u) => {
        setAdmin(u);
        setNombre(u?.nombre ?? "");
        setEmail(u?.email ?? "");
      })
      .catch((e) => setError((e as Error).message));
  }, [base]);

  const sucio = admin === null ? !!(nombre || email) : !!admin && (nombre !== admin.nombre || email !== admin.email || !!password);

  async function guardar() {
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const u = await api<Usuario>(base, { method: "PUT", body: JSON.stringify({ nombre, email, password: password || null }) });
      setAdmin(u);
      setPassword("");
      setAviso({ texto: "Administrador guardado." });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function enviarAcceso() {
    setError(null);
    setOcupado(true);
    try {
      const r = await post<{ mensaje: string; enlace: string }>(`${base}/acceso`, {});
      setAviso({ texto: r.mensaje, enlace: r.enlace || undefined });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (admin === undefined) return <p className="text-sm text-slate-500">Cargando administrador…</p>;

  return (
    <fieldset className="space-y-2 rounded-lg bg-brand-50/60 p-4">
      <legend className="px-1 text-sm font-medium text-brand-700">Administrador de la empresa</legend>
      <p className="pb-1 text-xs text-slate-500">Uno por empresa. Él da de alta a los usuarios de su empresa.</p>
      <Fila etiqueta="Nombre" htmlFor="adm-nombre">
        <input id="adm-nombre" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </Fila>
      <Fila etiqueta="Correo" htmlFor="adm-email" ayuda="Con este correo entra por la dirección de la empresa.">
        <input id="adm-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Fila>
      <Fila etiqueta={admin ? "Nueva contraseña" : "Contraseña temporal"} htmlFor="adm-pass" ayuda={admin ? "Déjala vacía para no cambiarla." : undefined}>
        <input id="adm-pass" className="input" type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Fila>
      <ErrorBox message={error} />
      {aviso && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {aviso.texto}
          {aviso.enlace && <input readOnly className="input mt-1 w-full bg-white text-xs" value={aviso.enlace} onFocus={(e) => e.target.select()} />}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {admin && (
          <button type="button" className="btn-secondary" disabled={ocupado} onClick={enviarAcceso}>
            <Icono nombre="mail" /> Enviar acceso por correo
          </button>
        )}
        <button type="button" className="btn-primary" disabled={ocupado || !sucio || !nombre || !email || (!admin && password.length < 8)} onClick={guardar}>
          <Icono nombre="check" /> {admin ? "Guardar administrador" : "Asignar administrador"}
        </button>
      </div>
    </fieldset>
  );
}
