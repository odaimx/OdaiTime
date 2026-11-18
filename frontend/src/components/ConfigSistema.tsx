import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { aplicarTema, cargarTema, COLORES_ODAI, type Colores } from "../lib/tema";
import CorreoSaliente from "./CorreoSaliente";
import Icono from "./Iconos";
import { ErrorBox } from "./ui";

type Pestana = "tema" | "inicio" | "correo";

/** Configuración general de ODAITIME para todas las empresas (solo superadmin). */
export default function ConfigSistema() {
  const [pestana, setPestana] = useState<Pestana>("tema");
  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {(
          [
            ["tema", "Colores del tema"],
            ["inicio", "Imagen de inicio"],
            ["correo", "Correo saliente"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={pestana === k}
            onClick={() => setPestana(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${pestana === k ? "border-brand-500 text-navy-900" : "border-transparent text-slate-500 hover:text-navy-900"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {pestana === "tema" && <Tema />}
      {pestana === "inicio" && <ImagenInicio />}
      {pestana === "correo" && <CorreoSaliente />}
    </div>
  );
}

const ETIQUETAS: Record<keyof Colores, [string, string]> = {
  marca: ["Color de marca", "Opción activa del menú, pestañas, casillas y detalles"],
  acento: ["Color de acento", "Avisos e información secundaria"],
  marino: ["Azul principal", "Menú lateral, encabezados y botón principal"],
  titulos: ["Color de títulos", "Títulos del encabezado y letras del menú"],
};

function Tema() {
  const [colores, setColores] = useState<Required<{ [K in keyof Colores]: string }>>(COLORES_ODAI);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cargarTema().then((t) => setColores({ ...COLORES_ODAI, ...Object.fromEntries(Object.entries(t.colores).filter(([, v]) => v)) }));
  }, []);

  function cambiar(k: keyof Colores, v: string) {
    const n = { ...colores, [k]: v };
    setColores(n);
    aplicarTema(n); // vista previa en vivo
    setMsg(null);
  }

  async function guardar(valores: typeof colores) {
    setError(null);
    try {
      // Solo se guarda lo que cambia respecto a los colores de Odai.
      const cambios = Object.fromEntries(Object.entries(valores).filter(([k, v]) => COLORES_ODAI[k as keyof Colores] !== v));
      await api("/sistema/tema", { method: "PUT", body: JSON.stringify(cambios) });
      aplicarTema(cambios);
      setColores(valores);
      setMsg("Tema guardado. Se aplica a todas las empresas.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(Object.keys(ETIQUETAS) as (keyof Colores)[]).map((k) => (
          <label key={k} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-brand-300">
            <span className="relative inline-flex h-10 w-10 shrink-0 rounded-full ring-1 ring-slate-300" style={{ backgroundColor: colores[k] }}>
              <input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={colores[k]} onChange={(e) => cambiar(k, e.target.value)} aria-label={ETIQUETAS[k][0]} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-navy-900">{ETIQUETAS[k][0]}</span>
              <span className="block text-xs text-slate-500">{ETIQUETAS[k][1]}</span>
              <span className="font-mono text-xs text-slate-400">{colores[k]}</span>
            </span>
          </label>
        ))}
      </div>
      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}
      <ErrorBox message={error} />
      <div className="flex justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={() => guardar(COLORES_ODAI)}>
          Restablecer colores de Odai
        </button>
        <button type="button" className="btn-primary" onClick={() => guardar(colores)}>
          <Icono nombre="palette" /> Guardar tema
        </button>
      </div>
    </div>
  );
}

function ImagenInicio() {
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    cargarTema().then((t) => setVersion(t.imagen_version));
  }, []);
  async function subir(f: File) {
    setError(null);
    try {
      const body = new FormData();
      body.append("archivo", f);
      setVersion((await api<{ imagen_version: string | null }>("/sistema/imagen-inicio", { method: "PUT", body })).imagen_version);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Aparece en la pantalla de Inicio de todas las empresas.</p>
      <div className="flex aspect-[3/1] items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
        {version ? <img src={`/api/sistema/imagen-inicio?v=${encodeURIComponent(version)}`} alt="Imagen de inicio" className="h-full w-full object-cover" /> : <span className="text-sm text-slate-400">Sin imagen</span>}
      </div>
      <ErrorBox message={error} />
      <div className="flex justify-end gap-3">
        {version && (
          <button type="button" className="btn-secondary" onClick={async () => setVersion((await api<{ imagen_version: string | null }>("/sistema/imagen-inicio", { method: "DELETE" })).imagen_version)}>
            Quitar
          </button>
        )}
        <label className="btn-primary cursor-pointer">
          <Icono nombre="image" /> {version ? "Cambiar imagen" : "Subir imagen"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])} />
        </label>
      </div>
    </div>
  );
}
