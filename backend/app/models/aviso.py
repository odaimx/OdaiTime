import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPkMixin


class AvisoAceptado(UUIDPkMixin, TimestampMixin, Base):
    """Constancia de que el empleado aceptó el aviso de privacidad (LFPDPPP).

    Una fila por empleado y versión del aviso; se guarda por dónde lo aceptó, la IP y el equipo
    como evidencia ante una revisión del INAI o de la autoridad laboral.
    """

    __tablename__ = "avisos_aceptados"
    __table_args__ = (UniqueConstraint("empleado_id", "version", name="uq_aviso_empleado_version"),)

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), index=True
    )
    empleado_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empleados.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[str] = mapped_column(String(20))
    medio: Mapped[str] = mapped_column(String(10))  # qr | celular | portal
    ip: Mapped[str | None] = mapped_column(String(45))
    equipo: Mapped[str | None] = mapped_column(String(120))
