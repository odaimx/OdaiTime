"""WhatsApp Cloud API de Meta: enviar mensajes, bajar fotos y validar la firma del webhook.

Cada empresa usa su propio número (y su propia cuenta de pago en Meta). Los mensajes que el
empleado manda no se cobran; las respuestas son mensajes de servicio (1,000 gratis al mes por
número, luego Meta cobra por mensaje al cliente).
"""

import hashlib
import hmac
import logging
import re

import httpx

from app.core.cifrado import descifrar
from app.core.config import get_settings
from app.models import ConfigWhatsApp

log = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(10.0)


def solo_digitos(telefono: str | None) -> str:
    return re.sub(r"\D", "", telefono or "")


def ultimos10(telefono: str | None) -> str:
    """Los 10 dígitos del número en México (quita 52 / 521 / +)."""
    return solo_digitos(telefono)[-10:]


def firma_valida(app_secret: str, cuerpo: bytes, encabezado: str | None) -> bool:
    """X-Hub-Signature-256: sha256=HMAC(app_secret, cuerpo)."""
    if not app_secret or not encabezado or not encabezado.startswith("sha256="):
        return False
    esperada = hmac.new(app_secret.encode(), cuerpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperada, encabezado[7:])


def _token(cfg: ConfigWhatsApp) -> str:
    return descifrar(cfg.token) if cfg.token else ""


async def enviar_texto(cfg: ConfigWhatsApp, para: str, texto: str) -> tuple[bool, str | None]:
    """(enviado, error). Fuera de la ventana de 24 h Meta rechaza el texto libre."""
    if not (cfg.phone_number_id and cfg.token):
        return False, "Falta el identificador del número o el token"
    url = f"{get_settings().whatsapp_graph_url}/{cfg.phone_number_id}/messages"
    datos = {
        "messaging_product": "whatsapp",
        "to": solo_digitos(para),
        "type": "text",
        "text": {"body": texto[:4096], "preview_url": False},
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(url, json=datos, headers={"Authorization": f"Bearer {_token(cfg)}"})
        if r.status_code >= 400:
            detalle = r.json().get("error", {}).get("message", r.text) if r.content else r.text
            log.warning("WhatsApp rechazó el mensaje a %s: %s", para, detalle)
            return False, str(detalle)[:300]
        return True, None
    except (httpx.HTTPError, ValueError) as e:
        log.warning("No se pudo enviar WhatsApp a %s: %s", para, e)
        return False, "No hay conexión con WhatsApp"


async def descargar_media(cfg: ConfigWhatsApp, media_id: str) -> tuple[bytes, str] | None:
    """Baja una foto que mandó el empleado: (bytes, tipo MIME)."""
    cab = {"Authorization": f"Bearer {_token(cfg)}"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{get_settings().whatsapp_graph_url}/{media_id}", headers=cab)
            r.raise_for_status()
            info = r.json()
            f = await c.get(info["url"], headers=cab)
            f.raise_for_status()
        return f.content, info.get("mime_type", "image/jpeg").split(";")[0]
    except (httpx.HTTPError, KeyError, ValueError) as e:
        log.warning("No se pudo bajar la foto %s de WhatsApp: %s", media_id, e)
        return None


# --- Registro integrado (Embedded Signup, Tech Provider) ---


class ErrorMeta(Exception):
    """Meta rechazó un paso del registro integrado."""


async def _graph(metodo: str, ruta: str, *, token: str | None = None, **kw) -> dict:
    url = f"{get_settings().whatsapp_graph_url}/{ruta.lstrip('/')}"
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.request(metodo, url, headers=headers, **kw)
    except httpx.HTTPError as e:
        raise ErrorMeta(f"No se pudo conectar con Meta ({e.__class__.__name__})") from None
    datos = r.json() if r.content else {}
    if r.status_code >= 400:
        raise ErrorMeta(datos.get("error", {}).get("message", f"HTTP {r.status_code}"))
    return datos


async def registro_integrado(
    *,
    app_id: str,
    app_secret: str,
    code: str,
    waba_id: str,
    phone_number_id: str,
    webhook_url: str,
    verify_token: str,
    pin: str,
) -> dict:
    """Completa el registro integrado de Meta y devuelve token y número.

    1. Cambia el código del popup por el token de negocio del cliente.
    2. Suscribe la app a la cuenta de WhatsApp del cliente, con el webhook propio de la empresa.
    3. Registra el número en la Cloud API (con un PIN de verificación en dos pasos).
    """
    t = await _graph(
        "GET",
        "oauth/access_token",
        params={"client_id": app_id, "client_secret": app_secret, "code": code},
    )
    token = t.get("access_token")
    if not token:
        raise ErrorMeta("Meta no devolvió el token de acceso")
    await _graph(
        "POST",
        f"{waba_id}/subscribed_apps",
        token=token,
        json={"override_callback_uri": webhook_url, "verify_token": verify_token},
    )
    await _graph(
        "POST",
        f"{phone_number_id}/register",
        token=token,
        json={"messaging_product": "whatsapp", "pin": pin},
    )
    info = await _graph(
        "GET", phone_number_id, token=token, params={"fields": "display_phone_number"}
    )
    return {"token": token, "numero": info.get("display_phone_number")}
