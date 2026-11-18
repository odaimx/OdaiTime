"""categorías, tokens de acceso (invitación / recuperar clave), correo saliente y fondo

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "categorias",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("empresa_id", sa.Uuid(), sa.ForeignKey("empresas.id", ondelete="CASCADE")),
        sa.Column("modelo", sa.String(20), nullable=False),
        sa.Column("nombre", sa.String(60), nullable=False),
        sa.Column("color", sa.SmallInteger(), nullable=False, server_default="0"),
    )
    op.create_index("ix_categorias_empresa_modelo", "categorias", ["empresa_id", "modelo"])
    op.create_table(
        "categoria_registros",
        sa.Column(
            "categoria_id",
            sa.Uuid(),
            sa.ForeignKey("categorias.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("registro_id", sa.Uuid(), primary_key=True),
    )
    op.create_index("ix_categoria_registros_registro", "categoria_registros", ["registro_id"])
    op.create_table(
        "tokens_acceso",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "usuario_id",
            sa.Uuid(),
            sa.ForeignKey("usuarios.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tipo", sa.String(15), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expira", sa.DateTime(timezone=True), nullable=False),
        sa.Column("usado_en", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "config_correo",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("host", sa.String(200), nullable=False, server_default=""),
        sa.Column("puerto", sa.Integer(), nullable=False, server_default="587"),
        sa.Column("seguridad", sa.String(10), nullable=False, server_default="starttls"),
        sa.Column("usuario", sa.String(200), nullable=False, server_default=""),
        sa.Column("password", sa.String(300), nullable=False, server_default=""),
        sa.Column("remitente", sa.String(200), nullable=False, server_default=""),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("empresas", sa.Column("fondo_color", sa.String(7)))
    op.add_column("empresas", sa.Column("fondo_imagen", sa.LargeBinary()))
    op.add_column("empresas", sa.Column("fondo_actualizado", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("empresas", "fondo_actualizado")
    op.drop_column("empresas", "fondo_imagen")
    op.drop_column("empresas", "fondo_color")
    op.drop_table("config_correo")
    op.drop_table("tokens_acceso")
    op.drop_table("categoria_registros")
    op.drop_table("categorias")
