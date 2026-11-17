from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPkMixin


class Empresa(UUIDPkMixin, TimestampMixin, Base):
    """Cliente del SaaS (tenant). Todo dato operativo cuelga de una empresa."""

    __tablename__ = "empresas"

    nombre: Mapped[str] = mapped_column(String(150))
    razon_social: Mapped[str | None] = mapped_column(String(250))
    rfc: Mapped[str | None] = mapped_column(String(13), unique=True)
    activa: Mapped[bool] = mapped_column(default=True)
