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
