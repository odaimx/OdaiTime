import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, ForeignKey, String, Table, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPkMixin
from app.models.empresa import Empresa
from app.models.sucursal import Sucursal


class Rol(enum.StrEnum):
    SUPERADMIN = "superadmin"  # Operador del SaaS (Odai). Sin empresa.
    ADMIN_EMPRESA = "admin_empresa"  # Administra toda su empresa.
    GERENTE_SUCURSAL = "gerente_sucursal"  # Solo las sucursales asignadas.
    EMPLEADO = "empleado"  # Checa y consulta lo propio.


usuario_sucursales = Table(
    "usuario_sucursales",
    Base.metadata,
    Column("usuario_id", ForeignKey("usuarios.id", ondelete="CASCADE"), primary_key=True),
    Column("sucursal_id", ForeignKey("sucursales.id", ondelete="CASCADE"), primary_key=True),
)


class Usuario(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "usuarios"

    empresa_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    email: Mapped[str] = mapped_column(String(254), unique=True)
    nombre: Mapped[str] = mapped_column(String(150))
    password_hash: Mapped[str] = mapped_column(String(255))
    rol: Mapped[Rol] = mapped_column(
        Enum(Rol, native_enum=False, length=30, values_callable=lambda e: [r.value for r in e])
    )
    activo: Mapped[bool] = mapped_column(default=True)
    ultimo_acceso: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    empresa: Mapped[Empresa | None] = relationship(lazy="joined")
    sucursales: Mapped[list[Sucursal]] = relationship(
        secondary=usuario_sucursales, lazy="selectin", order_by=Sucursal.nombre
    )


class Sesion(Base):
    """Refresh token emitido. Permite rotarlo y revocarlo (logout, desactivar usuario)."""

    __tablename__ = "sesiones"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)  # = jti
    usuario_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("usuarios.id", ondelete="CASCADE"), index=True
    )
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expira_en: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revocada_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
