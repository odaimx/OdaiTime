import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPkMixin


class ConfigWhatsApp(UUIDPkMixin, TimestampMixin, Base):
    """Número de WhatsApp Business (Cloud API de Meta) de una empresa para checar.

    El número y la cuenta de pago son del cliente: Meta le cobra a él. El token y el secreto
    de la app se guardan cifrados.
    """

    __tablename__ = "config_whatsapp"

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), unique=True
    )
    activo: Mapped[bool] = mapped_column(default=False)
    # Empleados que pueden checar si su ficha no dice nada: True = todos los que tengan teléfono.
    todos: Mapped[bool] = mapped_column(default=True)
    phone_number_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    waba_id: Mapped[str | None] = mapped_column(String(40))
    numero: Mapped[str | None] = mapped_column(String(20))  # para mostrar
    token: Mapped[str | None] = mapped_column(String(2000))  # cifrado
    app_secret: Mapped[str | None] = mapped_column(String(500))  # cifrado
    verify_token: Mapped[str] = mapped_column(String(64))
