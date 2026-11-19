"""Purga las empresas eliminadas cuyo periodo de conservación ya pasó.

Uso (cron diario en el servidor):
    docker compose exec -T api python -m app.purgar
"""

import asyncio
import logging

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.estado_empresa import purgar


async def main() -> None:
    dias = get_settings().retencion_dias
    async with SessionLocal() as db:
        borradas = await purgar(db, dias)
    logging.basicConfig(level=logging.INFO)
    logging.info("Empresas purgadas (más de %s días eliminadas): %s", dias, borradas or "ninguna")


if __name__ == "__main__":
    asyncio.run(main())
