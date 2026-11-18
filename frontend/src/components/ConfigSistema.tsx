import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { aplicarTema, cargarTema, COLORES_ODAI, type Colores, type Enlaces, type Tema as TemaGuardado } from "../lib/tema";
import CorreoSaliente from "./CorreoSaliente";
import Icono from "./Iconos";
import { Ayuda, ErrorBox, Fila, ImagenEditable } from "./ui";

type Pestana = "tema" | "inicio" | "correo" | "enlaces";

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
            ["enlaces", "Enlaces de Odai"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={pestana === k}
            onClick={() => setPestana(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${pestana === k ? "border-brand-500 text-tinta-900" : "border-transparent text-slate-500 hover:text-tinta-900"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {pestana === "tema" && <Tema />}
      {pestana === "inicio" && <ImagenInicio />}
      {pestana === "correo" && <CorreoSaliente />}
      {pestana === "enlaces" && <EnlacesOdai />}
    </div>
  );
}

const ETIQUETAS: Record<keyof Colores, [string, string]> = {
  marca: ["Color de marca", "Opción activa del menú, pestañas, casillas y detalles"],
  acento: ["Color de acento", "Avisos e información secundaria"],
  marino: ["Azul principal", "Menú lateral, encabezados y botón principal"],
  titulos: ["Color de títulos", "Títulos del encabezado y letras del menú"],
  texto: ["Texto principal", "Textos, etiquetas y datos de las pantallas"],
  texto_suave: ["Texto secundario", "Ayudas, fechas y textos tenues"],
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
              <span className="block text-sm font-medium text-tinta-900">{ETIQUETAS[k][0]}</span>
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
      <ImagenEditable className="flex w-full" onCambiar={subir} onQuitar={version ? async () => setVersion((await api<{ imagen_version: string | null }>("/sistema/imagen-inicio", { method: "DELETE" })).imagen_version) : undefined}>
        <div className="flex aspect-[4/1] items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
          {version ? <img src={`/api/sistema/imagen-inicio?v=${encodeURIComponent(version)}`} alt="Imagen de inicio" className="h-full w-full object-cover" /> : <span className="text-sm text-slate-400">Sin imagen · pasa el mouse para subirla</span>}
        </div>
      </ImagenEditable>
      <ErrorBox message={error} />
    </div>
  );
}

/** Tienda en línea (comprar más empleados cuando se acaba el cupo) y soporte de Odai. */
function EnlacesOdai() {
  const [enlaces, setEnlaces] = useState<Enlaces>({ url_tienda: "", url_soporte: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cargarTema().then((t) => setEnlaces({ url_tienda: t.enlaces?.url_tienda ?? "", url_soporte: t.enlaces?.url_soporte ?? "" }));
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    try {
      const t = await api<TemaGuardado>("/sistema/enlaces", {
        method: "PUT",
        body: JSON.stringify({ url_tienda: enlaces.url_tienda?.trim() || null, url_soporte: enlaces.url_soporte?.trim() || null }),
      });
      setEnlaces({ url_tienda: t.enlaces.url_tienda ?? "", url_soporte: t.enlaces.url_soporte ?? "" });
      await cargarTema();
      setMsg("Enlaces guardados.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="max-w-2xl space-y-4" onSubmit={guardar}>
      <Fila etiqueta="Tienda en línea" htmlFor="url-tienda" ayuda="A donde se envía a la empresa cuando ya no tiene empleados disponibles en su licencia o está vencida, para comprar más.">
        <input id="url-tienda" className="input" type="url" placeholder="https://odai.lat/tienda" value={enlaces.url_tienda ?? ""} onChange={(e) => setEnlaces({ ...enlaces, url_tienda: e.target.value })} />
      </Fila>
      <Fila etiqueta="Soporte" htmlFor="url-soporte" ayuda="Se abre desde la opción Solicitar soporte del menú del usuario.">
        <input id="url-soporte" className="input" type="url" placeholder="https://odai.lat/soporte" value={enlaces.url_soporte ?? ""} onChange={(e) => setEnlaces({ ...enlaces, url_soporte: e.target.value })} />
      </Fila>
      <p className="flex items-center text-xs text-slate-500">
        Solo los ve Odai; las empresas no pueden cambiarlos.
        <Ayuda texto="Si se dejan vacíos se usan los valores del servidor (.env)." />
      </p>
      <ErrorBox message={error} />
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      <div className="flex justify-end">
        <button className="btn-primary">
          <Icono nombre="check" /> Guardar
        </button>
      </div>
    </form>
  );
}
