"""empresas, sucursales, usuarios y sesiones

Revision ID: 0001
Revises:
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "empresas",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("nombre", sa.String(150), nullable=False),
        sa.Column("razon_social", sa.String(250)),
        sa.Column("rfc", sa.String(13), unique=True),
        sa.Column("activa", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
    )

    op.create_table(
        "sucursales",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "empresa_id",
            sa.Uuid(),
            sa.ForeignKey("empresas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("clave", sa.String(20), nullable=False),
        sa.Column("nombre", sa.String(150), nullable=False),
        sa.Column(
            "zona_horaria", sa.String(64), nullable=False, server_default="America/Mexico_City"
        ),
        sa.Column("direccion", sa.String(300)),
        sa.Column("latitud", sa.Numeric(9, 6)),
        sa.Column("longitud", sa.Numeric(9, 6)),
        sa.Column("radio_metros", sa.Integer(), nullable=False, server_default="150"),
        sa.Column("activa", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
        sa.UniqueConstraint("empresa_id", "clave", name="uq_sucursal_empresa_clave"),
    )
    op.create_index("ix_sucursales_empresa_id", "sucursales", ["empresa_id"])

    op.create_table(
        "usuarios",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("empresa_id", sa.Uuid(), sa.ForeignKey("empresas.id", ondelete="CASCADE")),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("nombre", sa.String(150), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("rol", sa.String(30), nullable=False),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("ultimo_acceso", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.CheckConstraint(
            "rol IN ('superadmin', 'admin_empresa', 'gerente_sucursal', 'empleado')",
            name="ck_usuarios_rol",
        ),
        # Solo el superadmin vive fuera de una empresa.
        sa.CheckConstraint(
            "(rol = 'superadmin') = (empresa_id IS NULL)", name="ck_usuarios_empresa_rol"
        ),
    )
    op.create_index("ix_usuarios_empresa_id", "usuarios", ["empresa_id"])
    op.create_index("ix_usuarios_email_lower", "usuarios", [sa.text("lower(email)")], unique=True)

    op.create_table(
        "usuario_sucursales",
        sa.Column(
            "usuario_id",
            sa.Uuid(),
            sa.ForeignKey("usuarios.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "sucursal_id",
            sa.Uuid(),
            sa.ForeignKey("sucursales.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    op.create_table(
        "sesiones",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "usuario_id",
            sa.Uuid(),
            sa.ForeignKey("usuarios.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "creada_en", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expira_en", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revocada_en", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_sesiones_usuario_id", "sesiones", ["usuario_id"])


def downgrade() -> None:
    op.drop_table("sesiones")
    op.drop_table("usuario_sucursales")
    op.drop_table("usuarios")
    op.drop_table("sucursales")
    op.drop_table("empresas")
