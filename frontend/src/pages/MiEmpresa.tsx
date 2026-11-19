import { useEffect, useRef, useState, type FormEvent } from "react";
import LogoEmpresa from "../components/LogoEmpresa";
import Icono from "../components/Iconos";
import { Campos, CamposDomicilio, DOMICILIO_VACIO, domicilioApi, domicilioDe, ErrorBox, Fila, PageHeader, useEmpresaScope } from "../components/ui";
import { api, get, type DomicilioApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useBanda } from "../lib/bandas";

type MiEmpresa = DomicilioApi & { id: string; nombre: string; razon_social: string | null; rfc: string | null; direccion: string | null; slug: string; logo_version: string | null };

/** Datos básicos de la empresa y su logo (los cambia su administrador; la licencia, Odai). */
export default function MiEmpresaPagina() {
  const banda = useBanda("empresa");
  const { refrescar } = useAuth();
  const { query, listo } = useEmpresaScope();
  const [empresa, setEmpresa] = useState<MiEmpresa | null>(null);
  const [form, setForm] = useState({ nombre: "", razon_social: "", rfc: "", domicilio: DOMICILIO_VACIO });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const guardarRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!listo) return;
    get<MiEmpresa>(`/tenant/empresa${query}`)
      .then((e) => {
        setEmpresa(e);
        setForm({ nombre: e.nombre, razon_social: e.razon_social ?? "", rfc: e.rfc ?? "", domicilio: domicilioDe(e) });
      })
      .catch((e) => setError((e as Error).message));
  }, [query, listo]);

  // Ctrl+S guarda, como en las fichas.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void guardarRef.current();
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  const sucio =
    !!empresa && (form.nombre !== empresa.nombre || form.razon_social !== (empresa.razon_social ?? "") || form.rfc !== (empresa.rfc ?? "") || JSON.stringify(form.domicilio) !== JSON.stringify(domicilioDe(empresa)));

  async function guardar(e?: FormEvent) {
    e?.preventDefault();
    if (!sucio || guardando) return;
    setMsg(null);
    setError(null);
    setGuardando(true);
    try {
      const r = await api<MiEmpresa>(`/tenant/empresa${query}`, {
        method: "PATCH",
        body: JSON.stringify({ nombre: form.nombre, razon_social: form.razon_social || null, rfc: form.rfc.trim().toUpperCase() || null, ...domicilioApi(form.domicilio) }),
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

  guardarRef.current = () => guardar();

  return (
    <>
      <PageHeader submenu={banda} icono="building" title="Mi empresa" />
      {empresa && (
        <form className="card mx-auto w-full max-w-6xl overflow-hidden" onSubmit={guardar}>
          {/* Mismo guardado que las fichas: nube roja con cambios, verde guardado. */}
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100/70 px-4 py-2.5 sm:px-5">
            <button
              type="submit"
              disabled={!sucio || guardando}
              title={sucio ? "Guardar (Ctrl+S)" : "Guardado"}
              aria-label="Guardar"
              className={`rounded-lg p-1.5 transition disabled:cursor-default ${sucio ? "text-red-600 hover:text-red-700" : "text-emerald-600"}`}
            >
              <Icono nombre={sucio ? "cloud-upload" : "cloud-check"} className="h-5 w-5" />
            </button>
            <span className={`text-xs ${sucio ? "text-red-600" : "text-emerald-600"}`}>{guardando ? "Guardando…" : sucio ? "Sin guardar" : "Guardado"}</span>
          </div>
          <div className="space-y-4 p-6 sm:p-8">
            <div className="flex justify-end">
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
            <Campos>
              <Fila etiqueta="Nombre *" htmlFor="me-nombre">
                <input id="me-nombre" className="input" required minLength={2} maxLength={150} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              </Fila>
              <Fila etiqueta="Razón social" htmlFor="me-razon">
                <input id="me-razon" className="input" maxLength={250} value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} />
              </Fila>
              <Fila etiqueta="RFC" htmlFor="me-rfc">
                <input id="me-rfc" className="input uppercase" maxLength={13} value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value })} />
              </Fila>
              <Fila etiqueta="Subdominio" ayuda="Dirección de acceso al sistema; la asigna Odai. Para cambiarla, solicita soporte.">
                <span className="font-mono text-sm text-brand-700">{empresa.slug}</span>
              </Fila>
              <CamposDomicilio prefijo="me" valor={form.domicilio} onCambio={(domicilio) => setForm({ ...form, domicilio })} />
            </Campos>
          </div>
          <div className="px-6 pb-6 sm:px-8">
            <ErrorBox message={error} />
            {msg && !sucio && <p className="text-sm text-emerald-700">{msg}</p>}
          </div>
        </form>
      )}
      {!empresa && <ErrorBox message={error} />}
    </>
  );
}
