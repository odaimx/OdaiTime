"""Aviso de privacidad para el checado (LFPDPPP).

El aviso se acepta una vez por empleado y versión; si cambia el texto se sube VERSION y todos
lo vuelven a aceptar. Responsable y domicilio salen de los datos de la empresa.
"""

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import AvisoAceptado, Empleado, Empresa
from app.services import checadas as svc

VERSION = "2026-11"


def datos(empresa: Empresa) -> dict:
    return {
        "version": VERSION,
        "responsable": empresa.razon_social or empresa.nombre,
        "domicilio": empresa.direccion,
    }


async def aceptado(db, empleado_id) -> bool:
    return (
        await db.scalar(
            select(AvisoAceptado.id).where(
                AvisoAceptado.empleado_id == empleado_id, AvisoAceptado.version == VERSION
            )
        )
        is not None
    )


def ip_de(request: Request) -> str:
    return (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "")
    )[:45]


async def registrar(db, empleado: Empleado, *, medio: str, request: Request) -> None:
    """Guarda la constancia (si ya existe, no hace nada)."""
    if await aceptado(db, empleado.id):
        return
    try:
        async with db.begin_nested():
            db.add(
                AvisoAceptado(
                    empresa_id=empleado.empresa_id,
                    empleado_id=empleado.id,
                    version=VERSION,
                    medio=medio,
                    ip=ip_de(request) or None,
                    equipo=request.headers.get("user-agent", "")[:120] or None,
                )
            )
    except IntegrityError:
        pass  # aceptado al mismo tiempo desde otro equipo


async def exigir(db, empleado: Empleado, version: str | None, *, medio: str, request: Request):
    """Sin aviso aceptado no se checa: si mandan la versión vigente, se registra."""
    if version == VERSION:
        await registrar(db, empleado, medio=medio, request=request)
    elif not await aceptado(db, empleado.id):
        raise svc.error(
            "aviso_requerido", "Lee y acepta el aviso de privacidad para continuar.", http=428
        )
