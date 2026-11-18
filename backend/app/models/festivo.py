import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPkMixin


class DiaFestivo(UUIDPkMixin, TimestampMixin, Base):
    """Catálogo de días festivos.

    empresa_id NULL = catálogo nacional, mantenido por Odai (superadmin): los obligatorios del
    art. 74 (incluida la jornada electoral cuando se publique) y los opcionales más comunes.
    empresa_id con valor = día propio de la empresa (aniversario, día del gremio, etc.).
    """

    __tablename__ = "dias_festivos"
    __table_args__ = (UniqueConstraint("empresa_id", "fecha", name="uq_festivo_empresa_fecha"),)

    empresa_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    fecha: Mapped[date] = mapped_column(Date, index=True)
    nombre: Mapped[str] = mapped_column(String(120))
    tipo: Mapped[str] = mapped_column(String(12))  # obligatorio | opcional
    fundamento: Mapped[str | None] = mapped_column(String(200))  # p. ej. "Art. 74, fr. I LFT"


class FestivoDesignado(Base):
    """Empleados que la empresa designa para trabajar en un día festivo (art. 75 LFT).
    Los demás no pueden registrar entrada ese día."""

    __tablename__ = "festivo_designados"

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), primary_key=True
    )
    fecha: Mapped[date] = mapped_column(Date, primary_key=True)
    empleado_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empleados.id", ondelete="CASCADE"), primary_key=True
    )


class EmpresaFestivo(Base):
    """Festivos opcionales del catálogo nacional que la empresa decidió aplicar."""

    __tablename__ = "empresa_festivos"

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), primary_key=True
    )
    festivo_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dias_festivos.id", ondelete="CASCADE"), primary_key=True
    )
