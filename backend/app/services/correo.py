# ruff: noqa: E501  (plantillas de correo con HTML y textos largos)
"""Correo saliente general de Odai.

Un solo servidor SMTP (configurado por el superadmin) envía para todas las empresas; el
remitente visible es el nombre de la empresa del destinatario: "Hotel Caribe <no-responder@odai.lat>".
"""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ConfigCorreo

log = logging.getLogger(__name__)


async def config(db: AsyncSession) -> ConfigCorreo:
    c = await db.get(ConfigCorreo, 1)
    if c is None:
        c = ConfigCorreo(
            id=1,
            host="",
            puerto=587,
            seguridad="starttls",
            usuario="",
            password="",
            remitente="",
            activo=False,
        )
        db.add(c)
        await db.flush()
    return c


def _enviar_sync(c: ConfigCorreo, msg: EmailMessage) -> None:
    contexto = ssl.create_default_context()
    if c.seguridad == "ssl":
        with smtplib.SMTP_SSL(c.host, c.puerto, context=contexto, timeout=20) as s:
            if c.usuario:
                s.login(c.usuario, c.password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(c.host, c.puerto, timeout=20) as s:
            if c.seguridad == "starttls":
                s.starttls(context=contexto)
            if c.usuario:
                s.login(c.usuario, c.password)
            s.send_message(msg)


def _html(
    nombre_empresa: str, titulo: str, parrafos: list[str], boton: tuple[str, str] | None
) -> str:
    cuerpo = "".join(f'<p style="margin:0 0 14px">{p}</p>' for p in parrafos)
    if boton:
        texto, url = boton
        cuerpo += (
            f'<p style="margin:24px 0"><a href="{url}" style="background:#1a2c4f;color:#ffffff;'
            f'padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">{texto}</a></p>'
            f'<p style="margin:0;color:#64748b;font-size:12px">Si el botón no funciona, copia este enlace: {url}</p>'
        )
    return (
        '<div style="font-family:Segoe UI,Arial,sans-serif;background:#f1f5f9;padding:24px">'
        '<div style="max-width:560px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden">'
        f'<div style="background:#13204a;color:#e2c68f;padding:18px 24px;font-size:18px;font-weight:600">{nombre_empresa}</div>'
        f'<div style="padding:24px;color:#1a2c4f;font-size:14px;line-height:1.5"><h2 style="margin:0 0 16px;font-size:18px">{titulo}</h2>{cuerpo}</div>'
        '<div style="padding:12px 24px;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0">Enviado por ODAITIME · © ODAI</div>'
        "</div></div>"
    )


async def enviar(
    db: AsyncSession,
    *,
    para: str,
    asunto: str,
    nombre_empresa: str,
    titulo: str,
    parrafos: list[str],
    boton: tuple[str, str] | None = None,
) -> bool:
    """Envía el correo. Devuelve False (y lo registra) si no hay servidor configurado o falla."""
    c = await config(db)
    if not (c.activo and c.host and c.remitente):
        log.warning("Correo no configurado: no se envió '%s' a %s", asunto, para)
        return False
    msg = EmailMessage()
    msg["Subject"] = asunto
    msg["From"] = formataddr((nombre_empresa, c.remitente))
    msg["To"] = para
    msg["Message-ID"] = make_msgid(domain=c.remitente.split("@")[-1] or None)
    texto = "\n\n".join(parrafos) + (f"\n\n{boton[0]}: {boton[1]}" if boton else "")
    msg.set_content(texto)
    msg.add_alternative(_html(nombre_empresa, titulo, parrafos, boton), subtype="html")
    try:
        await asyncio.to_thread(_enviar_sync, c, msg)
        return True
    except (OSError, smtplib.SMTPException):
        log.exception("No se pudo enviar el correo '%s' a %s", asunto, para)
        return False
