from datetime import date, datetime

from sqlalchemy import Date, DateTime, LargeBinary, String
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPkMixin
from app.models.domicilio import DomicilioMixin


class Empresa(DomicilioMixin, UUIDPkMixin, TimestampMixin, Base):
    """Cliente del SaaS (tenant). Todo dato operativo cuelga de una empresa."""

    __tablename__ = "empresas"

    nombre: Mapped[str] = mapped_column(String(150))
    # Subdominio: <slug>.time.odai.lat
    slug: Mapped[str] = mapped_column(String(40), unique=True)
    razon_social: Mapped[str | None] = mapped_column(String(250))
    direccion: Mapped[str | None] = mapped_column(String(300))  # domicilio fiscal o comercial
    rfc: Mapped[str | None] = mapped_column(String(13), unique=True)
    activa: Mapped[bool] = mapped_column(default=True)

    # Licencia: máximo de empleados activos y vigencia (None = sin vencimiento).
    max_empleados: Mapped[int] = mapped_column(default=15)
    licencia_vence: Mapped[date | None] = mapped_column(Date)
    # Empresa de demostración (presentaciones): el pie muestra "Licencia demo".
    demo: Mapped[bool] = mapped_column(default=False, server_default="false")
    # Usuarios que su administrador puede dar de alta (sin contar al administrador).
    max_usuarios: Mapped[int] = mapped_column(default=5, server_default="5")
    # Estado de la cuenta (lo manda el módulo de licencias de Odoo o lo cambia Odai):
    # corriendo | suspendida | eliminada. `activa` se mantiene igual a estado == "corriendo".
    estado: Mapped[str] = mapped_column(String(12), default="corriendo", server_default="corriendo")
    motivo_suspension: Mapped[str | None] = mapped_column(String(300))
    periodicidad: Mapped[str | None] = mapped_column(String(12))  # mensual | bimestral | ...
    referencia_odoo: Mapped[str | None] = mapped_column(String(100))  # suscripción o factura
    estado_cambiado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Logo (PNG, máx. 512 px). Diferido: solo se lee en GET /tenant/logo/{id}.
    logo: Mapped[bytes | None] = deferred(mapped_column(LargeBinary))
    logo_actualizado: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Fondo principal de la empresa: un color (#rrggbb) o una imagen (JPEG, diferida).
    fondo_color: Mapped[str | None] = mapped_column(String(7))
    fondo_imagen: Mapped[bytes | None] = deferred(mapped_column(LargeBinary))
    fondo_actualizado: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def fondo_version(self) -> str | None:
        """Versión de la imagen de fondo (None si no hay imagen)."""
        return self.fondo_actualizado.isoformat() if self.fondo_actualizado else None

    @property
    def logo_version(self) -> str | None:
        """Cambia al subir otro logo; sirve para refrescar la caché del navegador."""
        return self.logo_actualizado.isoformat() if self.logo_actualizado else None
