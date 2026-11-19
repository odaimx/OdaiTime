from datetime import datetime

from sqlalchemy import DateTime, Integer, LargeBinary, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPkMixin


class ConfigSistema(Base):
    """Configuración general de ODAITIME que aplica a todas las empresas (una fila, id=1):
    colores del tema y la imagen de la pantalla de inicio. La maneja el superadmin."""

    __tablename__ = "config_sistema"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    # {"marca": "#8a64de", "acento": "#54aaf6", "marino": "#1a2c4f", "titulos": "#e2c68f"}
    colores: Mapped[dict] = mapped_column(JSONB, default=dict)
    imagen_inicio: Mapped[bytes | None] = deferred(mapped_column(LargeBinary))
    imagen_actualizada: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Enlaces de Odai: tienda en línea (comprar más empleados) y soporte. Vacío = valor del .env.
    url_tienda: Mapped[str | None] = mapped_column(String(300))
    url_soporte: Mapped[str | None] = mapped_column(String(300))
    # Fondo de la aplicación (para todas las empresas): color o imagen.
    fondo_color: Mapped[str | None] = mapped_column(String(7))
    fondo_imagen: Mapped[bytes | None] = deferred(mapped_column(LargeBinary))
    fondo_actualizado: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Pantalla de acceso: imagen del panel izquierdo y sus textos.
    login_imagen: Mapped[bytes | None] = deferred(mapped_column(LargeBinary))
    login_actualizada: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    login_titulo: Mapped[str | None] = mapped_column(String(120))
    login_subtitulo: Mapped[str | None] = mapped_column(String(120))
    login_texto: Mapped[str | None] = mapped_column(String(600))


class Frase(UUIDPkMixin, TimestampMixin, Base):
    """Refranes y citas bíblicas que se muestran en la pantalla de acceso."""

    __tablename__ = "frases"

    tipo: Mapped[str] = mapped_column(String(10), index=True)  # refran | cita
    texto: Mapped[str] = mapped_column(String(600))
    autor: Mapped[str | None] = mapped_column(String(150))  # autor o referencia (Juan 3:16)
