/**
 * Registro integrado de WhatsApp (Embedded Signup de Meta, como Tech Provider).
 *
 * Abre el popup de Meta con la app de Odai: el cliente inicia sesión con su Facebook, elige o crea
 * su cuenta de WhatsApp Business y su número. Meta avisa por postMessage el waba_id y el
 * phone_number_id, y el callback de FB.login trae un código de un solo uso que el servidor cambia
 * por el token (el secreto de la app nunca llega al navegador).
 */

export interface DatosRegistro {
  app_id: string;
  config_id: string;
  version: string;
}
export interface ResultadoRegistro {
  code: string;
  waba_id: string;
  phone_number_id: string;
}

type FB = {
  init: (o: Record<string, unknown>) => void;
  login: (cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void, o: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    FB?: FB;
    fbAsyncInit?: () => void;
  }
}

let cargando: Promise<FB> | null = null;

function cargarSdk(datos: DatosRegistro): Promise<FB> {
  if (cargando) return cargando;
  cargando = new Promise<FB>((ok, mal) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: datos.app_id, autoLogAppEvents: true, xfbml: false, version: datos.version });
      ok(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/es_LA/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => {
      cargando = null;
      mal(new Error("No se pudo cargar el inicio de sesión de Meta. Revisa tu conexión o el bloqueador de anuncios."));
    };
    document.body.appendChild(s);
  });
  return cargando;
}

export async function registrarConMeta(datos: DatosRegistro): Promise<ResultadoRegistro> {
  const fb = await cargarSdk(datos);
  return new Promise((ok, mal) => {
    let ids: { waba_id: string; phone_number_id: string } | null = null;
    let code: string | null = null;
    const terminar = () => {
      if (!code || !ids) return;
      window.removeEventListener("message", escuchar);
      ok({ code, ...ids });
    };
    // Meta manda los identificadores al terminar el flujo (solo se aceptan mensajes de facebook.com).
    function escuchar(ev: MessageEvent) {
      if (!/^https:\/\/([a-z0-9-]+\.)?facebook\.com$/.test(ev.origin)) return;
      let d: { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string; current_step?: string } };
      try {
        d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (d.event === "FINISH" && d.data?.waba_id && d.data.phone_number_id) {
        ids = { waba_id: d.data.waba_id, phone_number_id: d.data.phone_number_id };
        terminar();
      } else if (d.event === "CANCEL" || d.event === "ERROR") {
        window.removeEventListener("message", escuchar);
        mal(new Error(d.event === "CANCEL" ? "Cancelaste el registro en Meta." : "Meta reportó un error en el registro."));
      }
    }
    window.addEventListener("message", escuchar);
    fb.login(
      (r) => {
        code = r.authResponse?.code ?? null;
        if (!code) {
          window.removeEventListener("message", escuchar);
          return mal(new Error("No se completó el inicio de sesión con Meta."));
        }
        // El mensaje con los identificadores puede llegar un poco después del callback.
        setTimeout(() => {
          if (!ids) {
            window.removeEventListener("message", escuchar);
            mal(new Error("Meta no envió el número elegido. Intenta de nuevo."));
          }
        }, 8000);
        terminar();
      },
      {
        config_id: datos.config_id,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  });
}
