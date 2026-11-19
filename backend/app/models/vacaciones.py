import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPkMixin
from app.models.empleado import Empleado


class SolicitudVacaciones(UUIDPkMixin, TimestampMixin, Base):
    """Vacaciones que pide el empleado desde el portal. Al aprobarse se crea la incidencia."""

    __tablename__ = "solicitudes_vacaciones"

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    empleado_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empleados.id", ondelete="CASCADE"), index=True
    )
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date] = mapped_column(Date)
    dias: Mapped[int]  # días hábiles que descuenta (sin descansos ni festivos)
    motivo: Mapped[str | None] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(String(12), default="pendiente", index=True)
    # pendiente | aprobada | rechazada | cancelada
    comentario: Mapped[str | None] = mapped_column(Text)  # de quien responde
    respondida_por: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL")
    )
    respondida_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    incidencia_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("incidencias.id", ondelete="SET NULL")
    )

    empleado: Mapped[Empleado] = relationship(lazy="joined")
