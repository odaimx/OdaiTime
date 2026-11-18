import uuid

from sqlalchemy import ForeignKey, Index, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPkMixin

MODELOS_CATEGORIA = ("empleado", "sucursal", "usuario", "empresa")


class Categoria(UUIDPkMixin, Base):
    """Etiqueta para clasificar registros (como las etiquetas de Odoo).

    Las de empleados, sucursales y usuarios son de cada empresa; las de empresas son de Odai
    (empresa_id vacío) y solo las maneja el superadmin.
    """

    __tablename__ = "categorias"
    __table_args__ = (Index("ix_categorias_empresa_modelo", "empresa_id", "modelo"),)

    empresa_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("empresas.id", ondelete="CASCADE")
    )
    modelo: Mapped[str] = mapped_column(String(20))
    nombre: Mapped[str] = mapped_column(String(60))
    color: Mapped[int] = mapped_column(SmallInteger, default=0)  # índice de la paleta (0-9)


class CategoriaRegistro(Base):
    """Qué registros llevan cada categoría (muchos a muchos)."""

    __tablename__ = "categoria_registros"
    __table_args__ = (Index("ix_categoria_registros_registro", "registro_id"),)

    categoria_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("categorias.id", ondelete="CASCADE"), primary_key=True
    )
    registro_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
