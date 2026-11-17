import uuid
from datetime import date, time

from sqlalchemy import CheckConstraint, Date, Enum, ForeignKey, String, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPkMixin
from app.services.lft import TipoJornada


class Turno(UUIDPkMixin, TimestampMixin, Base):
    """Plantilla semanal de horario, reutilizable entre empleados."""

    __tablename__ = "turnos"
    __table_args__ = (UniqueConstraint("empresa_id", "nombre", name="uq_turno_empresa_nombre"),)

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    nombre: Mapped[str] = mapped_column(String(100))
    tipo_jornada: Mapped[TipoJornada] = mapped_column(
        Enum(
            TipoJornada,
            native_enum=False,
            length=10,
            values_callable=lambda e: [x.value for x in e],
        )
    )
    tolerancia_minutos: Mapped[int] = mapped_column(default=10)
    activo: Mapped[bool] = mapped_column(default=True)

    dias: Mapped[list["TurnoDia"]] = relationship(
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="TurnoDia.dia_semana",
    )


class TurnoDia(Base):
    """Un día laborable del turno. Los días que no aparecen son de descanso."""

    __tablename__ = "turno_dias"
    __table_args__ = (CheckConstraint("dia_semana BETWEEN 0 AND 6", name="ck_turno_dia_semana"),)

    turno_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("turnos.id", ondelete="CASCADE"), primary_key=True
    )
    dia_semana: Mapped[int] = mapped_column(primary_key=True)  # 0 = lunes
    entrada: Mapped[time] = mapped_column(Time)
    salida: Mapped[time] = mapped_column(Time)
    comida_minutos: Mapped[int] = mapped_column(default=0)


class AsignacionTurno(UUIDPkMixin, Base):
    """Historial de turnos del empleado. La vigente es la de fecha_inicio más reciente
    que no sea futura; fecha_fin se llena al asignar el siguiente."""

    __tablename__ = "asignaciones_turno"
    __table_args__ = (
        UniqueConstraint("empleado_id", "fecha_inicio", name="uq_asignacion_empleado_inicio"),
    )

    empleado_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empleados.id", ondelete="CASCADE"), index=True
    )
    turno_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("turnos.id", ondelete="RESTRICT"))
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date | None] = mapped_column(Date)

    turno: Mapped[Turno] = relationship(lazy="joined")
