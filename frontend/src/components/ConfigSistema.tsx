import { useEffect, useState, type FormEvent } from "react";
import { api, descargar } from "../lib/api";
import { aplicarTema, cargarTema, COLORES_ODAI, temaActual, type Colores, type Enlaces, type Tema as TemaGuardado } from "../lib/tema";
import CorreoSaliente from "./CorreoSaliente";
import Icono from "./Iconos";
import { Ayuda, BarraGuardar, ErrorBox, Fila, ImagenEditable } from "./ui";

type Pestana = "tema" | "acceso" | "frases" | "correo" | "enlaces";

/** Configuración general de ODAITIME para todas las empresas (solo superadmin). */
export default function ConfigSistema() {
  const [pestana, setPestana] = useState<Pestana>("tema");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
        {(
          [
            ["tema", "Colores del tema"],
            ["acceso", "Pantalla de acceso"],
            ["frases", "Frases"],
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
      {pestana === "acceso" && <PantallaAcceso />}
      {pestana === "frases" && <FrasesLogin />}
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
  const [guardados, setGuardados] = useState(JSON.stringify(COLORES_ODAI));
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cargarTema().then((t) => {
      const c = { ...COLORES_ODAI, ...Object.fromEntries(Object.entries(t.colores).filter(([, v]) => v)) };
      setColores(c);
      setGuardados(JSON.stringify(c));
    });
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
      setGuardados(JSON.stringify(valores));
      setMsg("Tema guardado. Se aplica a todas las empresas.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <BarraGuardar sucio={JSON.stringify(colores) !== guardados} onGuardar={() => guardar(colores)}>
        <button type="button" className="text-xs text-slate-600 hover:underline" onClick={() => guardar(COLORES_ODAI)}>
          Restablecer colores de Odai
        </button>
      </BarraGuardar>
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
    </div>
  );
}

type TipoImagen = "inicio" | "fondo" | "login";
const VERSION: Record<TipoImagen, keyof TemaGuardado> = { inicio: "imagen_version", fondo: "fondo_version", login: "login_version" };

/** Imagen general (inicio, fondo de la app o panel del acceso) con lápiz y bote al pasar el mouse. */
function ImagenSistema({ tipo, aspecto, vacia }: { tipo: TipoImagen; aspecto: string; vacia: string }) {
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    temaActual().then((t) => setVersion((t[VERSION[tipo]] as string | null | undefined) ?? null));
  }, [tipo]);
  async function enviar(init: RequestInit) {
    setError(null);
    try {
      const t = await api<TemaGuardado>(`/sistema/imagen/${tipo}`, init);
      setVersion((t[VERSION[tipo]] as string | null | undefined) ?? null);
      await cargarTema();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function subir(f: File) {
    const body = new FormData();
    body.append("archivo", f);
    return enviar({ method: "PUT", body });
  }
  return (
    <div className="space-y-2">
      <ImagenEditable className="flex w-full" onCambiar={subir} onQuitar={version ? () => enviar({ method: "DELETE" }) : undefined}>
        <div className={`flex w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200 ${aspecto}`}>
          {version ? <img src={`/api/sistema/imagen/${tipo}?v=${encodeURIComponent(version)}`} alt="" className="h-full w-full object-cover" /> : <span className="px-4 text-center text-sm text-slate-400">{vacia}</span>}
        </div>
      </ImagenEditable>
      <ErrorBox message={error} />
    </div>
  );
}

type Apariencia = {
  fondo_color: string | null;
  login_titulo: string | null;
  login_subtitulo: string | null;
  login_texto: string | null;
  login_color_titulo: string | null;
  login_color_subtitulo: string | null;
  login_color_texto: string | null;
  login_tamano_titulo: number | null;
  login_tamano_subtitulo: number | null;
  login_tamano_texto: number | null;
};

/** Guarda la apariencia completa (color de fondo y textos del acceso) cambiando solo lo indicado. */
async function guardarApariencia(cambios: Partial<Apariencia>) {
  const t = await temaActual();
  const c = t.login_colores ?? {};
  const actual: Apariencia = {
    fondo_color: t.fondo_color ?? null,
    login_titulo: t.login_titulo ?? null,
    login_subtitulo: t.login_subtitulo ?? null,
    login_texto: t.login_texto ?? null,
    login_color_titulo: c.titulo ?? null,
    login_color_subtitulo: c.subtitulo ?? null,
    login_color_texto: c.texto ?? null,
    login_tamano_titulo: t.login_tamanos?.titulo ?? null,
    login_tamano_subtitulo: t.login_tamanos?.subtitulo ?? null,
    login_tamano_texto: t.login_tamanos?.texto ?? null,
  };
  await api("/sistema/apariencia", { method: "PUT", body: JSON.stringify({ ...actual, ...cambios }) });
  await cargarTema();
}

const COLOR_DEFECTO = { login_color_titulo: "#ffffff", login_color_subtitulo: "#8a64de", login_color_texto: "#e2e8f0", fondo_color: "#f8fafc" };
type CampoColor = keyof typeof COLOR_DEFECTO;

/** Pantalla de acceso, imagen de inicio y color de fondo de la aplicación (todas las empresas). */
function PantallaAcceso() {
  const vacio = {
    login_titulo: "",
    login_subtitulo: "",
    login_texto: "",
    login_color_titulo: "",
    login_color_subtitulo: "",
    login_color_texto: "",
    login_tamano_titulo: "",
    login_tamano_subtitulo: "",
    login_tamano_texto: "",
    fondo_color: "",
  };
  const [form, setForm] = useState(vacio);
  const [guardado, setGuardado] = useState(JSON.stringify(vacio));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    temaActual().then((t) => {
      const c = t.login_colores ?? {};
      const f = {
        login_titulo: t.login_titulo ?? "",
        login_subtitulo: t.login_subtitulo ?? "",
        login_texto: t.login_texto ?? "",
        login_color_titulo: c.titulo ?? "",
        login_color_subtitulo: c.subtitulo ?? "",
        login_color_texto: c.texto ?? "",
        login_tamano_titulo: t.login_tamanos?.titulo ? String(t.login_tamanos.titulo) : "",
        login_tamano_subtitulo: t.login_tamanos?.subtitulo ? String(t.login_tamanos.subtitulo) : "",
        login_tamano_texto: t.login_tamanos?.texto ? String(t.login_tamanos.texto) : "",
        fondo_color: t.fondo_color ?? "",
      };
      setForm(f);
      setGuardado(JSON.stringify(f));
    });
  }, []);
  const sucio = JSON.stringify(form) !== guardado;

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      await guardarApariencia(
        Object.fromEntries(Object.entries(form).map(([k, v]) => [k, k.startsWith("login_tamano") ? (v ? Number(v) : null) : v.trim() || null])) as Partial<Apariencia>,
      );
      setGuardado(JSON.stringify(form));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const TAMANO_DEFECTO = { login_tamano_titulo: 36, login_tamano_subtitulo: 30, login_tamano_texto: 16 };
  const tamano = (campo: keyof typeof TAMANO_DEFECTO) => (
    <label className="flex shrink-0 items-center gap-1 text-xs text-slate-500" title="Tamaño de letra en píxeles">
      <input
        type="number"
        min={10}
        max={96}
        className="input h-9 w-16 px-2 text-center"
        placeholder={String(TAMANO_DEFECTO[campo])}
        value={form[campo]}
        onChange={(e) => setForm({ ...form, [campo]: e.target.value })}
        aria-label="Tamaño de letra"
      />
      px
    </label>
  );

  const color = (campo: CampoColor) => (
    <span className="flex shrink-0 items-center gap-1">
      <input
        type="color"
        className="h-9 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
        value={form[campo] || COLOR_DEFECTO[campo]}
        onChange={(e) => setForm({ ...form, [campo]: e.target.value })}
        title="Color"
        aria-label="Color"
      />
      {form[campo] && (
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setForm({ ...form, [campo]: "" })}>
          Predeterminado
        </button>
      )}
    </span>
  );

  return (
    <div className="space-y-6">
      <BarraGuardar sucio={sucio} guardando={guardando} onGuardar={guardar} />
      <ErrorBox message={error} />
      <section className="max-w-2xl space-y-3">
        <h3 className="text-sm font-semibold text-tinta-900">Textos del panel izquierdo: tamaño y color</h3>
        <p className="text-xs text-slate-500">Lo que se deje vacío no se muestra.</p>
        <Fila etiqueta="Título" htmlFor="login-titulo">
          <div className="flex items-center gap-2">
            <input id="login-titulo" className="input" maxLength={120} value={form.login_titulo} onChange={(e) => setForm({ ...form, login_titulo: e.target.value })} />
            {tamano("login_tamano_titulo")}
            {color("login_color_titulo")}
          </div>
        </Fila>
        <Fila etiqueta="Subtítulo" htmlFor="login-sub">
          <div className="flex items-center gap-2">
            <input id="login-sub" className="input" maxLength={120} value={form.login_subtitulo} onChange={(e) => setForm({ ...form, login_subtitulo: e.target.value })} />
            {tamano("login_tamano_subtitulo")}
            {color("login_color_subtitulo")}
          </div>
        </Fila>
        <Fila etiqueta="Texto" htmlFor="login-texto" ayuda="Puede tener varias líneas.">
          <div className="flex items-start gap-2">
            <textarea id="login-texto" className="input min-h-24" maxLength={600} value={form.login_texto} onChange={(e) => setForm({ ...form, login_texto: e.target.value })} />
            {tamano("login_tamano_texto")}
            {color("login_color_texto")}
          </div>
        </Fila>
        <Fila etiqueta="Fondo de la aplicación" ayuda="Color detrás de las pantallas y del pie de página de todas las empresas.">
          {color("fondo_color")}
        </Fila>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-tinta-900">Imagen del panel izquierdo</h3>
        <p className="text-xs text-slate-500">Si no hay imagen, el panel usa el color del menú.</p>
        <ImagenSistema tipo="login" aspecto="aspect-[16/9] max-w-xl" vacia="Sin imagen · se usa el color del menú" />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-tinta-900">Imagen de fondo de la pantalla de acceso</h3>
        <p className="text-xs text-slate-500">Se ve detrás del recuadro de inicio de sesión. Si no hay, se usa el color de fondo de la aplicación.</p>
        <ImagenSistema tipo="fondo" aspecto="aspect-[16/9] max-w-xl" vacia="Sin imagen de fondo · pasa el mouse para subirla" />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-tinta-900">Imagen de inicio</h3>
        <p className="text-xs text-slate-500">Aparece a todo lo ancho en la pantalla de Inicio de todas las empresas.</p>
        <ImagenSistema tipo="inicio" aspecto="aspect-[4/1]" vacia="Sin imagen · pasa el mouse para subirla" />
      </section>
    </div>
  );
}

