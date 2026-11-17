import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base de todos los modelos. Alembic la usa para autogenerar migraciones."""


class UUIDPkMixin:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    # Trae created_at/updated_at con RETURNING tras insert/update: en async no hay lazy-load.
    __mapper_args__ = {"eager_defaults": True}

    # Siempre en UTC (timestamptz); la conversión a hora local se hace por sucursal.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
