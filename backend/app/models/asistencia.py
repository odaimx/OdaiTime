import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPkMixin
from app.models.empleado import Empleado


class Incidencia(UUIDPkMixin, TimestampMixin, Base):
    """Vacaciones, incapacidades, permisos y faltas justificadas (rango de fechas)."""

    __tablename__ = "incidencias"

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    empleado_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empleados.id", ondelete="CASCADE"), index=True
    )
    tipo: Mapped[str] = mapped_column(String(20))
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date] = mapped_column(Date)
    notas: Mapped[str | None] = mapped_column(Text)
    folio: Mapped[str | None] = mapped_column(String(40))  # p. ej. folio de incapacidad del IMSS
    registrada_por: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL")
    )

    empleado: Mapped[Empleado] = relationship(lazy="joined")


class PoliticaAsistencia(UUIDPkMixin, TimestampMixin, Base):
    """Reglas internas de la empresa (reglamento interior) para la tarjeta de asistencia."""

    __tablename__ = "politica_asistencia"

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), unique=True
    )
    retardos_por_falta: Mapped[int] = mapped_column(default=0)
    retardo_falta_min: Mapped[int] = mapped_column(default=0)
    minimo_extra_min: Mapped[int] = mapped_column(default=30)
    redondeo_extra_min: Mapped[int] = mapped_column(default=30)
    # Pago al trabajar un festivo OPCIONAL (los obligatorios siempre: salario doble, art. 75).
    festivo_opcional_pago: Mapped[str] = mapped_column(String(10), default="doble")  # doble|normal
