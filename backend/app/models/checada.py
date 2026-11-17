import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPkMixin
from app.models.empleado import Empleado
from app.models.sucursal import Sucursal


class ConfigChecadas(UUIDPkMixin, TimestampMixin, Base):
    """Cómo se checa. sucursal_id NULL = configuración general de la empresa;
    una fila con sucursal_id la reemplaza completa para esa sucursal."""

    __tablename__ = "config_checadas"

    empresa_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("empresas.id", ondelete="CASCADE"))
    sucursal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sucursales.id", ondelete="CASCADE")
    )
    permitir_movil: Mapped[bool] = mapped_column(default=True)
    permitir_kiosco: Mapped[bool] = mapped_column(default=True)
    validar_gps: Mapped[bool] = mapped_column(default=True)
    validar_qr: Mapped[bool] = mapped_column(default=False)
    foto: Mapped[str] = mapped_column(String(10), default="ninguna")  # ninguna|movil|kiosco|ambos
    pin_kiosco: Mapped[bool] = mapped_column(default=True)
    minutos_antes_entrada: Mapped[int] = mapped_column(default=60)
    ignorar_repetida_min: Mapped[int] = mapped_column(default=5)
    permitir_offline: Mapped[bool] = mapped_column(default=True)
    offline_max_horas: Mapped[int] = mapped_column(default=24)


class Dispositivo(UUIDPkMixin, TimestampMixin, Base):
    """Kiosco (tablet) o reloj biométrico vinculado a una sucursal."""

    __tablename__ = "dispositivos"

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    sucursal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sucursales.id", ondelete="CASCADE"))
    nombre: Mapped[str] = mapped_column(String(100))
    tipo: Mapped[str] = mapped_column(String(15), default="kiosco")  # kiosco | biometrico
    serie: Mapped[str | None] = mapped_column(String(60))  # n.º de serie del reloj biométrico
    token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    codigo_vinculacion: Mapped[str | None] = mapped_column(String(6))
    codigo_expira: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    vinculado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ultima_conexion: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    activo: Mapped[bool] = mapped_column(default=True)

    sucursal: Mapped[Sucursal] = relationship(lazy="joined")


class Checada(UUIDPkMixin, Base):
    __tablename__ = "checadas"
    __table_args__ = (Index("ix_checadas_empleado_momento", "empleado_id", "momento"),)

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    empleado_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("empleados.id", ondelete="CASCADE"))
    sucursal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sucursales.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(10))  # entrada | salida
    # Hora en que se checó (del servidor; del dispositivo solo si llegó sin conexión).
    momento: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    recibida_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    origen: Mapped[str] = mapped_column(String(12))  # movil | kiosco | biometrico | manual
    offline: Mapped[bool] = mapped_column(default=False)
    latitud: Mapped[float | None] = mapped_column(Numeric(9, 6, asdecimal=False))
    longitud: Mapped[float | None] = mapped_column(Numeric(9, 6, asdecimal=False))
    precision_m: Mapped[int | None]
    distancia_m: Mapped[int | None]
    foto: Mapped[str | None] = mapped_column(String(200))  # ruta relativa en el almacén
    dispositivo_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("dispositivos.id", ondelete="SET NULL")
    )
    retardo_minutos: Mapped[int | None]  # solo entradas fuera de tolerancia
    estado: Mapped[str] = mapped_column(String(10), default="valida")  # valida | anulada
    corregida: Mapped[bool] = mapped_column(default=False)
    registrada_por: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL")
    )

    empleado: Mapped[Empleado] = relationship(lazy="joined")
    sucursal: Mapped[Sucursal] = relationship(lazy="joined")