type Frase = { id: string; tipo: "frase" | "proverbio" | "cita"; texto: string; autor: string | null };
const TIPO_FRASE: Record<Frase["tipo"], string> = { frase: "Frase", proverbio: "Proverbio", cita: "Cita bíblica" };

/** Frases, proverbios y citas bíblicas de la pantalla de acceso: se importan de Excel o CSV. */
function FrasesLogin() {
  const [frases, setFrases] = useState<Frase[] | null>(null);
  const [reemplazar, setReemplazar] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = () => api<Frase[]>("/sistema/frases").then(setFrases).catch((e) => setError((e as Error).message));
  useEffect(() => void cargar(), []);

  async function importar(f: File) {
    setMsg(null);
    setError(null);
    try {
      const body = new FormData();
      body.append("archivo", f);
      const r = await api<{ importadas: number; omitidas: number }>(`/sistema/frases/importar?reemplazar=${reemplazar}`, { method: "POST", body });
      setMsg(`${r.importadas} frase(s) importada(s)${r.omitidas ? `; ${r.omitidas} renglón(es) sin tipo o texto se omitieron` : ""}.`);
      await cargar();
      await cargarTema();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function borrar(f: Frase) {
    await api(`/sistema/frases/${f.id}`, { method: "DELETE" });
    await cargar();
    await cargarTema();
  }
  async function borrarTodas() {
    if (!confirm(`¿Borrar las ${frases?.length ?? 0} frases? No se puede deshacer.`)) return;
    await api("/sistema/frases", { method: "DELETE" });
    setMsg("Se borraron todas las frases.");
    await cargar();
    await cargarTema();
  }
  async function plantilla() {
    await descargar("/sistema/frases/plantilla", "plantilla_frases.xlsx");
  }

  const cuenta = (t: Frase["tipo"]) => frases?.filter((f) => f.tipo === t).length ?? 0;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Se muestran al azar debajo del botón de la pantalla de acceso. Cada quien elige ver frases, proverbios, citas bíblicas o todas.</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-primary cursor-pointer">
          <Icono nombre="upload" /> Importar Excel o CSV
          <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
        </label>
        <button type="button" className="btn-secondary" onClick={plantilla}>
          <Icono nombre="download" /> Plantilla
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} /> Reemplazar las actuales
        </label>
        {!!frases?.length && (
          <button type="button" className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline" onClick={borrarTodas}>
            <Icono nombre="trash" className="h-4 w-4" /> Borrar todas
          </button>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {cuenta("frase")} frase(s) · {cuenta("proverbio")} proverbio(s) · {cuenta("cita")} cita(s) bíblica(s)
        </span>
      </div>
      <p className="text-xs text-slate-500">Columnas: Tipo (Frase, Proverbio o Cita bíblica), Texto y Autor (o la referencia, p. ej. Filipenses 4:13).</p>
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      <ErrorBox message={error} />
      <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-tinta-900">
            <tr>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Texto</th>
              <th className="px-3 py-2">Autor</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {frases?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  Aún no hay frases. Descarga la plantilla, llénala e impórtala.
                </td>
              </tr>
            )}
            {frases?.map((f) => (
              <tr key={f.id}>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{TIPO_FRASE[f.tipo] ?? f.tipo}</td>
                <td className="px-3 py-2 text-tinta-900">{f.texto}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{f.autor ?? "—"}</td>
                <td className="px-2">
                  <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Eliminar" aria-label="Eliminar" onClick={() => borrar(f)}>
                    <Icono nombre="trash" className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Tienda en línea (comprar más empleados cuando se acaba el cupo) y soporte de Odai. */
function EnlacesOdai() {
  const [enlaces, setEnlaces] = useState<Enlaces>({ url_tienda: "", url_soporte: "" });
  const [guardado, setGuardado] = useState(JSON.stringify({ url_tienda: "", url_soporte: "" }));
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cargarTema().then((t) => {
      const e = { url_tienda: t.enlaces?.url_tienda ?? "", url_soporte: t.enlaces?.url_soporte ?? "" };
      setEnlaces(e);
      setGuardado(JSON.stringify(e));
    });
  }, []);

  async function guardar(e?: FormEvent) {
    e?.preventDefault();
    setMsg(null);
    setError(null);
    try {
      const t = await api<TemaGuardado>("/sistema/enlaces", {
        method: "PUT",
        body: JSON.stringify({ url_tienda: enlaces.url_tienda?.trim() || null, url_soporte: enlaces.url_soporte?.trim() || null }),
      });
      const n = { url_tienda: t.enlaces.url_tienda ?? "", url_soporte: t.enlaces.url_soporte ?? "" };
      setEnlaces(n);
      setGuardado(JSON.stringify(n));
      await cargarTema();
      setMsg("Enlaces guardados.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="max-w-2xl space-y-4" onSubmit={guardar}>
      <BarraGuardar sucio={JSON.stringify(enlaces) !== guardado} onGuardar={() => guardar()} />
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
    </form>
  );
}
