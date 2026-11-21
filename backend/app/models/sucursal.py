import uuid

from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPkMixin
from app.models.domicilio import DomicilioMixin


class Sucursal(DomicilioMixin, UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "sucursales"
    __table_args__ = (UniqueConstraint("empresa_id", "clave", name="uq_sucursal_empresa_clave"),)

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    clave: Mapped[str] = mapped_column(String(20))
    nombre: Mapped[str] = mapped_column(String(150))
    # Zona IANA (America/Cancun, America/Mexico_City, ...). Define la hora local de las checadas.
    zona_horaria: Mapped[str] = mapped_column(String(64), default="America/Mexico_City")
    direccion: Mapped[str | None] = mapped_column(String(300))
    # Geocerca para validar checadas por GPS (Etapa 4).
    latitud: Mapped[float | None] = mapped_column(Numeric(9, 6, asdecimal=False))
    longitud: Mapped[float | None] = mapped_column(Numeric(9, 6, asdecimal=False))
    radio_metros: Mapped[int] = mapped_column(default=150)
    # Precisión máxima aceptada del GPS del teléfono (m): con señal peor no se checa.
    precision_gps_m: Mapped[int] = mapped_column(default=100, server_default="100")
    activa: Mapped[bool] = mapped_column(default=True)
