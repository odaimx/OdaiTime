from datetime import datetime

from sqlalchemy import DateTime, Integer, LargeBinary
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.db.base import Base


class ConfigSistema(Base):
    """Configuración general de ODAITIME que aplica a todas las empresas (una fila, id=1):
    colores del tema y la imagen de la pantalla de inicio. La maneja el superadmin."""

    __tablename__ = "config_sistema"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    # {"marca": "#8a64de", "acento": "#54aaf6", "marino": "#1a2c4f", "titulos": "#e2c68f"}
    colores: Mapped[dict] = mapped_column(JSONB, default=dict)
    imagen_inicio: Mapped[bytes | None] = deferred(mapped_column(LargeBinary))
    imagen_actualizada: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
