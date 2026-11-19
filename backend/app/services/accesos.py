# ruff: noqa: E501  (plantillas de correo con HTML y textos largos)
"""Enlaces para crear la clave (invitación al portal) o recuperarla."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import url_empresa
from app.models import Empresa, Rol, TokenAcceso, Usuario
from app.services import correo, plantillas_correo

HORAS = {"invitacion": 72, "recuperar": 1}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def crear(db: AsyncSession, usuario: Usuario, tipo: str) -> str:
    """Crea un enlace nuevo (anula los anteriores del mismo tipo) y devuelve el token."""
    ahora = datetime.now(UTC)
    await db.execute(
        update(TokenAcceso)
        .where(
            TokenAcceso.usuario_id == usuario.id,
            TokenAcceso.tipo == tipo,
            TokenAcceso.usado_en.is_(None),
        )
        .values(usado_en=ahora)
    )
    token = secrets.token_urlsafe(32)
    db.add(
        TokenAcceso(
            usuario_id=usuario.id,
            tipo=tipo,
            token_hash=_hash(token),
            expira=ahora + timedelta(hours=HORAS[tipo]),
        )
    )
    await db.flush()
    return token


async def validar(db: AsyncSession, token: str) -> TokenAcceso | None:
    t = await db.scalar(select(TokenAcceso).where(TokenAcceso.token_hash == _hash(token)))
    if t is None or t.usado_en is not None or t.expira < datetime.now(UTC):
        return None
    return t


def origen(request: Request, empresa: Empresa | None) -> str:
    """Dirección base para los enlaces: el subdominio de la empresa o, si no hay, la actual."""
    if empresa and (url := url_empresa(empresa.slug)):
        return url
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.headers.get("host", request.url.netloc))
    return f"{proto}://{host}"


async def enviar_enlace(
    db: AsyncSession, request: Request, usuario: Usuario, tipo: str
) -> tuple[bool, str]:
    """Crea el enlace y lo manda por correo. Devuelve (enviado, enlace)."""
    empresa = await db.get(Empresa, usuario.empresa_id) if usuario.empresa_id else None
    nombre = empresa.nombre if empresa else "ODAITIME"
    token = await crear(db, usuario, tipo)
    enlace = f"{origen(request, empresa)}/restablecer?token={token}"
    clave = tipo
    if tipo == "invitacion" and usuario.rol == Rol.ADMIN_EMPRESA:
        clave = "bienvenida_admin"
    c = plantillas_correo.armar(
        await plantillas_correo.obtener(db, clave),
        {
            "empresa": nombre,
            "nombre": usuario.nombre.split(" ")[0],
            "nombre_completo": usuario.nombre,
            "correo": usuario.email,
            "horas": str(HORAS[tipo]),
        },
    )
    enviado = await correo.enviar(
        db,
        para=usuario.email,
        asunto=c.asunto,
        nombre_empresa=nombre,
        titulo=c.titulo,
        parrafos=c.parrafos,
        boton=(c.boton, enlace) if c.boton else ("Abrir", enlace),
    )
    return enviado, enlace
