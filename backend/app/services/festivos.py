"""Días festivos que aplican a una empresa en un rango de fechas."""

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DiaFestivo, EmpresaFestivo, FestivoDesignado
from app.services import calendario


async def aplicables(
    db: AsyncSession, empresa_id: uuid.UUID, desde: date, hasta: date
) -> tuple[dict[date, str], set[date]]:
    """(festivos que se descansan, cuáles son obligatorios por ley).

    - Obligatorios del catálogo nacional (art. 74): siempre aplican.
    - Opcionales del catálogo nacional: solo los que la empresa eligió.
    - Días propios de la empresa: siempre aplican (como opcionales para el pago).
    Si el catálogo nacional no tiene un año cargado, se calculan los del art. 74.
    """
    nacionales = list(
        await db.scalars(
            select(DiaFestivo).where(
                DiaFestivo.empresa_id.is_(None), DiaFestivo.fecha.between(desde, hasta)
            )
        )
    )
    elegidos = set(
        await db.scalars(
            select(EmpresaFestivo.festivo_id).where(EmpresaFestivo.empresa_id == empresa_id)
        )
    )
    propios = list(
        await db.scalars(
            select(DiaFestivo).where(
                DiaFestivo.empresa_id == empresa_id, DiaFestivo.fecha.between(desde, hasta)
            )
        )
    )

    festivos: dict[date, str] = {}
    obligatorios: set[date] = set()
    anios_cargados = {f.fecha.year for f in nacionales if f.tipo == "obligatorio"}
    for anio in range(desde.year, hasta.year + 1):
        if anio not in anios_cargados:
            for f, n in calendario.festivos(anio).items():
                if desde <= f <= hasta:
                    festivos[f] = n
                    obligatorios.add(f)
    for f in nacionales:
        if f.tipo == "obligatorio":
            festivos[f.fecha] = f.nombre
            obligatorios.add(f.fecha)
        elif f.id in elegidos:
            festivos.setdefault(f.fecha, f.nombre)
    for f in propios:
        festivos.setdefault(f.fecha, f.nombre)
    return festivos, obligatorios


async def festivo_del_dia(db: AsyncSession, empresa_id: uuid.UUID, dia: date) -> str | None:
    fest, _ = await aplicables(db, empresa_id, dia, dia)
    return fest.get(dia)


async def designado(
    db: AsyncSession, empresa_id: uuid.UUID, dia: date, empleado_id: uuid.UUID
) -> bool:
    return (
        await db.scalar(
            select(FestivoDesignado.empleado_id).where(
                FestivoDesignado.empresa_id == empresa_id,
                FestivoDesignado.fecha == dia,
                FestivoDesignado.empleado_id == empleado_id,
            )
        )
        is not None
    )
