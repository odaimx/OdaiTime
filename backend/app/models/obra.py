"""Obras: lugares de trabajo temporales (dependen de una sucursal)."""

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPkMixin
from app.models.empleado import Empleado
from app.models.sucursal import Sucursal


class Obra(UUIDPkMixin, TimestampMixin, Base):
    """Sitio temporal donde checan los empleados asignados (validación por ubicación)."""

    __tablename__ = "obras"
    __table_args__ = (UniqueConstraint("empresa_id", "clave"),)

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    # La sucursal da la zona horaria, la nómina y quién la administra.
    sucursal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sucursales.id"), index=True)
    clave: Mapped[str] = mapped_column(String(20))
    nombre: Mapped[str] = mapped_column(String(150))
    direccion: Mapped[str | None] = mapped_column(String(300))
    latitud: Mapped[float | None] = mapped_column(Numeric(9, 6, asdecimal=False))
    longitud: Mapped[float | None] = mapped_column(Numeric(9, 6, asdecimal=False))
    radio_metros: Mapped[int] = mapped_column(default=150)
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date | None] = mapped_column(Date)  # se cierra sola después de esta fecha
    activa: Mapped[bool] = mapped_column(default=True)

    sucursal: Mapped[Sucursal] = relationship(lazy="joined")

    def vigente(self, dia: date) -> bool:
        return (
            self.activa
            and self.fecha_inicio <= dia
            and (self.fecha_fin is None or dia <= self.fecha_fin)
        )


class AsignacionObra(UUIDPkMixin, TimestampMixin, Base):
    """Empleado asignado a una obra por un rango de fechas."""

    __tablename__ = "asignaciones_obra"

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    obra_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("obras.id", ondelete="CASCADE"), index=True
    )
    empleado_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empleados.id", ondelete="CASCADE"), index=True
    )
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date | None] = mapped_column(Date)

    obra: Mapped[Obra] = relationship(lazy="joined")
    empleado: Mapped[Empleado] = relationship(lazy="joined")
