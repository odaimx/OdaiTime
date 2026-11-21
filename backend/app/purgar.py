"""Purga las empresas eliminadas y las fotos de checadas vencidas.

Uso (cron diario en el servidor):
    docker compose exec -T api python -m app.purgar
"""

import asyncio
import logging

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.estado_empresa import purgar
from app.services.retencion import meses_configurados, purgar_fotos


async def main() -> None:
    dias = get_settings().retencion_dias
    async with SessionLocal() as db:
        borradas = await purgar(db, dias)
    logging.basicConfig(level=logging.INFO)
    logging.info("Empresas purgadas (más de %s días eliminadas): %s", dias, borradas or "ninguna")
    async with SessionLocal() as db:
        meses = await meses_configurados(db)
        fotos = await purgar_fotos(db, meses)
    logging.info("Fotos de checadas borradas (más de %s meses): %s", meses, fotos)


if __name__ == "__main__":
    asyncio.run(main())
