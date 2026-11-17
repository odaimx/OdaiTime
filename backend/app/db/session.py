from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

settings = get_settings()

# En pruebas cada test usa su propio event loop: sin pool evitamos conexiones huérfanas.
_engine_kwargs = {"poolclass": NullPool} if settings.environment == "test" else {}
engine = create_async_engine(settings.database_url, pool_pre_ping=True, **_engine_kwargs)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
