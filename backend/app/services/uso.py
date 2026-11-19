"""Integridad al borrar: un registro que otros usan no se borra; se explica quién lo usa."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute


async def contar(db: AsyncSession, columna: InstrumentedAttribute, valor: uuid.UUID) -> int:
    return await db.scalar(select(func.count()).where(columna == valor)) or 0


def _lista(partes: list[str]) -> str:
    return partes[0] if len(partes) == 1 else ", ".join(partes[:-1]) + " y " + partes[-1]


def bloquear_si_se_usa(registro: str, usos: list[tuple[int, str, str, str]], baja: str) -> None:
    """Lanza 409 si algún uso tiene registros.

    usos: (cantidad, singular, plural, vista donde están). baja: qué hacer en su lugar.
    """
    partes = [f"{n} {sing if n == 1 else plur} (en {vista})" for n, sing, plur, vista in usos if n]
    if partes:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"No se puede eliminar {registro}: lo usan {_lista(partes)}. "
            f"Primero elimina o cambia esos registros; si deben conservarse, {baja}.",
        )
