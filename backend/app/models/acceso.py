import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPkMixin


class TokenAcceso(UUIDPkMixin, Base):
    """Enlace de un solo uso para crear la clave (invitación) o recuperarla.

    Solo se guarda el hash del token; el token viaja únicamente en el correo.
    """

    __tablename__ = "tokens_acceso"

    usuario_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("usuarios.id", ondelete="CASCADE"))
    tipo: Mapped[str] = mapped_column(String(15))  # invitacion | recuperar
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expira: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    usado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ConfigCorreo(Base):
    """Servidor de correo saliente general de Odai (una sola fila, id=1).

    Los correos salen con el nombre de la empresa de cada usuario como remitente visible.
    """

    __tablename__ = "config_correo"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    host: Mapped[str] = mapped_column(String(200), default="")
    puerto: Mapped[int] = mapped_column(Integer, default=587)
    seguridad: Mapped[str] = mapped_column(
        String(10), default="starttls"
    )  # starttls | ssl | ninguna
    usuario: Mapped[str] = mapped_column(String(200), default="")
    password: Mapped[str] = mapped_column(String(300), default="")
    remitente: Mapped[str] = mapped_column(String(200), default="")  # p. ej. no-responder@odai.lat
    activo: Mapped[bool] = mapped_column(Boolean, default=False)
