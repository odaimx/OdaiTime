import { useEffect, useState, type FormEvent } from "react";
import LogoEmpresa from "../components/LogoEmpresa";
import Icono from "../components/Iconos";
import { ErrorBox, Fila, PageHeader, useEmpresaScope } from "../components/ui";
import { api, get } from "../lib/api";
import { useAuth } from "../lib/auth";

type MiEmpresa = { id: string; nombre: string; razon_social: string | null; rfc: string | null; slug: string; logo_version: string | null };

/** Datos básicos de la empresa y su logo (los cambia su administrador; la licencia, Odai). */
export default function MiEmpresaPagina() {
  const { refrescar } = useAuth();
  const { query, listo } = useEmpresaScope();
  const [empresa, setEmpresa] = useState<MiEmpresa | null>(null);
  const [form, setForm] = useState({ nombre: "", razon_social: "", rfc: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!listo) return;
    get<MiEmpresa>(`/tenant/empresa${query}`)
      .then((e) => {
        setEmpresa(e);
        setForm({ nombre: e.nombre, razon_social: e.razon_social ?? "", rfc: e.rfc ?? "" });
      })
      .catch((e) => setError((e as Error).message));
  }, [query, listo]);

  const sucio = !!empresa && (form.nombre !== empresa.nombre || form.razon_social !== (empresa.razon_social ?? "") || form.rfc !== (empresa.rfc ?? ""));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setGuardando(true);
    try {
      const r = await api<MiEmpresa>(`/tenant/empresa${query}`, {
        method: "PATCH",
        body: JSON.stringify({ nombre: form.nombre, razon_social: form.razon_social || null, rfc: form.rfc.trim().toUpperCase() || null }),
      });
      setEmpresa(r);
      setMsg("Datos guardados.");
      await refrescar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <PageHeader icono="building" title="Mi empresa" />
      {empresa && (
        <form className="card max-w-5xl p-6 sm:p-8" onSubmit={guardar}>
          <div className="grid grid-cols-1 gap-x-10 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <Fila etiqueta="Nombre *" htmlFor="me-nombre">
                <input id="me-nombre" className="input" required minLength={2} maxLength={150} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              </Fila>
              <Fila etiqueta="Razón social" htmlFor="me-razon">
                <input id="me-razon" className="input" maxLength={250} value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} />
              </Fila>
              <Fila etiqueta="RFC" htmlFor="me-rfc">
                <input id="me-rfc" className="input uppercase" maxLength={13} value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value })} />
              </Fila>
              <Fila etiqueta="Dirección" ayuda="La asigna Odai; para cambiarla, solicita soporte.">
                <span className="font-mono text-sm text-brand-700">{empresa.slug}</span>
              </Fila>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <span className="text-sm font-medium text-tinta-900">Logo</span>
              <LogoEmpresa
                empresaId={empresa.id}
                version={empresa.logo_version}
                query={query}
                onCambio={(v) => {
                  setEmpresa({ ...empresa, logo_version: v ?? null });
                  void refrescar();
                }}
              />
            </div>
          </div>
          <ErrorBox message={error} />
          {msg && <p className="mt-3 text-sm text-emerald-700">{msg}</p>}
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" disabled={!sucio || guardando}>
              <Icono nombre="check" /> {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      )}
      {!empresa && <ErrorBox message={error} />}
    </>
  );
}
