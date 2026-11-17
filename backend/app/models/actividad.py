import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDPkMixin
from app.models.usuario import Usuario


class Actividad(UUIDPkMixin, Base):
    """Bitácora tipo "chatter" de Odoo: cambios y notas sobre cualquier registro."""

    __tablename__ = "actividades"
    __table_args__ = (Index("ix_actividades_registro", "modelo", "registro_id", "created_at"),)

    empresa_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("empresas.id", ondelete="CASCADE"))
    modelo: Mapped[str] = mapped_column(String(30))  # empleado, sucursal, turno, checada, …
    registro_id: Mapped[uuid.UUID]
    usuario_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL")
    )
    tipo: Mapped[str] = mapped_column(String(15))  # creacion, cambio, nota, sistema
    mensaje: Mapped[str | None] = mapped_column(Text)
    # [{"campo": "salario_diario", "etiqueta": "Salario diario", "antes": "450", "despues": "500"}]
    cambios: Mapped[list | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    usuario: Mapped[Usuario | None] = relationship(lazy="joined")
