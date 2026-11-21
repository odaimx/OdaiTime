"""Borrado automático de las fotos de checadas pasado el plazo (Configuración de ODAITIME).

Se borra solo la imagen; la checada (fecha, hora, tipo, ubicación, dispositivo) se conserva.
Corre una vez al día dentro de la API (un solo proceso a la vez, con candado en Valkey) y
también desde `python -m app.purgar`.
"""

import asyncio
import logging
from datetime import UTC, datetime

from redis.asyncio import Redis
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Checada, ConfigSistema
from app.services import checadas as svc

log = logging.getLogger(__name__)
LOTE = 500


def limite(meses: int, ahora: datetime | None = None) -> datetime:
    """Misma fecha y hora, `meses` atrás (día ajustado al fin de mes)."""
    a = ahora or datetime.now(UTC)
    m = a.month - 1 - meses
    anio, mes = a.year + m // 12, m % 12 + 1
    for dia in (a.day, 30, 29, 28):
        try:
            return a.replace(year=anio, month=mes, day=dia)
        except ValueError:
            continue
    raise ValueError("fecha inválida")


async def meses_configurados(db: AsyncSession) -> int | None:
    c = await db.get(ConfigSistema, 1)
    return 24 if c is None else c.retencion_fotos_meses


async def por_borrar(db: AsyncSession, meses: int | None) -> int:
    if not meses:
        return 0
    return (
        await db.scalar(
            select(func.count(Checada.id)).where(
                Checada.foto.is_not(None), Checada.momento < limite(meses)
            )
        )
        or 0
    )


async def purgar_fotos(db: AsyncSession, meses: int | None) -> int:
    """Borra los archivos y quita la referencia; devuelve cuántas fotos se borraron."""
    if not meses:
        return 0
    corte = limite(meses)
    base = svc.dir_fotos().resolve()
    total = 0
    while True:
        filas = (
            await db.execute(
                select(Checada.id, Checada.foto)
                .where(Checada.foto.is_not(None), Checada.momento < corte)
                .limit(LOTE)
            )
        ).all()
        if not filas:
            break
        for _, rel in filas:
            ruta = (base / rel).resolve()
            if ruta.is_relative_to(base):  # nunca fuera del almacén de fotos
                ruta.unlink(missing_ok=True)
        await db.execute(
            update(Checada).where(Checada.id.in_([i for i, _ in filas])).values(foto=None)
        )
        await db.commit()
        total += len(filas)
    return total


async def tarea_diaria() -> None:
    """Revisa cada 6 h; la purga corre como máximo una vez al día entre todos los procesos."""
    from app.db.session import SessionLocal

    while True:
        try:
            async with Redis.from_url(get_settings().redis_url) as r:
                turno = await r.set("odaitime:purga_fotos", "1", ex=20 * 3600, nx=True)
            if turno:
                async with SessionLocal() as db:
                    meses = await meses_configurados(db)
                    n = await purgar_fotos(db, meses)
                if n:
                    log.info("Fotos de checadas borradas (más de %s meses): %s", meses, n)
        except Exception:  # noqa: BLE001 — no debe tumbar la API
            log.exception("No se pudo purgar las fotos de checadas")
        await asyncio.sleep(6 * 3600)
