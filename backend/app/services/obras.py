"""Obras: qué obra le toca a un empleado un día y validación de ubicación al checar."""

import uuid
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AsignacionObra, Obra


def _vigentes(dia: date):
    return (
        select(AsignacionObra)
        .join(Obra, Obra.id == AsignacionObra.obra_id)
        .where(
            AsignacionObra.fecha_inicio <= dia,
            or_(AsignacionObra.fecha_fin.is_(None), AsignacionObra.fecha_fin >= dia),
            Obra.activa,
            Obra.fecha_inicio <= dia,
            or_(Obra.fecha_fin.is_(None), Obra.fecha_fin >= dia),
        )
    )


async def obra_del_dia(db: AsyncSession, empleado_id: uuid.UUID, dia: date) -> Obra | None:
    """La obra vigente asignada al empleado ese día (la asignación más reciente)."""
    a = await db.scalar(
        _vigentes(dia)
        .where(AsignacionObra.empleado_id == empleado_id)
        .order_by(AsignacionObra.fecha_inicio.desc())
        .limit(1)
    )
    return a.obra if a else None


async def obras_por_empleado(
    db: AsyncSession, empresa_id: uuid.UUID, desde: date, hasta: date
) -> dict[uuid.UUID, list[AsignacionObra]]:
    """Asignaciones que tocan el periodo, por empleado (para reportes)."""
    filas = await db.scalars(
        select(AsignacionObra).where(
            AsignacionObra.empresa_id == empresa_id,
            AsignacionObra.fecha_inicio <= hasta,
            or_(AsignacionObra.fecha_fin.is_(None), AsignacionObra.fecha_fin >= desde),
        )
    )
    salida: dict[uuid.UUID, list[AsignacionObra]] = {}
    for a in filas:
        salida.setdefault(a.empleado_id, []).append(a)
    return salida


def obra_en(asignaciones: list[AsignacionObra], dia: date) -> Obra | None:
    vigentes = [
        a
        for a in asignaciones
        if a.fecha_inicio <= dia
        and (a.fecha_fin is None or dia <= a.fecha_fin)
        and a.obra.vigente(dia)
    ]
    return max(vigentes, key=lambda a: a.fecha_inicio).obra if vigentes else None
