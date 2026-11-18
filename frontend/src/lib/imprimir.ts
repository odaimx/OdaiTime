/**
 * Documentos imprimibles (se guardan como PDF desde el diálogo de impresión del navegador).
 * Mismo encabezado en todos: logo y nombre de la empresa, título y fecha.
 */

export const REPORTE = { empresa: { nombre: "ODAITIME", logo: "" as string } };

export const escapar = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const ESTILO = `
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a2c4f; font-size: 11px; margin: 0; }
  header { display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #13204a; padding-bottom: 8px; margin-bottom: 12px; }
  header img { max-height: 42px; max-width: 140px; object-fit: contain; }
  h1 { font-size: 18px; margin: 0; } .sub { color: #64748b; margin: 2px 0 0; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #8a64de; margin: 16px 0 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
  .filtros { margin: 0 0 10px; color: #475569; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #13204a; color: #e2c68f; text-align: left; padding: 6px; font-weight: 600; }
  td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8f7fc; }
  .campos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px; }
  .campo dt { color: #64748b; font-size: 10px; } .campo dd { margin: 1px 0 0; font-size: 12px; font-weight: 500; min-height: 14px; }
  footer { margin-top: 14px; color: #94a3b8; font-size: 10px; }
`;

/** Abre la hoja con el contenido HTML y lanza la impresión. */
export function imprimirHtml(titulo: string, cuerpo: string, horizontal = false) {
  const e = REPORTE.empresa;
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${escapar(titulo)}</title>
<style>@page { size: ${horizontal ? "landscape" : "portrait"}; margin: 14mm; }${ESTILO}</style></head><body>
<header>${e.logo ? `<img src="${e.logo}" alt="">` : ""}<div><h1>${escapar(titulo)}</h1><p class="sub">${escapar(e.nombre)} · ${new Date().toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" })}</p></div></header>
${cuerpo}
<footer>Generado con ODAITIME</footer>
<script>window.onload = () => setTimeout(() => window.print(), 200);</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return alert("Permite las ventanas emergentes para generar el PDF.");
  w.document.write(html);
  w.document.close();
}

/** Tabla con encabezado y filtros aplicados. */
export function imprimirTabla(titulo: string, columnas: string[], filas: unknown[][], filtros: string[] = []) {
  const cuerpo = `${filtros.length ? `<p class="filtros"><strong>Filtros:</strong> ${escapar(filtros.join(" · "))}</p>` : ""}
<table><thead><tr>${columnas.map((c) => `<th>${escapar(c)}</th>`).join("")}</tr></thead>
<tbody>${filas.map((f) => `<tr>${f.map((v) => `<td>${escapar(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>
<p class="filtros" style="margin-top:8px">${filas.length} registro(s)</p>`;
  imprimirHtml(titulo, cuerpo, columnas.length > 6);
}

/** Campos en dos columnas, sin recuadros. */
export const campos = (lista: [string, unknown][]) =>
  `<dl class="campos">${lista.map(([k, v]) => `<div class="campo"><dt>${escapar(k)}</dt><dd>${escapar(v) || "—"}</dd></div>`).join("")}</dl>`;

/** Convierte una URL (blob o del mismo sitio) en data URL para la hoja impresa. */
export async function aDataUrl(url: string): Promise<string> {
  const b = await (await fetch(url)).blob();
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = mal;
    r.readAsDataURL(b);
  });
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Texto que muestra un control (opción elegida, Sí/No, fecha legible…). */
function valorDe(c: Control): string | null {
  if (c instanceof HTMLSelectElement) return c.selectedOptions[0]?.text ?? "";
  if (c instanceof HTMLInputElement) {
    if (["password", "file", "hidden", "button", "submit"].includes(c.type)) return null;
    if (c.type === "checkbox" || c.type === "radio") return c.checked ? "Sí" : "No";
    if (c.type === "date" && c.value) return new Date(c.value + "T12:00").toLocaleDateString("es-MX", { dateStyle: "medium" });
    if (!c.value && c.placeholder?.includes("asignado")) return "Asignado";
  }
  return c.value;
}

const controlDe = (raiz: HTMLElement, l: HTMLLabelElement): Control | null => {
  const porId = l.htmlFor ? raiz.querySelector<Control>(`#${CSS.escape(l.htmlFor)}`) : null;
  return porId ?? l.querySelector<Control>("input, select, textarea");
};

const textoEtiqueta = (l: HTMLElement) => (l.textContent ?? "").replace(/\s*\?\s*$/, "").replace(/\s+/g, " ").trim();

/** Copia de una tabla sin botones ni casillas, con los valores de los controles como texto. */
function tablaLimpia(t: HTMLTableElement): string {
  const copia = t.cloneNode(true) as HTMLTableElement;
  const originales = t.querySelectorAll<Control>("input, select, textarea");
  copia.querySelectorAll<Control>("input, select, textarea").forEach((c, i) => {
    const v = valorDe(originales[i]);
    c.replaceWith(document.createTextNode(v ?? ""));
  });
  copia.querySelectorAll("button, svg, img").forEach((b) => b.remove());
  copia.querySelectorAll("*").forEach((el) => {
    el.removeAttribute("class");
    el.removeAttribute("style");
  });
  // Quita columnas vacías (casillas de selección, acciones).
  const filas = [...copia.rows];
  const ancho = Math.max(0, ...filas.map((f) => f.cells.length));
  for (let i = ancho - 1; i >= 0; i--) {
    if (filas.every((f) => !f.cells[i] || !(f.cells[i].textContent ?? "").trim())) filas.forEach((f) => f.cells[i]?.remove());
  }
  return copia.outerHTML;
}

/**
 * Reporte de un registro con el mismo formato que las demás fichas: toma los campos del
 * formulario en pantalla (etiqueta → valor) en dos columnas, y sus tablas e historiales.
 */
export function imprimirFormulario(raiz: HTMLElement, titulo: string, subtitulo = "") {
  const partes: string[] = [];
  let actuales: [string, unknown][] = [];
  const vistos = new Set<Element>();
  const volcar = () => {
    if (actuales.length) partes.push(campos(actuales));
    actuales = [];
  };
  const recorrer = (el: Element) => {
    for (const hijo of Array.from(el.children)) {
      if (hijo.closest("[data-no-imprimir]") || hijo.getAttribute("role") === "tablist") continue;
      if (hijo instanceof HTMLTableElement) {
        volcar();
        if (hijo.rows.length > 1 || (hijo.tBodies[0]?.rows.length ?? 0) > 0) partes.push(tablaLimpia(hijo));
        continue;
      }
      if (hijo.tagName === "SUMMARY" || /^H[2-4]$/.test(hijo.tagName)) {
        const t = textoEtiqueta(hijo as HTMLElement);
        if (t && t !== titulo) {
          volcar();
          partes.push(`<h2>${escapar(t)}</h2>`);
        }
        continue;
      }
      if (hijo instanceof HTMLLabelElement) {
        const etiqueta = textoEtiqueta(hijo).replace(/\s*\*$/, "");
        const c = controlDe(raiz, hijo);
        if (c && !vistos.has(c)) {
          vistos.add(c);
          const v = valorDe(c);
          if (v !== null && etiqueta) actuales.push([etiqueta, v]);
          continue;
        }
        // Renglón de solo lectura (p. ej. Estado): el valor es el texto de al lado.
        const junto = hijo.nextElementSibling;
        if (!c && etiqueta && junto && !junto.querySelector("input, select, textarea, table")) {
          vistos.add(junto);
          actuales.push([etiqueta, (junto.textContent ?? "").replace(/\s+/g, " ").trim()]);
          continue;
        }
      }
      if (vistos.has(hijo)) continue;
      recorrer(hijo);
    }
  };
  recorrer(raiz);
  volcar();
  const sub = subtitulo.replace(/^[\s·]+/, "").trim();
  imprimirHtml(sub ? `${titulo} · ${sub}` : titulo, partes.join("\n") || "<p>Sin datos.</p>");
}
