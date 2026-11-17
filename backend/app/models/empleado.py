import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPkMixin
from app.models.sucursal import Sucursal
from app.models.turno import AsignacionTurno


class Empleado(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "empleados"
    __table_args__ = (
        UniqueConstraint("empresa_id", "numero", name="uq_empleado_empresa_numero"),
        UniqueConstraint("empresa_id", "curp", name="uq_empleado_empresa_curp"),
    )

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    sucursal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sucursales.id", ondelete="RESTRICT"), index=True
    )
    numero: Mapped[str] = mapped_column(String(20))
    nombre: Mapped[str] = mapped_column(String(100))
    apellido_paterno: Mapped[str] = mapped_column(String(100))
    apellido_materno: Mapped[str | None] = mapped_column(String(100))
    curp: Mapped[str | None] = mapped_column(String(18))
    rfc: Mapped[str | None] = mapped_column(String(13))
    nss: Mapped[str | None] = mapped_column(String(11))
    fecha_ingreso: Mapped[date] = mapped_column(Date)
    puesto: Mapped[str | None] = mapped_column(String(100))
    departamento: Mapped[str | None] = mapped_column(String(100))
    salario_diario: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    email: Mapped[str | None] = mapped_column(String(254))
    telefono: Mapped[str | None] = mapped_column(String(20))

    # Acceso opcional a la app (rol empleado) para checar desde el celular.
    usuario_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL"), unique=True
    )

    activo: Mapped[bool] = mapped_column(default=True)
    fecha_baja: Mapped[date | None] = mapped_column(Date)
    motivo_baja: Mapped[str | None] = mapped_column(String(300))

    sucursal: Mapped[Sucursal] = relationship(lazy="joined")
    asignaciones: Mapped[list[AsignacionTurno]] = relationship(
        lazy="selectin",
        order_by=AsignacionTurno.fecha_inicio.desc(),
        cascade="all, delete-orphan",
    )

    @property
    def nombre_completo(self) -> str:
        return " ".join(p for p in (self.nombre, self.apellido_paterno, self.apellido_materno) if p)

    def turno_en(self, dia: date) -> AsignacionTurno | None:
        for a in self.asignaciones:  # ordenadas de la más reciente a la más antigua
            if a.fecha_inicio <= dia and (a.fecha_fin is None or a.fecha_fin >= dia):
                return a
        return None
