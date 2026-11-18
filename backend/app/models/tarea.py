import uuid
from datetime import date, datetime, time

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDPkMixin
from app.models.usuario import Usuario


class Tarea(UUIDPkMixin, Base):
    """Actividad programada, como las de Odoo: llamar, reunión, tarea o recordatorio.

    Puede ir ligada a un registro (empleado, sucursal, turno…) o ser general. Se ve en el
    reloj de cada registro, en el calendario y en "Mis actividades". Al marcarla como hecha
    se anota en la bitácora del registro.
    """

    __tablename__ = "tareas"
    __table_args__ = (
        Index("ix_tareas_registro", "modelo", "registro_id"),
        Index("ix_tareas_empresa_fecha", "empresa_id", "fecha"),
    )

    empresa_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("empresas.id", ondelete="CASCADE"))
    modelo: Mapped[str | None] = mapped_column(String(30))
    registro_id: Mapped[uuid.UUID | None]
    registro_nombre: Mapped[str | None] = mapped_column(String(200))
    tipo: Mapped[str] = mapped_column(String(15))  # llamada, reunion, correo, tarea, recordatorio
    resumen: Mapped[str] = mapped_column(String(200))
    nota: Mapped[str | None] = mapped_column(Text)
    fecha: Mapped[date] = mapped_column(Date)
    hora: Mapped[time | None] = mapped_column(Time)
    asignado_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL")
    )
    creado_por_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL")
    )
    hecha_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    comentario: Mapped[str | None] = mapped_column(Text)  # lo que se anotó al terminarla
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    asignado: Mapped[Usuario | None] = relationship(foreign_keys=[asignado_id], lazy="joined")
