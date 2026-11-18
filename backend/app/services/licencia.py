"""Límite de empleados por licencia.

Por ahora el límite vive en la empresa (licencia de prueba). Cuando exista el panel central de
Odai, este módulo leerá la licencia firmada que el nodo sincroniza; el resto del sistema no cambia.
"""

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import ConfigSistema, Empleado, Empresa


async def estado(db: AsyncSession, empresa_id: uuid.UUID, bloquear: bool = False) -> dict:
    q = select(Empresa.max_empleados, Empresa.licencia_vence).where(Empresa.id == empresa_id)
    if bloquear:
        # Serializa altas simultáneas para que dos peticiones no rebasen el límite.
        q = q.with_for_update()
    limite, vence = (await db.execute(q)).one()
    activos = await db.scalar(
        select(func.count())
        .select_from(Empleado)
        .where(Empleado.empresa_id == empresa_id, Empleado.activo)
    )
    return {
        "max_empleados": limite,
        "activos": activos,
        "disponibles": max(limite - activos, 0),
        "vence": vence,
        "vencida": vence is not None and vence < date.today(),
        "url_compra": await url_tienda(db),
    }


async def url_tienda(db: AsyncSession) -> str:
    """Tienda en línea de Odai para comprar más empleados (configuración del sistema)."""
    url = await db.scalar(select(ConfigSistema.url_tienda).where(ConfigSistema.id == 1))
    return url or get_settings().licencia_url_compra


async def verificar_cupo(db: AsyncSession, empresa_id: uuid.UUID, nuevos: int = 1) -> None:
    """Lanza 409 si dar de alta `nuevos` empleados rebasa la licencia."""
    e = await estado(db, empresa_id, bloquear=True)
    if e["vencida"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "codigo": "licencia_vencida",
                "mensaje": "Tu licencia está vencida. Renuévala para registrar empleados.",
                **_publico(e),
            },
        )
    if e["activos"] + nuevos > e["max_empleados"]:
        if nuevos == 1:
            mensaje = (
                f"Tu licencia permite {e['max_empleados']} empleados activos y ya los tienes "
                "todos registrados."
            )
        else:
            mensaje = (
                f"Intentas agregar {nuevos} empleados, pero solo tienes {e['disponibles']} "
                f"lugar(es) disponible(s) de {e['max_empleados']}."
            )
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"codigo": "limite_licencia", "mensaje": mensaje, **_publico(e)},
        )


def _publico(e: dict) -> dict:
    return {
        "max_empleados": e["max_empleados"],
        "activos": e["activos"],
        "disponibles": e["disponibles"],
        "url_compra": e["url_compra"],
    }
