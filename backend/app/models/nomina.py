import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ClaveNomina(Base):
    """Clave que cada empresa usa en su sistema de nómina para un concepto de ODAITIME.

    Ejemplo: HE2 (horas extra dobles) → concepto "102" en CONTPAQi Nóminas, "P019" en NOI o el
    nombre del tipo de entrada de trabajo en Odoo.
    """

    __tablename__ = "claves_nomina"

    empresa_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE"), primary_key=True
    )
    sistema: Mapped[str] = mapped_column(String(20), primary_key=True)
    concepto: Mapped[str] = mapped_column(String(10), primary_key=True)
    codigo: Mapped[str] = mapped_column(String(60))
